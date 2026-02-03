import { inngest } from './client.js';
import { prisma, connectDB } from '../prisma.js';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

/*
 * RSS Trigger Function
 * this function gets all active resources from db and dispatches them to rss/trigger event
 */
export const rssTrigger = inngest.createFunction(
  {
    id: "news/scheduler-dispatch-feeds-every-1min",
    retries: 2,
    concurrency: { limit: 1 }
  },
  { cron: "*/15 * * * *" },
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
    };
  }
);

export default rssTrigger;
