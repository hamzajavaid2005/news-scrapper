import { inngest } from "./client.js";
import { prisma, connectDB } from "../prisma.js";
import { log } from "../lib/logger.js";
import { generateArticleContent } from "../lib/ai.js";

const getTimestamp = () =>
    new Date().toISOString().replace("T", " ").substring(0, 19);

/**
 * Smart Publisher Function
 *
 * Runs every 30 minutes to distribute article publishing throughout the day.
 * For each webhook:
 * - Calculates if it's time to publish based on daily quota
 * - Finds scraped articles matching webhook's category config
 * - Generates AI content ON-DEMAND (not pre-generated)
 * - Sends to webhook
 * - Tracks in WebhookPublish table
 *
 * Cron: Every 30 minutes (48 intervals per day)
 */
export const smartPublisher = inngest.createFunction(
    {
        id: "news/smart-publisher",
        retries: 2,
        concurrency: { limit: 1 }, // Only one instance at a time
    },
    { cron: "*/30 * * * *" }, // Every 30 minutes
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

        // Step 2: Process each webhook
        const results = [];

        for (const webhook of webhooks) {
            const result = await step.run(
                `publish-to-${webhook.name.replace(/\s+/g, "-")}`,
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

        log.info("Smart Publisher completed", {
            totalWebhooks: webhooks.length,
            published: successCount,
            skipped: skipCount,
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
    try {
        // Calculate today's quota
        const dailyQuota = calculateDailyQuota(webhook);

        // Count articles published today to this webhook
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const publishedToday = await prisma.webhookPublish.count({
            where: {
                webhookId: webhook.id,
                publishedAt: { gte: todayStart },
                status: "success",
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
        // Calculate how many articles should have been published by now
        const now = new Date();
        const hoursPassed = now.getHours() + now.getMinutes() / 60;
        const expectedPublished = Math.floor((hoursPassed / 24) * dailyQuota);

        // Should publish if we're behind schedule
        const shouldPublish = publishedToday < expectedPublished;

        if (!shouldPublish) {
            const nextPublishHour = ((publishedToday + 1) / dailyQuota) * 24;
            const nextPublishTime = `${Math.floor(nextPublishHour)}:${Math.floor(
                (nextPublishHour % 1) * 60
            )
                .toString()
                .padStart(2, "0")}`;

            return {
                webhookId: webhook.id,
                webhookName: webhook.name,
                status: "skipped",
                reason: "waiting_for_scheduled_time",
                publishedToday,
                expectedByNow: expectedPublished,
                nextPublishAt: nextPublishTime,
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

        // Find latest SCRAPED article that hasn't been published to this webhook
        let article = await findNextScrapedArticle(webhook.id, targetCategory);

        // If no article in target category, try other categories
        if (!article && categories && categories.length > 1) {
            for (let i = 1; i < categories.length; i++) {
                const altCategory =
                    categories[
                        (webhook.lastCategoryIndex + i) % categories.length
                    ];
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

        log.ai(
            "generating",
            `On-demand AI for: ${article.title?.substring(0, 40)}...`,
            {
                articleId: article.id,
                webhookName: webhook.name,
            }
        );

        // GENERATE AI CONTENT ON-DEMAND
        const aiContent = await generateArticleContent({
            title: article.title,
            textContent: article.textContent,
        });

        if (!aiContent) {
            log.error(`AI generation failed for article ${article.id}`);
            return {
                webhookId: webhook.id,
                webhookName: webhook.name,
                status: "failed",
                reason: "ai_generation_failed",
                articleId: article.id,
            };
        }

        // Save generated content to GeneratedArticle table
        const generatedArticle = await prisma.generatedArticle.upsert({
            where: { articleId: article.id },
            update: {
                title: aiContent.title,
                content: aiContent.content,
                category: aiContent.category,
                status: "generated",
                generatedAt: new Date(),
            },
            create: {
                articleId: article.id,
                title: aiContent.title,
                content: aiContent.content,
                category: aiContent.category,
                status: "generated",
                generatedAt: new Date(),
            },
        });

        log.ai(
            "generated",
            `[${aiContent.category}]: ${aiContent.title?.substring(0, 40)}...`,
            {
                articleId: article.id,
                generatedId: generatedArticle.id,
            }
        );

        // Send to webhook
        const sendResult = await sendArticleToWebhook(webhook, {
            title: aiContent.title,
            content: aiContent.content,
            category: aiContent.category,
            articleId: article.id,
        });

        // Record the publish in WebhookPublish table
        await prisma.webhookPublish.create({
            data: {
                webhookId: webhook.id,
                generatedArticleId: generatedArticle.id,
                category: aiContent.category,
                status: sendResult.success ? "success" : "failed",
            },
        });

        // Update category index for round-robin
        await prisma.webhook.update({
            where: { id: webhook.id },
            data: { lastCategoryIndex: nextCategoryIndex },
        });

        if (sendResult.success) {
            log.webhook(
                webhook.name,
                `Published: ${aiContent.title?.substring(0, 40)}...`,
                {
                    category: aiContent.category,
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
                category: aiContent.category,
            };
        } else {
            log.error(`Webhook "${webhook.name}" failed`, sendResult.error);
            return {
                webhookId: webhook.id,
                webhookName: webhook.name,
                status: "failed",
                error: sendResult.error,
            };
        }
    } catch (error) {
        log.error(`Error publishing to webhook "${webhook.name}"`, error);
        return {
            webhookId: webhook.id,
            webhookName: webhook.name,
            status: "error",
            error: error.message,
        };
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

    const quota = Math.floor(
        webhook.dailyLimit * Math.pow(1 + webhook.growthRate, daysSinceStart)
    );

    return Math.max(quota, 1); // At least 1 article per day
}

/**
 * Find the next SCRAPED article to publish to a webhook
 * - Must be status 'scraped'
 * - Must not have been sent to this webhook before
 * - Optionally filter by webhook's categories (matches AI-determined category later)
 * - For category matching: we'll check if source contains category keyword or use any
 * - Order by latest first (scrapedAt DESC)
 */
async function findNextScrapedArticle(webhookId, category = null) {
    // Get IDs of articles already sent to this webhook
    const sentArticles = await prisma.webhookPublish.findMany({
        where: { webhookId },
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

    // If category filter, try to match by source name or title keywords
    // (Since AI category isn't generated yet, we do best-effort matching)
    if (category) {
        whereClause.OR = [
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
            category: article.category,
            articleId: article.articleId,
        };

        const headers = {
            "Content-Type": "application/json",
        };

        if (webhook.secret) {
            headers["X-Webhook-Secret"] = webhook.secret;
        }

        const response = await fetch(webhook.url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            return {
                success: false,
                error: `HTTP ${response.status}: ${errorText}`,
            };
        }

        return { success: true, status: response.status };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export default smartPublisher;
