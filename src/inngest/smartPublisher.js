import { inngest } from "./client.js";
import { prisma, connectDB } from "../prisma.js";
import { log } from "../lib/logger.js";
import { generateArticleContent } from "../lib/ai.js";

const getTimestamp = () =>
    new Date().toISOString().replace("T", " ").substring(0, 19);

// AI generation timeout (30 seconds)
const AI_TIMEOUT_MS = 30000;

/**
 * Smart Publisher Function
 *
 * Runs every 10 minutes to distribute article publishing throughout the day.
 * For each webhook:
 * - Calculates if it's time to publish based on daily quota
 * - Finds scraped articles matching webhook's category config (using RSS categories)
 * - Generates AI content ON-DEMAND (fresh content for each webhook)
 * - Sends to webhook with the RSS feed category (not AI-generated category)
 * - Tracks in WebhookPublish table
 *
 * NOTE: Same article can be sent to multiple webhooks - each gets unique AI content
 *
 * Cron: Every 10 minutes (144 intervals per day)
 */
export const smartPublisher = inngest.createFunction(
    {
        id: "news/smart-publisher",
        retries: 3, // Retry entire function on failure
        concurrency: { limit: 1 }, // Only one instance at a time
    },
    { cron: "*/10 * * * *" }, // Every 10 minutes
    async ({ step, logger }) => {
        log.info("Smart Publisher started", { timestamp: getTimestamp() });

        // Step 1: Get all active webhooks with publishing config
        const webhooks = await step.run("get-active-webhooks", async () => {
            await connectDB();

            const activeWebhooks = await prisma.webhook.findMany({
                where: { active: true },
            });

            log.info("Found active webhooks", { count: activeWebhooks.length });
            return activeWebhooks;
        });

        if (webhooks.length === 0) {
            return { status: "skipped", reason: "no_active_webhooks" };
        }

        // Step 2: Process each webhook in separate steps (for individual retry)
        const results = [];

        for (const webhook of webhooks) {
            // Each webhook gets its own step - if one fails, others continue
            // Inngest will retry individual failed steps
            const result = await step.run(
                `publish-to-${webhook.name.replace(/\s+/g, "-").toLowerCase()}`,
                async () => {
                    return await publishToWebhook(webhook);
                }
            );
            results.push(result);
        }

        const successCount = results.filter(
            (r) => r.status === "published"
        ).length;
        const skipCount = results.filter((r) => r.status === "skipped").length;
        const failCount = results.filter(
            (r) => r.status === "failed" || r.status === "error"
        ).length;

        log.info("Smart Publisher completed", {
            totalWebhooks: webhooks.length,
            published: successCount,
            skipped: skipCount,
            failed: failCount,
        });

        return {
            status: "completed",
            timestamp: getTimestamp(),
            results,
        };
    }
);

/**
 * Publish one article to a specific webhook based on its config
 */
