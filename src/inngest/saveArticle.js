import { inngest } from './client.js';
import { prisma, connectDB } from '../prisma.js';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

/**
 * Save Article Function
 * 
 * Marks article as fully scraped and triggers AI generation.
 * Content is already saved by scrapeContent, embedding by generateEmbedding.
 * 
 * Triggered by: article/duplicate.checked event
 * Emits: article/scraped event (continues to generateArticle)
 */
export const saveArticle = inngest.createFunction(
  {
    id: "news/save-article-to-database",
    retries: 2,
    concurrency: { limit: 10 }
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
          status: 'scraped',
          scrapedAt: new Date()
        }
      });

      // Increment source article count
      await prisma.source.update({
        where: { id: sourceId },
        data: { totalArticles: { increment: 1 } }
      });

      logger.info(`✓ [${getTimestamp()}] [${sourceName}] Finalized: ${article.title?.substring(0, 40)}...`);
      
      return article;
    });

    // Step 2: Trigger AI article generation
    await step.sendEvent("trigger-ai-generation", {
      name: 'article/scraped',
      data: {
        articleId: articleId,
        title: savedArticle.title,
        sourceName: sourceName
      }
    });
    
    logger.info(`[${getTimestamp()}] 📤 Triggered AI generation for: ${savedArticle.title?.substring(0, 40)}...`);

    return {
      message: `Article "${savedArticle.title?.substring(0, 40)}..." finalized in database and sent to AI for rewriting.`,
      status: 'success',
      articleId,
      title: savedArticle.title,
      nextStep: 'generateArticle'
    };
  }
);

export default saveArticle;
