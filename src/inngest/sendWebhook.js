import { inngest } from './client.js';
import { prisma, connectDB } from '../prisma.js';
import { RetryAfterError } from 'inngest';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

// Custom retry delays: 2 minutes, 15 minutes, 1 hour
const RETRY_DELAYS = ['2m', '15m', '1h'];

/**
 * Send generated article to webhook
 * Triggered when an AI article is successfully generated and saved
 * OPTIMIZED: Reduced from 3 steps to 2 steps
 * RETRY SCHEDULE: 2 minutes → 15 minutes → 1 hour → give up
 */
export const sendWebhook = inngest.createFunction(
  {
    id: "send-webhook",
    retries: 3, // 3 retries with custom delays
    concurrency: { limit: 5 }
  },
  { event: "article/generated" },
  async ({ event, step, logger, attempt }) => {
    const { generatedArticleId, articleId } = event.data;

    // Step 1: Fetch the generated article (connects to DB first)
    const generatedArticle = await step.run("fetch-article", async () => {
      await connectDB();
      
      const article = await prisma.generatedArticle.findUnique({
        where: { id: generatedArticleId },
        include: { article: true }
      });

      if (!article) {
        throw new Error(`Generated article not found: ${generatedArticleId}`);
      }

      return article;
    });

    // Step 2: Send to webhook with custom retry delays
    const webhookResult = await step.run("send-to-webhook", async () => {
      const webhookUrl = 'http://localhost:3001/api/webhook';

      const payload = {
        title: generatedArticle.title,
        content: generatedArticle.content,
        category: generatedArticle.category,
        articleId: generatedArticle.articleId
      };

      logger.info(`📤 [${getTimestamp()}] Sending webhook (attempt ${attempt}): ${generatedArticle.title?.substring(0, 40)}...`);

      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Webhook failed with status ${response.status}: ${errorText}`);
        }

        const responseData = await response.json().catch(() => ({}));

        logger.info(`✅ [${getTimestamp()}] Webhook sent successfully: ${generatedArticle.title?.substring(0, 40)}...`);

        return {
          status: response.status,
          response: responseData
        };
      } catch (error) {
        // attempt is 0-indexed: 0 = first try, 1 = first retry, etc.
        if (attempt < RETRY_DELAYS.length) {
          const delay = RETRY_DELAYS[attempt];
          logger.warn(`❌ [${getTimestamp()}] Webhook failed (attempt ${attempt + 1}). Retrying in ${delay}...`);
          throw new RetryAfterError(`Webhook failed: ${error.message}`, delay);
        } else {
          // All retries exhausted, throw regular error
          logger.error(`❌ [${getTimestamp()}] Webhook failed after all retries. Giving up.`);
          throw error;
        }
      }
    });

    return {
      status: 'success',
      generatedArticleId,
      articleId,
      webhookStatus: webhookResult.status
    };
  }
);

export default sendWebhook;