async function publishToWebhook(webhook) {
    await connectDB();

    // Calculate today's quota
    const dailyQuota = calculateDailyQuota(webhook);

    // Count articles published today to this webhook (only successful ones)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const publishedToday = await prisma.webhookPublish.count({
        where: {
            webhookId: webhook.id,
            publishedAt: { gte: todayStart },
            status: "success", // Only count successful publishes
        },
    });

    // Check if daily quota reached
    if (publishedToday >= dailyQuota) {
        log.info(`Webhook "${webhook.name}" reached daily quota`, {
            quota: dailyQuota,
            published: publishedToday,
        });
        return {
            webhookId: webhook.id,
            webhookName: webhook.name,
            status: "skipped",
            reason: "daily_quota_reached",
            quota: dailyQuota,
            published: publishedToday,
        };
    }

    // TIME-BASED DISTRIBUTION
    // Divide the day into equal time slots based on daily quota
    // For 4 articles/day: slots at 0h, 6h, 12h, 18h (every 6 hours)
    const now = new Date();
    const hoursPassed = now.getHours() + now.getMinutes() / 60;

    // Calculate which time slot we're in
    const slotDuration = 24 / dailyQuota; // Hours per article
    const currentSlot = Math.floor(hoursPassed / slotDuration) + 1; // 1-indexed
    const articlesToPublishByNow = Math.min(currentSlot, dailyQuota);

    // Should publish if we haven't reached our target for this time slot
    const shouldPublish = publishedToday < articlesToPublishByNow;

    if (!shouldPublish) {
        // Calculate when the next slot starts
        const nextSlot = Math.min(publishedToday + 1, dailyQuota);
        const nextSlotHour = nextSlot * slotDuration;
        const nextPublishTime = `${Math.floor(nextSlotHour).toString().padStart(2, "0")}:${Math.floor(
            (nextSlotHour % 1) * 60
        )
            .toString()
            .padStart(2, "0")}`;

        return {
            webhookId: webhook.id,
            webhookName: webhook.name,
            status: "skipped",
            reason: "waiting_for_scheduled_time",
            publishedToday,
            targetByNow: articlesToPublishByNow,
            nextPublishAt: nextPublishTime,
            slotDurationHours: slotDuration.toFixed(1),
        };
    }

    // Get next category to publish (round-robin)
    const categories =
        webhook.categories.length > 0 ? webhook.categories : null;
    let targetCategory = null;
    let nextCategoryIndex = webhook.lastCategoryIndex;

    if (categories && categories.length > 0) {
        targetCategory = categories[nextCategoryIndex % categories.length];
        nextCategoryIndex = (nextCategoryIndex + 1) % categories.length;
    }

    // Find latest SCRAPED article that hasn't been SUCCESSFULLY published to this webhook
    // Now uses article.rssCategory for accurate matching!
    let article = await findNextScrapedArticle(webhook.id, targetCategory);

    // If no article in target category, try other categories
    if (!article && categories && categories.length > 1) {
        for (let i = 1; i < categories.length; i++) {
            const altCategory =
                categories[(webhook.lastCategoryIndex + i) % categories.length];
            article = await findNextScrapedArticle(webhook.id, altCategory);
            if (article) {
                nextCategoryIndex =
                    (webhook.lastCategoryIndex + i + 1) % categories.length;
                break;
            }
        }
    }

    // If still no article with category filter, try any article
    if (!article) {
        article = await findNextScrapedArticle(webhook.id, null);
    }

    if (!article) {
        return {
            webhookId: webhook.id,
            webhookName: webhook.name,
            status: "skipped",
            reason: "no_articles_available",
        };
    }

    // Use the RSS category from the article (NOT AI-generated)
    const articleCategory = article.rssCategory || 'Uncategorized';

    log.ai(
        "generating",
        `On-demand AI for: ${article.title?.substring(0, 40)}...`,
        {
            articleId: article.id,
            webhookName: webhook.name,
            rssCategory: articleCategory,
        }
    );

    // GENERATE AI CONTENT ON-DEMAND with timeout
    // Each webhook gets FRESH AI content (even for same source article)
    // AI generates title + content only — category comes from RSS feed
    let aiContent;
    try {
        aiContent = await generateWithTimeout(
            {
                title: article.title,
                textContent: article.textContent,
                category: articleCategory,  // Pass category for style-based writing
            },
            AI_TIMEOUT_MS
        );
    } catch (error) {
        log.error(`AI generation failed for article ${article.id}`, error);
        // Throw to trigger Inngest retry
        throw new Error(`AI generation failed: ${error.message}`);
    }

    if (!aiContent) {
        // Throw to trigger Inngest retry
        throw new Error(
            `AI generation returned null for article ${article.id}`
        );
    }

    log.ai(
        "generated",
        `[${articleCategory}]: ${aiContent.title?.substring(0, 40)}...`,
        {
            articleId: article.id,
            webhookName: webhook.name,
            rssCategory: articleCategory,
        }
    );

    // Send to webhook — using RSS category, not AI category
    const sendResult = await sendArticleToWebhook(webhook, {
        title: aiContent.title,
        content: aiContent.content,
        category: articleCategory,  // RSS feed category
        articleId: article.id,
    });

    // If webhook failed, throw to trigger Inngest retry
    if (!sendResult.success) {
        log.error(`Webhook "${webhook.name}" failed`, sendResult.error);
        throw new Error(`Webhook delivery failed: ${sendResult.error}`);
    }

    // === SUCCESS PATH ONLY BELOW ===

    // Save generated content to GeneratedArticle table
    // Category comes from RSS feed
    const generatedArticle = await prisma.generatedArticle.upsert({
        where: { articleId: article.id },
        update: {
            title: aiContent.title,
            content: aiContent.content,
            category: articleCategory,  // RSS category
            status: "generated",
            generatedAt: new Date(),
        },
        create: {
            articleId: article.id,
            title: aiContent.title,
            content: aiContent.content,
            category: articleCategory,  // RSS category
            status: "generated",
            generatedAt: new Date(),
        },
    });

    // Record the publish in WebhookPublish table
    await prisma.webhookPublish.create({
        data: {
            webhookId: webhook.id,
            generatedArticleId: generatedArticle.id,
            category: articleCategory,  // RSS category
            status: "success",
        },
    });

    // Update category index for round-robin (ONLY on success)
    await prisma.webhook.update({
        where: { id: webhook.id },
        data: { lastCategoryIndex: nextCategoryIndex },
    });

    log.webhook(
        webhook.name,
        `Published: ${aiContent.title?.substring(0, 40)}...`,
        {
            category: articleCategory,
            articleId: article.id,
        }
    );

    return {
        webhookId: webhook.id,
        webhookName: webhook.name,
        status: "published",
        articleId: article.id,
        generatedArticleId: generatedArticle.id,
        articleTitle: aiContent.title,
        category: articleCategory,
    };
}

