import { inngest } from "./client.js";
import { prisma, connectDB } from "../prisma.js";
import { generateArticleContent } from "../lib/ai.js";
import { log } from "../lib/logger.js";

const getTimestamp = () =>
    new Date().toISOString().replace("T", " ").substring(0, 19);

/**
 * Generate AI article from scraped content
 * Triggered when an article is successfully scraped
 * OPTIMIZED: Reduced from 6 steps to 3 steps
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
        const generated = await step.run("generate-content", async () => {
            log.ai("generate", `Generating: ${title?.substring(0, 50)}...`, {
                articleId,
                sourceName,
            });

            const result = await generateArticleContent({
                title: article.title,
                textContent: article.textContent,
            });

            if (!result) {
                throw new Error("AI generation returned null");
            }

            return result;
        });

        // Step 3: Save to database
        const savedGenerated = await step.run("save-generated", async () => {
            const saved = await prisma.generatedArticle.upsert({
                where: { articleId },
                update: {
                    title: generated.title,
                    content: generated.content,
                    category: generated.category,
                    status: "generated",
                    generatedAt: new Date(),
                },
                create: {
                    articleId,
                    title: generated.title,
                    content: generated.content,
                    category: generated.category,
                    status: "generated",
                    generatedAt: new Date(),
                },
            });

            log.ai(
                "generated",
                `Generated [${generated.category}]: ${generated.title?.substring(0, 40)}...`,
                {
                    articleId,
                    generatedId: saved.id,
                    category: generated.category,
                }
            );

            return saved;
        });

        // Step 4: Trigger webhook event (separate step for reliability)
        await step.sendEvent("trigger-webhook", {
            name: "article/generated",
            data: {
                generatedArticleId: savedGenerated.id,
                articleId: articleId,
            },
        });
        logger.info(
            `📤 [${getTimestamp()}] Webhook trigger sent for: ${generated.title?.substring(0, 40)}...`
        );

        return {
            message: `AI successfully rewrote article as "${generated.title?.substring(0, 40)}..." in category [${generated.category}]. Sent to webhooks.`,
            status: "success",
            articleId,
            generatedArticleId: savedGenerated.id,
            category: generated.category,
            generatedTitle: generated.title,
            nextStep: "sendWebhook",
        };
    }
);

export default generateArticle;
