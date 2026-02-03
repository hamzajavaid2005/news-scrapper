import { inngest } from './client.js';
import { prisma, connectDB } from '../prisma.js';
import { generateEmbedding } from '../lib/ai.js';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

/**
 * Generate Embedding Function
 * 
 * Fetches article from DB, generates embedding, and SAVES embedding to DB.
 * Only passes articleId to next function (no large payloads).
 * 
 * Triggered by: article/content.scraped event
 * Emits: article/embedding.generated event (with articleId only)
 */
export const generateArticleEmbedding = inngest.createFunction(
  {
    id: "news/generate-ai-embedding",
    retries: 2,
    concurrency: { limit: 1 } // Allow parallel embedding generation
  },
  { event: "article/content.scraped" },
  async ({ event, step, logger }) => {
    const { articleId, sourceId, sourceName } = event.data;

    logger.info(`[${getTimestamp()}] 🧠 Generating embedding for article: ${articleId}`);

    // Step 1: Fetch article from DB and generate embedding
    const result = await step.run("fetch-and-generate-embedding", async () => {
      await connectDB();
      
      // Fetch article content from DB
      const article = await prisma.article.findUnique({
        where: { id: articleId }
      });

      if (!article) {
        throw new Error(`Article not found: ${articleId}`);
      }

      const fullText = `${article.title} ${article.excerpt || ''} ${article.textContent || ''}`;
      
      try {
        const embedding = await generateEmbedding(fullText);
        
        // SAVE embedding to DB immediately
        const vectorString = `[${embedding.join(',')}]`;
        await prisma.$executeRaw`UPDATE articles SET embedding = ${vectorString}::vector WHERE id = ${articleId}`;
        
        logger.info(`[${getTimestamp()}] ✓ Generated & saved embedding (${embedding.length} dimensions)`);
        return { hasEmbedding: true, title: article.title };
      } catch (error) {
        logger.warn(`[${getTimestamp()}] ⚠️ Failed to generate embedding: ${error.message}`);
        // Continue without embedding - duplicate check will skip
        return { hasEmbedding: false, title: article.title };
      }
    });

    // Step 2: Trigger duplicate check (only pass articleId!)
    await step.sendEvent("trigger-duplicate-check", {
      name: 'article/embedding.generated',
      data: {
        articleId,
        sourceId,
        sourceName,
        hasEmbedding: result.hasEmbedding
      }
    });
    
    logger.info(`[${getTimestamp()}] 📤 Dispatched duplicate check for article: ${articleId}`);

    return {
      message: result.hasEmbedding 
        ? `Embedding generated (1536 dimensions) and saved to database. Passed to duplicate checker.`
        : `Embedding generation skipped or failed. Passed to duplicate checker without embedding.`,
      status: 'success',
      articleId,
      hasEmbedding: result.hasEmbedding,
      nextStep: 'checkDuplicate'
    };
  }
);

export default generateArticleEmbedding;