/**
 * Generate AI content with timeout
 */
async function generateWithTimeout(articleData, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        // Pass signal to AI generation if supported, otherwise just race
        const result = await Promise.race([
            generateArticleContent(articleData),
            new Promise((_, reject) =>
                setTimeout(
                    () =>
                        reject(
                            new Error(
                                `AI generation timed out after ${timeoutMs}ms`
                            )
                        ),
                    timeoutMs
                )
            ),
        ]);
        return result;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Calculate daily quota with growth rate
 * Formula: baseLimit × (1 + growthRate)^daysSinceStart
 */
function calculateDailyQuota(webhook) {
    const daysSinceStart = Math.floor(
        (Date.now() - new Date(webhook.publishStartDay).getTime()) /
            (24 * 60 * 60 * 1000)
    );

    const rawQuota = Math.floor(
        webhook.dailyLimit * Math.pow(1 + webhook.growthRate, daysSinceStart)
    );

    // Cap at maxDailyLimit if set (default 50), so growth never exceeds the ceiling
    const ceiling = webhook.maxDailyLimit ?? 50;
    const capped = Math.min(rawQuota, ceiling);

    return Math.max(capped, 1); // At least 1 article per day
}

/**
 * Find the next SCRAPED article to publish to a webhook
 * - Must be status 'scraped'
 * - Must not have been SUCCESSFULLY sent to this webhook before
 * - Optionally filter by webhook's categories using article.rssCategory
 * - Order by latest first (scrapedAt DESC)
 *
 * NOTE: Same article CAN be sent to different webhooks - each gets fresh AI content
 * 
 * CATEGORY MATCHING: Uses article.rssCategory (from RSS feed) for accurate matching.
 * Falls back to rssCategories array and title/source name if rssCategory is null.
 */
async function findNextScrapedArticle(webhookId, category = null) {
    // Get IDs of articles already SUCCESSFULLY sent to this webhook
    const sentArticles = await prisma.webhookPublish.findMany({
        where: {
            webhookId,
            status: "success", // Only exclude successful publishes
        },
        select: { generatedArticle: { select: { articleId: true } } },
    });

    const excludeArticleIds = sentArticles
        .filter((p) => p.generatedArticle)
        .map((p) => p.generatedArticle.articleId);

    // Build where clause
    const whereClause = {
        status: "scraped",
        textContent: { not: null }, // Must have content to generate AI
        ...(excludeArticleIds.length > 0 && {
            id: { notIn: excludeArticleIds },
        }),
    };

    // Category matching using RSS categories (much more accurate than title matching)
    if (category) {
        whereClause.OR = [
            // Primary: match against normalized RSS category
            { rssCategory: { equals: category, mode: "insensitive" } },
            // Secondary: check if category exists in raw RSS categories array
            { rssCategories: { has: category } },
            // Fallback: title/source name matching (for articles without RSS categories)
            { title: { contains: category, mode: "insensitive" } },
            { source: { name: { contains: category, mode: "insensitive" } } },
        ];
    }

    const article = await prisma.article.findFirst({
        where: whereClause,
        include: { source: true },
        orderBy: { scrapedAt: "desc" }, // Latest first
    });

    return article;
}

/**
 * Send article to webhook URL
 */
async function sendArticleToWebhook(webhook, article) {
    try {
        const payload = {
            title: article.title,
            content: article.content,
            category: article.category,     // RSS feed category
            articleId: article.articleId,
        };

        const bodyString = JSON.stringify(payload);

        const headers = {
            "Content-Type": "application/json",
        };

        if (webhook.secret) {
            // HMAC-SHA256 signing: sign the body + timestamp together
            // This prevents tampering AND replay attacks (5 min window)
            const timestamp = Math.floor(Date.now() / 1000).toString();
            const { createHmac } = await import("crypto");
            const signature = createHmac("sha256", webhook.secret)
                .update(bodyString + timestamp)
                .digest("hex");

            headers["X-Webhook-Signature"] = `sha256=${signature}`;
            headers["X-Webhook-Timestamp"]  = timestamp;
        }

        const response = await fetch(webhook.url, {
            method: "POST",
            headers,
            body: bodyString,
        });

        if (!response.ok && response.status !== 409) {
            const errorText = await response.text();
            return {
                success: false,
                error: `HTTP ${response.status}: ${errorText}`,
            };
        }

        // 200-299 = published, 409 = already published (duplicate) — both are success
        return { success: true, status: response.status, duplicate: response.status === 409 };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export default smartPublisher;
