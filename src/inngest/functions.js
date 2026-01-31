import { inngest } from './client.js';
import { RSSDiscovery } from '../discovery.js';
import { scrapeNewsArticle } from '../scraper.js';
import { prisma, connectDB } from '../prisma.js';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

/**
 * Scheduled news scraping function
 * Runs every 10 minutes with retry logic
 */
export const scrapeNewsCycle = inngest.createFunction(
  { 
    id: "scrape-news-cycle",
    retries: 3,  // Retry failed steps up to 3 times
    concurrency: 1 // STRICTLY ONE AT A TIME
  },
  { cron: "*/10 * * * *" },  // Every 10 minutes
  async ({ step, logger }) => {
    
    // Connect to database
    await step.run("connect-db", async () => {
      await connectDB();
      logger.info("Connected to Supabase");
    });

    // Get all active sources
    const sources = await step.run("get-sources", async () => {
      const sources = await prisma.source.findMany({
        where: { active: true }
      });
      logger.info(`Found ${sources.length} active sources`);
      return sources;
    });

    if (sources.length === 0) {
      return { message: "No active sources found" };
    }

    const rss = new RSSDiscovery();
    let totalScraped = 0;
    let totalFailed = 0;

    // Phase 1: Discover new articles from all RSS feeds
    const allNewItems = [];
    
    for (const source of sources) {
      const items = await step.run(`discover-${source.name}`, async () => {
        logger.info(`[${getTimestamp()}] Discovering: ${source.name}`);
        
        try {
          const feed = await rss.fetchFeed(source.feedUrl);
          const newUrls = await rss.filterNewUrls(feed.items.map(i => i.link));
          
          // Only keep new items
          const newItems = feed.items.filter(i => newUrls.includes(i.link));
          
          // Save to database as pending
          for (const item of newItems) {
            try {
              await prisma.article.create({
                data: {
                  url: item.link,
                  sourceId: source.id,
                  title: item.title,
                  excerpt: item.content,
                  byline: item.author,
                  status: 'pending',
                  discoveredAt: item.pubDate || new Date()
                }
              });
            } catch (error) {
              // Ignore unique constraint violations
              if (!error.code?.includes('P2002')) throw error;
            }
          }

          // Update last checked time
          await prisma.source.update({
            where: { id: source.id },
            data: { lastCheckedAt: new Date() }
          });

          logger.info(`${source.name}: Found ${newItems.length} new articles`);
          return newItems.map(item => ({
            link: item.link,
            title: item.title,
            content: item.content,
            sourceId: source.id,
            sourceName: source.name
          }));
        } catch (error) {
          logger.error(`Failed to discover ${source.name}: ${error.message}`);
          return [];
        }
      });

      allNewItems.push(...items);
    }

    // Also load pending articles from database
    const pendingFromDB = await step.run("load-pending", async () => {
      const pending = await prisma.article.findMany({
        where: { status: 'pending' },
        include: { source: true }
      });
      logger.info(`Loaded ${pending.length} pending articles from DB`);
      return pending.map(a => ({
        link: a.url,
        title: a.title,
        content: a.excerpt,
        sourceId: a.sourceId,
        sourceName: a.source?.name || 'Unknown'
      }));
    });

    // Combine new and pending (avoid duplicates)
    const allItems = [...allNewItems];
    for (const item of pendingFromDB) {
      if (!allItems.some(i => i.link === item.link)) {
        allItems.push(item);
      }
    }

    logger.info(`Total articles to scrape: ${allItems.length}`);

    if (allItems.length === 0) {
      return { message: "No new articles to scrape", totalScraped: 0 };
    }

    // Phase 2: Scrape articles with retry (each is a separate step)
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      
      const result = await step.run(`scrape-article-${i}`, async () => {
        // Log removed to reduce noise
        
        try {
          const articleData = await scrapeNewsArticle(item.link);

          await prisma.article.update({
            where: { url: item.link },
            data: {
              title: articleData.title || item.title,
              textContent: articleData.textContent,
              excerpt: articleData.excerpt || item.content,
              byline: articleData.byline,
              siteName: articleData.siteName,
              status: 'scraped',
              scrapedAt: new Date()
            }
          });

          await prisma.source.update({
            where: { id: item.sourceId },
            data: { totalArticles: { increment: 1 } }
          });

          const remaining = allItems.length - (i + 1);
          logger.info(`✓ [${getTimestamp()}] [${item.sourceName}] Scraped: ${item.title?.substring(0, 30)}... [${remaining} remaining]`);
          return { success: true, url: item.link, chars: articleData.textContent?.length || 0 };

        } catch (error) {
          const remaining = allItems.length - (i + 1);
          const isBlocked = error.message.includes('403') || error.message.includes('Forbidden');
          const errorMsg = isBlocked ? 'Blocked (403)' : error.message;
          const logType = isBlocked ? 'warn' : 'error';
          
          logger[logType](`✗ [${getTimestamp()}] [${item.sourceName}] ${errorMsg}: ${item.title?.substring(0, 30)}... [${remaining} remaining]`);
          
          await prisma.article.update({
            where: { url: item.link },
            data: { status: 'failed', errorMessage: error.message }
          });
          
          return { success: false, url: item.link, error: error.message };
        }
      });

      if (result.success) {
        totalScraped++;
      } else {
        totalFailed++;
      }

      // 5-second delay between articles (except last one)
      if (i < allItems.length - 1) {
        await step.sleep(`delay-between-articles-${i}`, "5s");
      }
    }

    return {
      message: "Scrape cycle complete",
      totalScraped,
      totalFailed,
      totalProcessed: allItems.length
    };
  }
);

/**
 * Manual trigger function - scrape immediately
 */
export const manualScrape = inngest.createFunction(
  { id: "manual-scrape", retries: 2 },
  { event: "news/scrape.manual" },
  async ({ step, logger }) => {
    logger.info("Manual scrape triggered");
    return { message: "Manual scrape started" };
  }
);

// Export all functions
export const functions = [scrapeNewsCycle, manualScrape];
