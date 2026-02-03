import { inngest } from './client.js';
import { prisma, connectDB } from '../prisma.js';
import { RSSDiscovery } from '../discovery.js';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

/**
 * Fetch RSS Feed Function
 * 
 * Handles a single RSS feed URL. Parses the feed, discovers new articles,
 * creates pending entries in DB, and triggers scraping.
 * 
 * Triggered by: rss/trigger event
 * Emits: article/unique.found event for each new article
 */
export const fetchRssFeed = inngest.createFunction(
  {
    id: "news/fetch-and-parse-rss-feed",
    retries: 3,
    concurrency: { limit: 10 } // Allow 10 parallel feed fetches
  },
  { event: "rss/trigger" },
  async ({ event, step, logger }) => {
    const { sourceId, feedUrl, sourceName } = event.data;

    logger.info(`[${getTimestamp()}] 📡 Fetching RSS: ${sourceName}`);
    logger.info(`   Feed URL: ${feedUrl}`);

    // Step 1: Fetch, parse RSS feed, and create pending articles in DB
    const newArticles = await step.run("fetch-and-create-pending", async () => {
      await connectDB();
      
      const rss = new RSSDiscovery();
      
      try {
        const feed = await rss.fetchFeed(feedUrl);
        
        // Get all article links from the feed
        const articleLinks = feed.items.map(item => item.link);
        
        // Filter out already existing URLs
        const newUrls = await rss.filterNewUrls(articleLinks);
        
        // Get only new items with valid data
        const newItems = feed.items
          .filter(item => newUrls.includes(item.link))
          .filter(item => item.link?.trim() && item.title?.trim());

        // Create pending articles in DB
        const createdArticles = [];
        
        for (const item of newItems) {
          try {
            const article = await prisma.article.create({
              data: {
                url: item.link.trim(),
                sourceId: sourceId,
                title: item.title.trim(),
                excerpt: item.content ?? '',
                byline: item.author ?? '',
                status: 'pending',
                discoveredAt: item.pubDate ? new Date(item.pubDate) : new Date()
              }
            });
            
            createdArticles.push({
              articleId: article.id,
              url: article.url,
              title: article.title
            });
            
            logger.info(`[${getTimestamp()}] ✓ Created pending: ${article.title?.substring(0, 40)}...`);
          } catch (error) {
            // Handle unique constraint violation (race condition)
            if (error.code === 'P2002') {
              logger.info(`[${getTimestamp()}] Article already exists: ${item.title?.substring(0, 40)}...`);
            } else {
              logger.warn(`[${getTimestamp()}] Failed to create article: ${error.message}`);
            }
          }
        }

        // Update source last checked time
        await prisma.source.update({
          where: { id: sourceId },
          data: { lastCheckedAt: new Date() }
        });

        logger.info(`[${getTimestamp()}] ${sourceName}: Created ${createdArticles.length} pending articles`);
        
        return createdArticles;
      } catch (error) {
        logger.error(`[${getTimestamp()}] Failed to fetch ${sourceName}: ${error.message}`);
        throw error;
      }
    });

    // Always log article count (even if 0)
    console.log(`   📰 ${sourceName}: ${newArticles.length} articles to scrape`);

    if (newArticles.length === 0) {
      return { 
        message: `No new articles found in ${sourceName}. All articles already exist in database.`, 
        status: 'success',
        sourceName,
        feedUrl,
        articlesFound: 0,
        articlesCreated: 0,
        nextStep: 'none (no new articles)'
      };
    }


    // Step 2: Dispatch scrape events for each new article
    // Step 2: Dispatch scrape events for each new article
    const events = newArticles.map(article => ({
      name: 'article/unique.found',
      data: {
        articleId: article.articleId,
        sourceId,
        sourceName,
        articleUrl: article.url,
        title: article.title
      }
    }));

    // Send all events using step.sendEvent (works with Inngest execution context)
    await step.sendEvent("dispatch-scrape-events", events);
    
    const dispatchResults = {
      message: `Dispatched ${events.length} articles for scraping`,
      dispatchedCount: events.length,
      articles: newArticles.map(a => ({
        id: a.articleId,
        title: a.title?.substring(0, 50) + '...',
        url: a.url
      }))
    };

    return {
      message: `Found ${newArticles.length} new article(s) in ${sourceName}. Dispatched for content scraping.`,
      status: 'success',
      sourceName,
      feedUrl,
      articlesCreated: newArticles.length,
      ...dispatchResults,
      nextStep: 'scrapeContent (for each article)'
    };
  }
);

export default fetchRssFeed;
