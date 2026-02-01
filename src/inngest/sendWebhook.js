import { inngest } from './client.js';
import { prisma, connectDB } from '../prisma.js';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

/**
 * Send generated article to webhook
 * Triggered when an AI article is successfully generated and saved
 */
export const sendWebhook = inngest.createFunction(
  {
    id: "send-webhook",
    retries: 3,
    concurrency: { limit: 5 }
  },
  { event: "article/generated" },
  async ({ event, step, logger }) => {
    const { generatedArticleId, articleId } = event.data;

    // Connect to database
    await step.run("connect-db", async () => {
      await connectDB();
    });

    // Fetch the generated article from database
    const generatedArticle = await step.run("fetch-generated-article", async () => {
      const article = await prisma.generatedArticle.findUnique({
        where: { id: generatedArticleId },
        include: { article: true }
      });

      if (!article) {
        throw new Error(`Generated article not found: ${generatedArticleId}`);
      }

      return article;
    });

    // Send to webhook
    const webhookResult = await step.run("send-to-webhook", async () => {
      const webhookUrl = 'http://localhost:3001/api/webhook';

      const payload = {
        title: generatedArticle.title,
        content: generatedArticle.content,
        category: generatedArticle.category,
        articleId: generatedArticle.articleId
      };

      logger.info(`📤 [${getTimestamp()}] Sending webhook for: ${generatedArticle.title?.substring(0, 40)}...`);

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

      logger.info(`✅ [${getTimestamp()}] Webhook sent successfully for: ${generatedArticle.title?.substring(0, 40)}...`);

      return {
        status: response.status,
        response: responseData
      };
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
