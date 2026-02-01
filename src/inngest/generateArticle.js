import { inngest } from './client.js';
import { prisma, connectDB } from '../prisma.js';
import { generateArticleContent } from '../lib/ai.js';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

/**
 * Generate AI article from scraped content
 * Triggered when an article is successfully scraped
 */
export const generateArticle = inngest.createFunction(
  {
    id: "generate-article",
    retries: 2,
    concurrency: { limit: 3 } // Allow 3 parallel generations
  },
  { event: "article/scraped" },
  async ({ event, step, logger }) => {
    const { articleId, title, sourceName } = event.data;

    // Connect to database
    await step.run("connect-db", async () => {
      await connectDB();
    });

    // Fetch the article
    const article = await step.run("fetch-article", async () => {
      const art = await prisma.article.findUnique({
        where: { id: articleId },
        include: { source: true }
      });
      
      if (!art) {
        throw new Error(`Article not found: ${articleId}`);
      }
      
      return art;
    });

    // Check if already generated
    const existing = await step.run("check-existing", async () => {
      return prisma.generatedArticle.findUnique({
        where: { articleId }
      });
    });

    if (existing) {
      logger.info(`Article already generated: ${title}`);
      return { status: 'skipped', reason: 'already_generated' };
    }

    // Generate AI content
    const generated = await step.run("generate-content", async () => {
      logger.info(`🤖 [${getTimestamp()}] Generating: ${title?.substring(0, 50)}...`);
      
      const result = await generateArticleContent({
        title: article.title,
        textContent: article.textContent
      });

      if (!result) {
        throw new Error('AI generation returned null');
      }

      return result;
    });

    // Save to database
    await step.run("save-generated", async () => {
      await prisma.generatedArticle.create({
        data: {
          articleId,
          title: generated.title,
          content: generated.content,
          category: generated.category,
          status: 'generated',
          generatedAt: new Date()
        }
      });

      logger.info(`✨ [${getTimestamp()}] Generated [${generated.category}]: ${generated.title?.substring(0, 40)}...`);
    });

    return {
      status: 'success',
      articleId,
      category: generated.category,
      generatedTitle: generated.title
    };
  }
);

export default generateArticle;
