import { inngest } from './client.js';
import { RSSDiscovery } from '../discovery.js';
import { scrapeNewsArticle } from '../scraper.js';
import { prisma, connectDB } from '../prisma.js';
import { generateEmbedding } from '../lib/ai.js';
import { findSimilarArticles } from '../lib/vector.js';

const getTimestamp = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

/**
 * Scheduled news scraping function
 * Runs every 10 minutes with retry logic
 */
export const scrapeNewsCycle = inngest.createFunction(
  { 
    id: "scrape-news-cycle-v2",  // Changed to force fresh runs
    retries: 3,  // Retry failed steps up to 3 times
    concurrency: { limit: 1 } // STRICTLY ONE AT A TIME
  },
  { cron: "*/3 * * * *" },  // Every 10 minutes
  async ({ step, logger }) => {
    
    // Connect to database
    await step.run("connect-db", async () => {
      await connectDB();
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
            // Validate required fields strictly
            const itemUrl = item.link?.trim();
            const itemTitle = item.title?.trim();
            const itemSourceId = source.id;
            
            // Skip items without required fields
            if (!itemUrl || !itemTitle || !itemSourceId) {
              logger.warn(`Skipping article with missing required fields from ${source.name}: url=${!!itemUrl}, title=${!!itemTitle}, sourceId=${!!itemSourceId}`);
              continue;
            }
            
            try {
              await prisma.article.create({
                data: {
                  url: itemUrl,
                  sourceId: itemSourceId,
                  title: itemTitle,
                  excerpt: item.content ?? '',
                  byline: item.author ?? '',
                  status: 'pending',
                  discoveredAt: item.pubDate ?? new Date()
                }
              });
            } catch (error) {
              // Ignore unique constraint violations and null constraint errors
              // P2002 = unique constraint, P2011 = null constraint
              if (error.code !== 'P2002' && error.code !== 'P2011') {
                logger.warn(`Failed to save article from ${source.name}: ${error.message}`);
              }
              // Continue to next item instead of failing the whole discovery
            }
          }

          // Update last checked time
          await prisma.source.update({
            where: { id: source.id },
            data: { lastCheckedAt: new Date() }
          });

          logger.info(`${source.name}: Found ${newItems.length} new articles`);
          
          // Only return items with valid links and titles (with trimming)
          return newItems
            .filter(item => item.link?.trim() && item.title?.trim() && source.id)
            .map(item => ({
              link: item.link.trim(),
              title: item.title.trim(),
              content: item.content ?? '',
              sourceId: source.id,
              sourceName: source.name ?? 'Unknown'
            }));
        } catch (error) {
          logger.error(`Failed to discover ${source.name}: ${error.message}`);
          return [];
        }
      });

      allNewItems.push(...items);
    }

    // Also load pending articles from database (LIMIT 50 to prevent overrun)
    const pendingFromDB = await step.run("load-pending", async () => {
      const pending = await prisma.article.findMany({
        where: { status: 'pending' },
        take: 100, // Limit to 100 articles per run
        orderBy: { discoveredAt: 'desc' }, // Newest first
        include: { source: true }
      });
      // Filter out any articles with missing required fields
      return pending
        .filter(a => a.url && a.title && a.sourceId && a.source)
        .map(a => ({
          link: a.url,
          title: a.title,
          content: a.excerpt ?? '',
          sourceId: a.sourceId,
          sourceName: a.source?.name ?? 'Unknown'
        }));
    });

    // Combine new and pending (avoid duplicates)
    // Use pending URLs as the base to avoid re-processing articles that were just discovered
    const pendingUrls = new Set(pendingFromDB.map(p => p.link));
    
    // Filter out newly discovered items that are already pending in DB
    const trulyNewItems = allNewItems.filter(item => !pendingUrls.has(item.link));
    
    // Start with pending items (they have priority), then add truly new ones
    const allItems = [...pendingFromDB, ...trulyNewItems];

    logger.info(`Total articles to scrape: ${allItems.length}`);

    if (allItems.length === 0) {
      return { message: "No new articles to scrape", totalScraped: 0 };
    }

    // Phase 2: Scrape articles with retry (each is a separate step)
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      
      const result = await step.run(`scrape-article-${i}`, async () => {
        try {
          const articleData = await scrapeNewsArticle(item.link);
          const fullText = `${articleData.title} ${articleData.excerpt || ''} ${articleData.textContent || ''}`;

          
          // Generate embedding for deduplication
          let embedding = null;
          try {
            embedding = await generateEmbedding(fullText);
          } catch (e) {
            logger.warn(`Failed to generate embedding for ${item.link}: ${e.message}`);
          }

          let isDuplicate = false;
          let duplicateOf = null;

          if (embedding) {
            const similar = await findSimilarArticles(embedding, 0.85); // 0.85 threshold
            if (similar.length > 0 && similar[0].url !== item.link) {
              isDuplicate = true;
              duplicateOf = similar[0];
            }
          }

          if (isDuplicate) {
            const remaining = allItems.length - (i + 1);
            console.log(`🔄 [${getTimestamp()}] [${item.sourceName}] DUPLICATE (${(duplicateOf.similarity * 100).toFixed(0)}%): ${item.title?.substring(0, 40)}...`);
            console.log(`   └─ Similar to [${duplicateOf.sourceName || 'Unknown'}]: ${duplicateOf.title?.substring(0, 45)}...`);
            
            // Validate required fields before upsert
            if (!item.link || !item.sourceId) {
              logger.warn(`Skipping duplicate article with missing required fields: url=${!!item.link}, sourceId=${!!item.sourceId}`);
              return { success: false, status: 'skipped', reason: 'missing_required_fields' };
            }
            
            await prisma.article.upsert({
              where: { url: item.link },
              update: {
                status: 'duplicate',
                errorMessage: `Duplicate of ${duplicateOf.url}`,
                scrapedAt: new Date()
              },
              create: {
                url: item.link,
                sourceId: item.sourceId,
                title: item.title ?? 'Duplicate',
                status: 'duplicate',
                errorMessage: `Duplicate of ${duplicateOf.url}`,
                scrapedAt: new Date()
              }
            });
            return { success: true, status: 'duplicate' };
          }

          // Validate required fields before upsert
          if (!item.link || !item.sourceId) {
            logger.warn(`Skipping article with missing required fields: url=${!!item.link}, sourceId=${!!item.sourceId}`);
            return { success: false, url: item.link, error: 'missing_required_fields' };
          }
          
          // Determine final title with proper fallback
          const finalTitle = (articleData.title?.trim() || item.title?.trim() || 'Untitled');
          
          // Save unique article (using upsert in case it doesn't exist)
          const savedArticle = await prisma.article.upsert({
            where: { url: item.link },
            update: {
              title: finalTitle,
              textContent: articleData.textContent ?? '',
              excerpt: articleData.excerpt ?? item.content ?? '',
              byline: articleData.byline ?? '',
              siteName: articleData.siteName ?? '',
              status: 'scraped',
              scrapedAt: new Date(),
            },
            create: {
              url: item.link,
              sourceId: item.sourceId,
              title: finalTitle,
              textContent: articleData.textContent ?? '',
              excerpt: articleData.excerpt ?? item.content ?? '',
              byline: articleData.byline ?? '',
              siteName: articleData.siteName ?? '',
              status: 'scraped',
              scrapedAt: new Date(),
            }
          });
          
          // If Prisma doesn't support writing to Unsupported field directly, we do a second raw update
          if (embedding) {
             const vectorString = `[${embedding.join(',')}]`;
             await prisma.$executeRaw`UPDATE articles SET embedding = ${vectorString}::vector WHERE url = ${item.link}`;
          }

          await prisma.source.update({
            where: { id: item.sourceId },
            data: { totalArticles: { increment: 1 } }
          });

          // Trigger AI article generation
          await inngest.send({
            name: 'article/scraped',
            data: {
              articleId: savedArticle.id,
              title: savedArticle.title,
              sourceName: item.sourceName
            }
          });

          const remaining = allItems.length - (i + 1);
          logger.info(`✓ [${getTimestamp()}] [${item.sourceName}] Scraped: ${item.title?.substring(0, 30)}... [${remaining} remaining]`);
          return { success: true, url: item.link, articleId: savedArticle.id, chars: articleData.textContent?.length || 0 };

        } catch (error) {
          const remaining = allItems.length - (i + 1);
          const isBlocked = error.message.includes('403') || error.message.includes('Forbidden');
          const errorMsg = isBlocked ? 'Blocked (403)' : error.message;
          const logType = isBlocked ? 'warn' : 'error';
          
          logger[logType](`✗ [${getTimestamp()}] [${item.sourceName}] ${errorMsg}: ${item.title?.substring(0, 30)}... [${remaining} remaining]`);
          
          // Try to update the article status, ignore if it doesn't exist
          try {
            // Only attempt upsert if we have required fields
            if (item.link && item.sourceId) {
              await prisma.article.upsert({
                where: { url: item.link },
                update: { status: 'failed', errorMessage: error.message },
                create: {
                  url: item.link,
                  sourceId: item.sourceId,
                  title: item.title ?? 'Unknown',
                  status: 'failed',
                  errorMessage: error.message,
                }
              });
            }
          } catch (dbError) {
            // Ignore FK constraint errors - source may have been deleted
          }
          
          return { success: false, url: item.link, error: error.message };
        }
      });

      if (result.success) {
        totalScraped++;
      } else {
        totalFailed++;
      }

      // 10-second delay between articles (except last one)
      if (i < allItems.length - 1) {
        await step.sleep(`delay-between-articles-${i}`, "10s");
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
