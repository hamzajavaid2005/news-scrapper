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
        dispatchedCount: events.length,
        sources: sources.map(s => ({ id: s.id, name: s.name }))
      };
    });

    return {
      message: "RSS trigger completed",
      ...dispatchResults
    };
  }
);

export default rssTrigger;
