import { inngest } from './client.js';
import { prisma, connectDB } from '../prisma.js';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

/**
 * RSS Trigger Function
 * 
 * Runs every 1 minute and dispatches each active RSS feed URL
 * as a separate event to be processed independently.
 */
export const rssTrigger = inngest.createFunction(
  {
    id: "news/scheduler-dispatch-feeds-every-1min",
    retries: 2,
    concurrency: { limit: 1 } // Only one trigger at a time
  },
  { cron: "*/1 * * * *" }, // Every 1 minute
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

    // Step 2: Build events and dispatch using step.sendEvent
    const events = sources.map(source => ({
      name: 'rss/trigger',
      data: {
        sourceId: source.id,
        feedUrl: source.feedUrl,
        sourceName: source.name
      }
    }));

    // Log the sources being checked
    console.log('');
    console.log('═'.repeat(50));
    console.log(`📡 RSS SCHEDULER - ${getTimestamp()}`);
    console.log('═'.repeat(50));
    console.log(`   Sources to check: ${events.length}`);
    sources.forEach(s => console.log(`   • ${s.name}`));
    console.log('═'.repeat(50));

    // Send all events using step.sendEvent (works with Inngest execution context)
    await step.sendEvent("dispatch-rss-events", events);

    return {
      message: `RSS Scheduler completed. Dispatched ${events.length} feed fetch events.`,
      status: 'success',
      dispatchedCount: events.length,
      sources: sources.map(s => s.name),
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
