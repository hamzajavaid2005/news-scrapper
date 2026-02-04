import { inngest } from './client.js';
import { prisma, connectDB } from '../prisma.js';
import { findSimilarArticles } from '../lib/vector.js';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

/**
 * Check Duplicate Function
 * 
 * Fetches embedding from DB and checks for semantically similar articles.
 * Only passes articleId to next function (no large payloads).
 * 
 * Triggered by: article/embedding.generated event
 * Emits: article/duplicate.checked event (with articleId only)
 */
export const checkDuplicate = inngest.createFunction(
  {
    id: "news/check-duplicate-articles",
    retries: 2,
    concurrency: { limit: 10 } // Allow parallel duplicate checks
  },
  { event: "article/embedding.generated" },
  async ({ event, step, logger }) => {
    const { articleId, sourceId, sourceName, hasEmbedding } = event.data;

    logger.info(`[${getTimestamp()}] 🔄 Checking duplicates for article: ${articleId}`);

    // Step 1: Check for similar articles using embedding from DB
    const duplicateResult = await step.run("find-similar-articles", async () => {
      await connectDB();
      
      // Fetch article with embedding from DB
      const article = await prisma.article.findUnique({
        where: { id: articleId },
        include: { source: true }
      });

      if (!article) {
        throw new Error(`Article not found: ${articleId}`);
      }

      // If no embedding, skip duplicate check
      if (!hasEmbedding) {
        logger.info(`[${getTimestamp()}] ⚠️ No embedding available, skipping duplicate check`);
        return { isDuplicate: false, article };
      }

      try {
        // Get embedding from DB using raw query
        const embeddingResult = await prisma.$queryRaw`
          SELECT embedding::text FROM articles WHERE id = ${articleId}
        `;
        
        if (!embeddingResult[0]?.embedding) {
          logger.info(`[${getTimestamp()}] ⚠️ No embedding in DB, skipping duplicate check`);
          return { isDuplicate: false, article };
        }

        // Parse embedding from string format [x,y,z] to array
        const embeddingStr = embeddingResult[0].embedding;
        const embedding = JSON.parse(embeddingStr);

        const similar = await findSimilarArticles(embedding, 0.93); // 93% similarity threshold
        
        if (similar.length > 0 && similar[0].url !== article.url) {
          const duplicate = similar[0];
          logger.info(`[${getTimestamp()}] 🔄 Found duplicate (${(duplicate.similarity * 100).toFixed(0)}%): ${article.title?.substring(0, 40)}...`);
          return { isDuplicate: true, duplicateOf: duplicate, article };
        }
        
        logger.info(`[${getTimestamp()}] ✓ Article is unique: ${article.title?.substring(0, 40)}...`);
        return { isDuplicate: false, article };
      } catch (error) {
        logger.warn(`[${getTimestamp()}] ⚠️ Duplicate check failed: ${error.message}`);
        return { isDuplicate: false, article };
      }
    });

    // Step 2: Handle duplicate or trigger save
    if (duplicateResult.isDuplicate) {
      // Mark as duplicate in database
      await step.run("mark-as-duplicate", async () => {
        const duplicate = duplicateResult.duplicateOf;
        
        console.log(`🔄 [${getTimestamp()}] [${sourceName}] DUPLICATE (${(duplicate.similarity * 100).toFixed(0)}%): ${duplicateResult.article.title?.substring(0, 40)}...`);
        console.log(`   └─ Similar to: ${duplicate.title?.substring(0, 45)}...`);
        
        await prisma.article.update({
          where: { id: articleId },
          data: {
            status: 'duplicate',
            errorMessage: `Duplicate of ${duplicate.url}`,
            scrapedAt: new Date()
          }
        });
      });

      return {
        status: 'duplicate',
        articleId,
        duplicateOf: duplicateResult.duplicateOf?.url
      };
    }

    // Step 3: Trigger save for unique article (only pass articleId!)
    await step.sendEvent("trigger-save-article", {
      name: 'article/duplicate.checked',
      data: {
        articleId,
        sourceId,
        sourceName
      }
    });
    
    logger.info(`[${getTimestamp()}] 📤 Dispatched save for unique article: ${articleId}`);

    return {
      message: 'Duplicate check passed - article is unique and will be saved.',
      status: 'unique',
      articleId,
      nextStep: 'saveArticle'
    };
  }
);

export default checkDuplicate;
