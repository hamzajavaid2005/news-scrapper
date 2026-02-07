import { inngest } from "./client.js";
import { prisma, connectDB } from "../prisma.js";
import { log } from "../lib/logger.js";

const getTimestamp = () =>
    new Date().toISOString().replace("T", " ").substring(0, 19);

/**
 * Cleanup Old Articles Function
 *
 * Runs every 6 hours to delete old scraped articles.
 * Only deletes articles that:
 * - Are older than 5 days
 * - Have status 'scraped' (not pending or failed)
 * - Do NOT have a generated article (AI content)
 *
 * This keeps the database clean while preserving articles
 * that have been published to webhooks.
 *
 * Cron: Every 6 hours
 */
export const cleanupOldArticles = inngest.createFunction(
    {
        id: "news/cleanup-old-articles",
        retries: 1,
        concurrency: { limit: 1 },
    },
    { cron: "*/20 * * * *" }, // Every 20 minutes
    async ({ step, logger }) => {
        log.info("Cleanup started", { timestamp: getTimestamp() });

        // Calculate 5 days ago
        const fiveDaysAgo = new Date();
        fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 2);

        // Step 1: Count articles to be deleted (for logging)
        const countResult = await step.run("count-old-articles", async () => {
            await connectDB();

            const count = await prisma.article.count({
                where: {
                    status: "scraped",
                    scrapedAt: { lt: fiveDaysAgo },
                    // Only delete if NO generated article exists
                    generatedArticle: null,
                },
            });

            log.info(`Found ${count} old scraped articles to delete`, {
                olderThan: fiveDaysAgo.toISOString(),
            });

            return count;
        });

        if (countResult === 0) {
            log.info("No old articles to delete");
            return {
                status: "completed",
                deleted: 0,
                message: "No old articles found",
            };
        }

        // Step 2: Delete old scraped articles (without generated content)
        const deleteResult = await step.run("delete-old-articles", async () => {
            const result = await prisma.article.deleteMany({
                where: {
                    status: "scraped",
                    scrapedAt: { lt: fiveDaysAgo },
                    generatedArticle: null,
                },
            });

            log.info(`Deleted ${result.count} old scraped articles`, {
                olderThan: fiveDaysAgo.toISOString(),
            });

            return result.count;
        });

        return {
            status: "completed",
            deleted: deleteResult,
            olderThan: fiveDaysAgo.toISOString(),
            timestamp: getTimestamp(),
        };
    }
);

export default cleanupOldArticles;
