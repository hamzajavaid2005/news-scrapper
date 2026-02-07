import { inngest } from "./client.js";
import { prisma, connectDB } from "../prisma.js";
import { log } from "../lib/logger.js";

const getTimestamp = () =>
    new Date().toISOString().replace("T", " ").substring(0, 19);

/**
 * Cleanup Old Articles Function
 *
 * Runs every 6 hours to delete old articles and generated content.
 * Deletes:
 * - Scraped articles older than 2 days (and their generated articles via cascade)
 * - Generated articles older than 2 days (and their webhook publishes via cascade)
 *
 * Cron: Every 20 minutes
 */
export const cleanupOldArticles = inngest.createFunction(
    {
        id: "news/cleanup-old-articles",
        retries: 2,
        concurrency: { limit: 1 },
    },
    { cron: "*/20 * * * *" }, // Every 20 minutes
    async ({ step, logger }) => {
        log.info("Cleanup started", { timestamp: getTimestamp() });

        // Step 1: Delete old scraped articles (cascades to generated articles & webhook publishes)
        const deletedArticles = await step.run(
            "delete-old-articles",
            async () => {
                await connectDB();

                // Calculate 2 days ago (inside step for accurate time on retry)
                const twoDaysAgo = new Date();
                twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

                // Count first for logging
                const count = await prisma.article.count({
                    where: {
                        scrapedAt: { lt: twoDaysAgo },
                        status: "scraped",
                    },
                });

                if (count === 0) {
                    log.info("No old scraped articles to delete");
                    return 0;
                }

                // Delete old scraped articles
                // This will CASCADE delete:
                // - GeneratedArticle (via onDelete: Cascade)
                // - WebhookPublish (via GeneratedArticle cascade)
                const result = await prisma.article.deleteMany({
                    where: {
                        scrapedAt: { lt: twoDaysAgo },
                        status: "scraped",
                    },
                });

                log.info(`Deleted ${result.count} old scraped articles`, {
                    olderThan: twoDaysAgo.toISOString(),
                });

                return result.count;
            }
        );

        // Step 2: Delete old generated articles that might be orphaned or old
        // (in case articles were deleted but generated articles remained)
        const deletedGenerated = await step.run(
            "delete-old-generated",
            async () => {
                await connectDB();

                // Calculate 2 days ago
                const twoDaysAgo = new Date();
                twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

                // Count first for logging
                const count = await prisma.generatedArticle.count({
                    where: {
                        generatedAt: { lt: twoDaysAgo },
                    },
                });

                if (count === 0) {
                    log.info("No old generated articles to delete");
                    return 0;
                }

                // Delete old generated articles
                // This will CASCADE delete WebhookPublish records
                const result = await prisma.generatedArticle.deleteMany({
                    where: {
                        generatedAt: { lt: twoDaysAgo },
                    },
                });

                log.info(`Deleted ${result.count} old generated articles`, {
                    olderThan: twoDaysAgo.toISOString(),
                });

                return result.count;
            }
        );

        // Step 3: Clean up orphaned webhook publishes (shouldn't exist but just in case)
        const deletedPublishes = await step.run(
            "cleanup-orphaned-publishes",
            async () => {
                await connectDB();

                const twoDaysAgo = new Date();
                twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

                const result = await prisma.webhookPublish.deleteMany({
                    where: {
                        publishedAt: { lt: twoDaysAgo },
                    },
                });

                if (result.count > 0) {
                    log.info(
                        `Deleted ${result.count} old webhook publish records`
                    );
                }

                return result.count;
            }
        );

        const totalDeleted =
            deletedArticles + deletedGenerated + deletedPublishes;

        log.info("Cleanup completed", {
            deletedArticles,
            deletedGenerated,
            deletedPublishes,
            totalDeleted,
        });

        return {
            status: "completed",
            deletedArticles,
            deletedGenerated,
            deletedPublishes,
            totalDeleted,
            timestamp: getTimestamp(),
        };
    }
);

export default cleanupOldArticles;
