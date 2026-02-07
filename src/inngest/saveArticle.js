import { inngest } from "./client.js";
import { prisma, connectDB } from "../prisma.js";

const getTimestamp = () =>
    new Date().toISOString().replace("T", " ").substring(0, 19);

/**
 * Save Article Function
 *
 * Marks article as fully scraped and ready for publishing.
 * Content is already saved by scrapeContent, embedding by generateEmbedding.
 *
 * AI generation is deferred until publish time (handled by smartPublisher).
 *
 * Triggered by: article/duplicate.checked event
 * Pipeline ends here - smartPublisher will pick up scraped articles
 */
export const saveArticle = inngest.createFunction(
    {
        id: "news/save-article-to-database",
        retries: 2,
        concurrency: { limit: 10 },
    },
    { event: "article/duplicate.checked" },
    async ({ event, step, logger }) => {
        const { articleId, sourceId, sourceName } = event.data;

        logger.info(`[${getTimestamp()}] 💾 Finalizing article: ${articleId}`);

        // Step 1: Update article status to 'scraped' and increment source count
        const savedArticle = await step.run("finalize-article", async () => {
            await connectDB();

            // Update status to scraped (content already saved by scrapeContent)
            const article = await prisma.article.update({
                where: { id: articleId },
                data: {
                    status: "scraped",
                    scrapedAt: new Date(),
                },
            });

            // Increment source article count
            await prisma.source.update({
                where: { id: sourceId },
                data: { totalArticles: { increment: 1 } },
            });

            logger.info(
                `✓ [${getTimestamp()}] [${sourceName}] Scraped & ready: ${article.title?.substring(0, 40)}...`
            );

            return article;
        });

        // NOTE: AI generation is now deferred until publish time
        // The smartPublisher will:
        // 1. Select scraped articles based on webhook config
        // 2. Generate AI content on-demand
        // 3. Send to webhook

        logger.info(
            `[${getTimestamp()}] ✅ Article ready for smart publishing: ${savedArticle.title?.substring(0, 40)}...`
        );

        return {
            message: `Article "${savedArticle.title?.substring(0, 40)}..." scraped and queued for smart publishing.`,
            status: "success",
            articleId,
            title: savedArticle.title,
            nextStep: "smartPublisher (on schedule)",
        };
    }
);

export default saveArticle;
