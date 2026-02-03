import { inngest } from './client.js';
import { prisma, connectDB } from '../prisma.js';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

/**
 * RSS Trigger Function
 * 
 * Runs every 5 minutes and dispatches each active RSS feed URL
 * as a separate event to be processed independently.
 */
export const rssTrigger = inngest.createFunction(
  {
    id: "news/scheduler-dispatch-feeds-every-2min",
    retries: 2,
    concurrency: { limit: 1 } // Only one trigger at a time
  },
  { cron: "*/2 * * * *" }, // Every 2 minutes
  async ({ step, logger }) => {
    
    // Step 1: Get all active sources from the database
    const sources = await step.run("get-active-sources", async () => {
      await connectDB();
      const activeSources = await prisma.source.findMany({
        where: { active: true }
      });
      logger.info(`[${getTimestamp()}] Found ${activeSources.length} active sources`);
      return activeSources;
    });

    if (sources.length === 0) {
      logger.info(`[${getTimestamp()}] No active sources found, skipping...`);
      return { message: "No active sources found", dispatchedCount: 0 };
    }

    // Step 2: Dispatch an event for each RSS feed URL
    const dispatchResults = await step.run("dispatch-rss-events", async () => {
      const events = sources.map(source => ({
        name: 'rss/trigger',
        data: {
          sourceId: source.id,
          feedUrl: source.feedUrl,
          sourceName: source.name
        }
      }));

      // Send all events in a batch
      await inngest.send(events);
      
      console.log('');
      console.log('═'.repeat(50));
      console.log(`📡 RSS SCHEDULER - ${getTimestamp()}`);
      console.log('═'.repeat(50));
      console.log(`   Sources to check: ${events.length}`);
      sources.forEach(s => console.log(`   • ${s.name}`));
      console.log('═'.repeat(50));
      
      return {
        message: `Dispatched ${events.length} RSS feed fetch events. Each source will be checked for new articles in parallel.`,
        dispatchedCount: events.length,
        triggeredAt: new Date().toISOString(),
        sources: sources.map(s => ({ 
          id: s.id, 
          name: s.name,
          feedUrl: s.feedUrl,
          lastCheckedAt: s.lastCheckedAt
        })),
        nextStep: 'fetchRssFeed (for each source)'
      };
    });

    return {
      message: `RSS Scheduler completed. Dispatched ${dispatchResults.dispatchedCount} feed fetch events. Check 'news/fetch-and-parse-rss-feed' runs for article counts.`,
      status: 'success',
      ...dispatchResults,
      pipeline: {
        step1: 'rssTrigger ✓ (current)',
        step2: 'fetchRssFeed → discovers new articles',
        step3: 'scrapeContent → extracts article text',
        step4: 'generateEmbedding → creates AI vector',
        step5: 'checkDuplicate → filters similar articles',
        step6: 'saveArticle → finalizes in database',
        step7: 'generateArticle → AI rewrites content',
        step8: 'sendWebhook → delivers to destinations'
      }
    };
  }
);

export default rssTrigger;
