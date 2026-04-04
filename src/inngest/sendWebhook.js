import { inngest } from './client.js';
import { prisma, connectDB } from '../prisma.js';
import { RetryAfterError } from 'inngest';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

// Custom retry delays: 2 minutes, 15 minutes, 1 hour
const RETRY_DELAYS = ['2m', '15m', '1h'];

/**
 * Send generated article to all active webhooks from database
 * Triggered when an AI article is successfully generated and saved
 * RETRY SCHEDULE: 2 minutes → 15 minutes → 1 hour → give up
 */
export const sendWebhook = inngest.createFunction(
  {
    id: "news/send-to-webhooks",
    retries: 3,
    concurrency: { limit: 20 }
  },
  { event: "article/generated" },
  async ({ event, step, logger, attempt }) => {
    const { generatedArticleId, articleId } = event.data;

    // Step 1: Fetch the generated article AND all active webhooks
    const { generatedArticle, webhooks } = await step.run("fetch-data", async () => {
      await connectDB();
      
      const [article, activeWebhooks] = await Promise.all([
        prisma.generatedArticle.findUnique({
          where: { id: generatedArticleId },
          include: { article: true }
        }),
        prisma.webhook.findMany({
          where: { active: true }
        })
      ]);

      if (!article) {
        throw new Error(`Generated article not found: ${generatedArticleId}`);
      }

      return { generatedArticle: article, webhooks: activeWebhooks };
    });

    if (webhooks.length === 0) {
      logger.warn(`⚠️ [${getTimestamp()}] No active webhooks found. Skipping.`);
      return { status: 'skipped', reason: 'no_active_webhooks' };
    }

    logger.info(`📤 [${getTimestamp()}] Sending to ${webhooks.length} webhook(s): ${generatedArticle.title?.substring(0, 40)}...`);

    // Step 2: Send to all webhooks
    const results = await step.run("send-to-webhooks", async () => {
      const payload = {
        title: generatedArticle.title,
        content: generatedArticle.content,
        category: generatedArticle.category,  // RSS feed category (not AI-generated)
        articleId: generatedArticle.articleId
      };

      const webhookResults = [];

      for (const webhook of webhooks) {
        try {
          const headers = {
            'Content-Type': 'application/json',
          };

          // Add secret header if webhook has a secret
          if (webhook.secret) {
            headers['X-Webhook-Secret'] = webhook.secret;
          }

          const response = await fetch(webhook.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            const errorText = await response.text();
            webhookResults.push({
              webhookId: webhook.id,
              name: webhook.name,
              success: false,
              error: `HTTP ${response.status}: ${errorText}`
            });
            logger.warn(`❌ [${getTimestamp()}] Webhook "${webhook.name}" failed: HTTP ${response.status}`);
          } else {
            webhookResults.push({
              webhookId: webhook.id,
              name: webhook.name,
              success: true,
              status: response.status
            });
            logger.info(`✅ [${getTimestamp()}] Webhook "${webhook.name}" sent successfully`);
          }
        } catch (error) {
          webhookResults.push({
            webhookId: webhook.id,
            name: webhook.name,
            success: false,
            error: error.message
          });
          logger.warn(`❌ [${getTimestamp()}] Webhook "${webhook.name}" failed: ${error.message}`);
        }
      }

      // Check if ALL webhooks failed
      const allFailed = webhookResults.every(r => !r.success);
      
      if (allFailed && webhookResults.length > 0) {
        // Retry with custom delay if all webhooks failed
        if (attempt < RETRY_DELAYS.length) {
          const delay = RETRY_DELAYS[attempt];
          logger.warn(`❌ [${getTimestamp()}] All webhooks failed (attempt ${attempt + 1}). Retrying in ${delay}...`);
          throw new RetryAfterError(`All webhooks failed`, delay);
        } else {
          logger.error(`❌ [${getTimestamp()}] All webhooks failed after all retries. Giving up.`);
          throw new Error('All webhooks failed after retries');
        }
      }

      return webhookResults;
    });

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return {
      status: 'completed',
      generatedArticleId,
      articleId,
      webhooksSent: successCount,
      webhooksFailed: failCount,
      results
    };
  }
);

export default sendWebhook;
