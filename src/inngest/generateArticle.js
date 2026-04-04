import { inngest } from "./client.js";
import { prisma, connectDB } from "../prisma.js";
import { generateArticleContent } from "../lib/ai.js";
import { log } from "../lib/logger.js";

const getTimestamp = () =>
    new Date().toISOString().replace("T", " ").substring(0, 19);

/**
 * Generate AI article from scraped content
 * Triggered when an article is successfully scraped
 * 
 * NOTE: Category comes from RSS feed (article.rssCategory), NOT from AI.
 * AI only generates title + content.
 */
export const generateArticle = inngest.createFunction(
    {
        id: "news/ai-rewrite-article",
        retries: 2,
        concurrency: { limit: 1 }, // Allow 1 parallel generations
    },
    { event: "article/scraped" },
    async ({ event, step, logger }) => {
        const { articleId, title, sourceName } = event.data;

        // Step 1: Fetch article and check if already generated (combined DB operations)
        const { article, existing } = await step.run(
            "fetch-and-check",
            async () => {
                await connectDB();

                const [art, existingGen] = await Promise.all([
                    prisma.article.findUnique({
                        where: { id: articleId },
                        include: { source: true },
                    }),
                    prisma.generatedArticle.findUnique({
                        where: { articleId },
                    }),
                ]);

                if (!art) {
                    throw new Error(`Article not found: ${articleId}`);
                }

                return { article: art, existing: existingGen };
            }
        );

        if (existing) {
            logger.info(`Article already generated: ${title}`);
            return { status: "skipped", reason: "already_generated" };
        }

        // Step 2: Generate AI content (external API call - keep separate for retry isolation)
        // AI only generates title + content — category comes from RSS feed
        const generated = await step.run("generate-content", async () => {
            log.ai("generate", `Generating: ${title?.substring(0, 50)}...`, {
                articleId,
                sourceName,
            });

            const result = await generateArticleContent({
                title: article.title,
                textContent: article.textContent,
                category: article.rssCategory,  // Pass category for style-based writing
            });

            if (!result) {
                throw new Error("AI generation returned null");
            }

            return result;
        });

        // Use the RSS category from the original article
        const rssCategory = article.rssCategory || 'Uncategorized';

        // Step 3: Save to database with RSS category
        const savedGenerated = await step.run("save-generated", async () => {
            const saved = await prisma.generatedArticle.upsert({
                where: { articleId },
                update: {
                    title: generated.title,
                    content: generated.content,
                    category: rssCategory,  // RSS feed category
                    status: "generated",
                    generatedAt: new Date(),
                },
                create: {
                    articleId,
                    title: generated.title,
                    content: generated.content,
                    category: rssCategory,  // RSS feed category
                    status: "generated",
                    generatedAt: new Date(),
                },
            });

            log.ai(
                "generated",
                `Generated [${rssCategory}]: ${generated.title?.substring(0, 40)}...`,
                {
                    articleId,
                    generatedId: saved.id,
                    category: rssCategory,
                }
            );

            return saved;
        });

        // Note: Webhook delivery is handled by smartPublisher (runs every 10 min)
        // This allows rate-limited, category-rotated publishing per webhook config
        logger.info(
            `✅ [${getTimestamp()}] Article queued for smart publishing: ${generated.title?.substring(0, 40)}...`
        );

        return {
            message: `AI successfully rewrote article as "${generated.title?.substring(0, 40)}..." in category [${rssCategory}]. Queued for smart publishing.`,
            status: "success",
            articleId,
            generatedArticleId: savedGenerated.id,
            category: rssCategory,
            generatedTitle: generated.title,
            nextStep: "smartPublisher",
        };
    }
);

export default generateArticle;
