import { inngest } from './client.js';
import { prisma, connectDB } from '../prisma.js';
import { scrapeNewsArticle } from '../scraper.js';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

/**
 * Scrape Content Function
 * 
 * Scrapes the full content of a single article and SAVES to DB immediately.
 * Only passes articleId to next function (no large payloads).
 * 
 * Triggered by: article/unique.found event
 * Emits: article/content.scraped event (with articleId only)
 */
export const scrapeContent = inngest.createFunction(
  {
    id: "news/scrape-article-content",
    retries: 3,
    concurrency: { limit: 3 } // Limit parallel scrapes to avoid rate limiting
  },
  { event: "article/unique.found" },
  async ({ event, step, logger }) => {
    const { articleId, sourceId, sourceName, articleUrl, title } = event.data;

    logger.info(`[${getTimestamp()}] 🔍 Scraping content: ${title?.substring(0, 50)}...`);

    // Step 1: Scrape and SAVE to DB immediately
    const result = await step.run("scrape-and-save", async () => {
      await connectDB();
      
      try {
        const articleData = await scrapeNewsArticle(articleUrl);
        
        if (!articleData || !articleData.textContent) {
          throw new Error('Scraper returned empty content');
        }

        // SAVE content to DB immediately (not passing through events)
        const updatedArticle = await prisma.article.update({
          where: { id: articleId },
          data: {
            title: articleData.title?.trim() || title,
            textContent: articleData.textContent,
            excerpt: articleData.excerpt ?? '',
            byline: articleData.byline ?? '',
            siteName: articleData.siteName ?? '',
            status: 'content_scraped' // Intermediate status
          }
        });

        logger.info(`[${getTimestamp()}] ✓ Scraped & saved ${articleData.textContent.length} chars from ${sourceName}`);
        
        return {
          success: true,
          contentLength: articleData.textContent.length,
          title: updatedArticle.title
        };
      } catch (error) {
        const isBlocked = error.message.includes('403') || error.message.includes('Forbidden');
        
        // Update article status to failed
        await prisma.article.update({
          where: { id: articleId },
          data: { 
            status: 'failed', 
            errorMessage: isBlocked ? 'Blocked (403)' : error.message 
          }
        });

        throw error;
      }
    });

    // Step 2: Trigger embedding generation (only pass articleId!)
    const triggerResult = await step.run("trigger-embedding", async () => {
      await inngest.send({
        name: 'article/content.scraped',
        data: {
          articleId,
          sourceId,
          sourceName
        }
      });
      
      logger.info(`[${getTimestamp()}] 📤 Dispatched embedding generation for article: ${articleId}`);
      
      return {
        message: 'Successfully dispatched embedding generation event',
        eventSent: 'article/content.scraped',
        articleId,
        sentAt: new Date().toISOString()
      };
    });

    return {
      message: `Article content scraped successfully (${result.contentLength} chars) and passed to embedding generation`,
      status: 'success',
      articleId,
      contentLength: result.contentLength,
      nextStep: 'generateEmbedding'
    };
  }
);

export default scrapeContent;
