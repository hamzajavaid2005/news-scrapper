import { inngest } from './client.js';
import { prisma, connectDB } from '../prisma.js';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

/**
 * Pipeline Status Notification Function
 * 
 * Triggered when the RSS scheduler completes (success or failure).
 * Logs a summary of the pipeline run and can be extended to send notifications.
 * 
 * Triggered by: pipeline/scheduler.completed event
 */
export const pipelineStatus = inngest.createFunction(
  {
    id: "news/pipeline-status-notification",
    retries: 1,
    concurrency: { limit: 1 }
  },
  { event: "pipeline/scheduler.completed" },
  async ({ event, step, logger }) => {
    const { 
      status, 
      sourcesDispatched, 
      triggeredAt, 
      sources,
      error 
    } = event.data;

    // Step 1: Log the pipeline status
    const statusResult = await step.run("log-pipeline-status", async () => {
      await connectDB();
      
      const timestamp = getTimestamp();
      
      if (status === 'success') {
        console.log('');
        console.log('╔' + '═'.repeat(50) + '╗');
        console.log('║' + '  ✅ PIPELINE RUN COMPLETED SUCCESSFULLY'.padEnd(50) + '║');
        console.log('╠' + '═'.repeat(50) + '╣');
        console.log('║' + `  Time: ${timestamp}`.padEnd(50) + '║');
        console.log('║' + `  Sources Checked: ${sourcesDispatched}`.padEnd(50) + '║');
        console.log('╚' + '═'.repeat(50) + '╝');
        console.log('');
        
        return {
          message: `Pipeline completed successfully at ${timestamp}`,
          status: 'success',
          sourcesChecked: sourcesDispatched
        };
      } else {
        console.log('');
        console.log('╔' + '═'.repeat(50) + '╗');
        console.log('║' + '  ❌ PIPELINE RUN FAILED'.padEnd(50) + '║');
        console.log('╠' + '═'.repeat(50) + '╣');
        console.log('║' + `  Time: ${timestamp}`.padEnd(50) + '║');
        console.log('║' + `  Error: ${error?.substring(0, 40) || 'Unknown'}`.padEnd(50) + '║');
        console.log('╚' + '═'.repeat(50) + '╝');
        console.log('');
        
        return {
          message: `Pipeline failed at ${timestamp}: ${error}`,
          status: 'failed',
          error: error
        };
      }
    });

    // Step 2: Get pipeline statistics (optional - provides more context)
    const stats = await step.run("get-pipeline-stats", async () => {
      await connectDB();
      
      // Get counts from the last hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      
      const [
        totalArticles,
        pendingArticles,
        scrapedArticles,
        generatedArticles,
        failedArticles
      ] = await Promise.all([
        prisma.article.count({ where: { discoveredAt: { gte: oneHourAgo } } }),
        prisma.article.count({ where: { status: 'pending', discoveredAt: { gte: oneHourAgo } } }),
        prisma.article.count({ where: { status: 'scraped', discoveredAt: { gte: oneHourAgo } } }),
        prisma.generatedArticle.count({ where: { generatedAt: { gte: oneHourAgo } } }),
        prisma.article.count({ where: { status: 'failed', discoveredAt: { gte: oneHourAgo } } })
      ]);

      return {
        period: 'last_hour',
        totalArticles,
        pendingArticles,
        scrapedArticles,
        generatedArticles,
        failedArticles
      };
    });

    return {
      message: statusResult.message,
      status: statusResult.status,
      triggeredAt,
      sourcesDispatched,
      statistics: stats,
      sources: sources?.map(s => s.name) || []
    };
  }
);

export default pipelineStatus;
