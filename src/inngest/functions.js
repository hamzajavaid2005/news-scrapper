import { inngest } from './client.js';
import { RSSDiscovery } from '../discovery.js';
import { scrapeNewsArticle } from '../scraper.js';
import { Article, Source, connectDB } from '../db/index.js';

/**
 * Scheduled news scraping function
 * Runs every 10 minutes with retry logic
 */
export const scrapeNewsCycle = inngest.createFunction(
  { 
    id: "scrape-news-cycle",
    retries: 3  // Retry failed steps up to 3 times
  },
  { cron: "*/10 * * * *" },  // Every 10 minutes
  async ({ step, logger }) => {
    
    // Connect to database
    await step.run("connect-db", async () => {
      await connectDB();
      logger.info("Connected to MongoDB");
    });

    // Get all active sources
    const sources = await step.run("get-sources", async () => {
      const sources = await Source.find({ active: true });
      logger.info(`Found ${sources.length} active sources`);
      return sources.map(s => ({ 
        _id: s._id.toString(), 
        name: s.name, 
        feedUrl: s.feedUrl 
      }));
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
        logger.info(`Discovering: ${source.name}`);
        
        try {
          const feed = await rss.fetchFeed(source.feedUrl);
          const newUrls = await rss.filterNewUrls(feed.items.map(i => i.link));
          
          // Only keep new items
          const newItems = feed.items.filter(i => newUrls.includes(i.link));
          
          // Save to database as pending
          for (const item of newItems) {
            try {
              await Article.create({
                url: item.link,
                sourceId: source._id,
                title: item.title,
                excerpt: item.content,
                byline: item.author,
                status: 'pending',
                discoveredAt: item.pubDate || new Date()
              });
            } catch (error) {
              if (error.code !== 11000) throw error; // Ignore duplicates
            }
          }

          // Update last checked time
          await Source.findByIdAndUpdate(source._id, { lastCheckedAt: new Date() });

          logger.info(`${source.name}: Found ${newItems.length} new articles`);
          return newItems.map(item => ({
            link: item.link,
            title: item.title,
            content: item.content,
            sourceId: source._id,
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
      const pending = await Article.find({ status: 'pending' }).populate('sourceId');
      logger.info(`Loaded ${pending.length} pending articles from DB`);
      return pending.map(a => ({
        link: a.url,
        title: a.title,
        content: a.excerpt,
        sourceId: a.sourceId?._id?.toString(),
        sourceName: a.sourceId?.name || 'Unknown'
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
        logger.info(`[${i + 1}/${allItems.length}] Scraping: ${item.title?.substring(0, 40)}...`);
        
        try {
          const articleData = await scrapeNewsArticle(item.link);

          await Article.findOneAndUpdate(
            { url: item.link },
            {
              title: articleData.title || item.title,
              textContent: articleData.textContent,
              excerpt: articleData.excerpt || item.content,
              byline: articleData.byline,
              siteName: articleData.siteName,
              status: 'scraped',
              scrapedAt: new Date()
            }
          );

          await Source.findByIdAndUpdate(item.sourceId, {
            $inc: { totalArticles: 1 }
          });

          logger.info(`✓ Scraped: ${item.title?.substring(0, 40)} (${articleData.textContent?.length || 0} chars)`);
          return { success: true, url: item.link, chars: articleData.textContent?.length || 0 };

        } catch (error) {
          logger.error(`✗ Failed: ${item.title?.substring(0, 40)} - ${error.message}`);
          
          await Article.findOneAndUpdate(
            { url: item.link },
            { status: 'failed', errorMessage: error.message }
          );
          
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
        await step.sleep("delay-between-articles", "5s");
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
    // Reuse the same logic as scheduled scrape
    // This event can be sent via the Inngest dashboard or API
    return { message: "Manual scrape started" };
  }
);

// Export all functions
export const functions = [scrapeNewsCycle, manualScrape];
