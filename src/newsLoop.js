import { RSSDiscovery } from './discovery.js';
import { scrapeNewsArticle } from './scraper.js';
import { Article, Source, connectDB, disconnectDB } from './db/index.js';
import fs from 'fs';
import path from 'path';

// PID file for stop command
const PID_FILE = path.join(process.cwd(), '.news-loop.pid');

/**
 * The News Loop Controller (RSS-based)
 * 
 * Uses RSS feeds for discovery (lightweight, no browser needed)
 * Uses Puppeteer + Readability only for extracting full article content
 */
export class NewsLoop {
  constructor(options = {}) {
    this.rss = new RSSDiscovery(options);
    this.options = options;
    this.isRunning = false;
    this.shouldStop = false;
  }

  /**
   * Add a new RSS feed source
   */
  async addSource(config) {
    const source = new Source({
      name: config.name,
      feedUrl: config.feedUrl,
      baseUrl: config.baseUrl || new URL(config.feedUrl).origin,
      active: true
    });

    await source.save();
    console.log(`✓ Added source: ${config.name}`);
    console.log(`  Feed: ${config.feedUrl}`);
    return source;
  }

  /**
   * Auto-detect and add RSS feed from website URL
   */
  async addSourceFromUrl(websiteUrl, name) {
    console.log(`🔍 Detecting RSS feed for ${websiteUrl}...`);
    
    const result = await RSSDiscovery.detectFeed(websiteUrl);
    
    if (result) {
      console.log(`   Found: ${result.feedUrl}`);
      return await this.addSource({
        name: name || result.title,
        feedUrl: result.feedUrl,
        baseUrl: websiteUrl
      });
    } else {
      console.log(`   ✗ No RSS feed found for ${websiteUrl}`);
      return null;
    }
  }

  /**
   * Remove a source
   */
  async removeSource(nameOrId) {
    const source = await Source.findOneAndDelete({
      $or: [{ _id: nameOrId }, { name: nameOrId }]
    });
    if (source) {
      console.log(`✓ Removed source: ${source.name}`);
      return true;
    }
    return false;
  }

  /**
   * List all configured sources
   */
  async listSources() {
    return await Source.find({});
  }

  /**
   * Discover new articles from a source (RSS only, no scraping)
   */
  async discoverFromSource(source) {
    console.log(`\n📡 Discovering: ${source.name}`);
    console.log(`   Feed: ${source.feedUrl}`);

    try {
      const newItems = await this.rss.discoverNewArticles(source);

      if (newItems.length === 0) {
        console.log(`   ✓ No new articles`);
        return [];
      }

      // Save discovered URLs to database as 'pending'
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
          if (error.code !== 11000) throw error;
        }
      }

      console.log(`   ✓ Found ${newItems.length} new articles`);
      return newItems.map(item => ({ ...item, source }));

    } catch (error) {
      console.log(`   ✗ Error: ${error.message}`);
      return [];
    }
  }

  /**
   * Helper: delay for specified milliseconds
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Run one complete cycle with ROUND-ROBIN fetching
   * 
   * Phase 1: Discover all RSS feeds first
   * Phase 2: Scrape one article from each source in rotation with delays
   */
  async runCycle() {
    console.log('\n' + '═'.repeat(60));
    console.log('🔄 STARTING NEWS CYCLE (RSS-based)');
    console.log('═'.repeat(60));
    
    const startTime = Date.now();
    let totalScraped = 0;
    let totalFailed = 0;

    const sources = await Source.find({ active: true }).sort({ lastCheckedAt: 1 });
    console.log(`\n📋 Found ${sources.length} source(s)`);

    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Discover all RSS feeds first (fast, no scraping)
    // ═══════════════════════════════════════════════════════════════
    console.log('\n' + '─'.repeat(60));
    console.log('📡 PHASE 1: DISCOVERING RSS FEEDS + LOADING PENDING');
    console.log('─'.repeat(60));

    // Store pending items per source: { sourceId: [items] }
    const pendingBySource = {};
    
    // 1. Discover new articles from RSS
    for (const source of sources) {
      if (this.shouldStop) break;
      
      const items = await this.discoverFromSource(source);
      if (items.length > 0) {
        pendingBySource[source._id.toString()] = items;
      }
    }

    // 2. Also load pending articles from database (from previous runs)
    console.log('\n📂 Loading pending articles from database...');
    const pendingFromDB = await Article.find({ status: 'pending' }).populate('sourceId');
    
    if (pendingFromDB.length > 0) {
      console.log(`   ✓ Found ${pendingFromDB.length} pending articles in DB`);
      
      for (const article of pendingFromDB) {
        if (!article.sourceId) continue;
        
        const sourceId = article.sourceId._id.toString();
        const item = {
          title: article.title,
          link: article.url,
          content: article.excerpt,
          author: article.byline,
          source: article.sourceId
        };
        
        if (!pendingBySource[sourceId]) {
          pendingBySource[sourceId] = [];
        }
        
        // Only add if not already in queue (avoid duplicates)
        const exists = pendingBySource[sourceId].some(i => i.link === item.link);
        if (!exists) {
          pendingBySource[sourceId].push(item);
        }
      }
    } else {
      console.log(`   ✓ No pending articles in DB`);
    }

    const totalPending = Object.values(pendingBySource).reduce((sum, items) => sum + items.length, 0);
    const activeSourceIds = Object.keys(pendingBySource);

    if (totalPending === 0) {
      console.log('\n✓ No articles to scrape');
    } else {
      // ═══════════════════════════════════════════════════════════════
      // PHASE 2: Round-robin scraping with delays
      // ═══════════════════════════════════════════════════════════════
      console.log('\n' + '─'.repeat(60));
      console.log('📝 PHASE 2: SCRAPING (ROUND-ROBIN, 5s DELAY)');
      console.log('─'.repeat(60));
      console.log(`   Total articles: ${totalPending}`);
      console.log(`   Active sources: ${activeSourceIds.length}`);
      console.log('');

      let articleIndex = 0;
      let hasMore = true;

      while (hasMore && !this.shouldStop) {
        hasMore = false;

        for (const sourceId of activeSourceIds) {
          if (this.shouldStop) break;

          const items = pendingBySource[sourceId];
          if (!items || items.length === 0) continue;

          // Get and remove the first item from this source's queue
          const item = items.shift();
          if (!item) continue;

          hasMore = hasMore || items.length > 0;
          articleIndex++;

          const sourceName = item.source?.name || 'Unknown';
          console.log(`   [${articleIndex}/${totalPending}] ${sourceName}: ${item.title?.substring(0, 35) || 'Untitled'}...`);

          try {
            const articleData = await scrapeNewsArticle(item.link, this.options);

            await Article.findOneAndUpdate(
              { url: item.link },
              {
                title: articleData.title || item.title,
                textContent: articleData.textContent,
                excerpt: articleData.excerpt || item.content,
                byline: articleData.byline || item.author,
                siteName: articleData.siteName,
                status: 'scraped',
                scrapedAt: new Date()
              }
            );

            await Source.findByIdAndUpdate(item.source._id, {
              $inc: { totalArticles: 1 }
            });

            console.log(`             ✓ Done (${articleData.textContent?.length || 0} chars)`);
            totalScraped++;

          } catch (error) {
            console.log(`             ✗ Failed: ${error.message.substring(0, 40)}...`);
            
            await Article.findOneAndUpdate(
              { url: item.link },
              { status: 'failed', errorMessage: error.message }
            );
            totalFailed++;
          }

          // 5-second delay between articles (unless last one)
          if (!this.shouldStop && (hasMore || items.length > 0)) {
            await this.delay(5000);
          }
        }

        // Check if any source still has items
        hasMore = activeSourceIds.some(id => pendingBySource[id]?.length > 0);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n' + '═'.repeat(60));
    console.log('✅ CYCLE COMPLETE');
    console.log('═'.repeat(60));
    console.log(`   Total Scraped: ${totalScraped}`);
    console.log(`   Total Failed:  ${totalFailed}`);
    console.log(`   Duration:      ${duration}s`);
    console.log('');

    return { scraped: totalScraped, failed: totalFailed, duration };
  }

  /**
   * Start the continuous news loop
   */
  async start(intervalMinutes = 5) {
    if (this.isRunning) {
      console.log('⚠️  News loop is already running');
      return;
    }

    this.isRunning = true;
    this.shouldStop = false;

    fs.writeFileSync(PID_FILE, process.pid.toString());

    console.log('\n' + '═'.repeat(60));
    console.log('🚀 STARTING NEWS SCRAPER (RSS Mode)');
    console.log('═'.repeat(60));
    console.log(`   Interval: Every ${intervalMinutes} minutes`);
    console.log(`   PID: ${process.pid}`);
    console.log(`   Press Ctrl+C to stop`);
    console.log('═'.repeat(60));

    const shutdown = async (signal) => {
      console.log(`\n\n🛑 Received ${signal}, shutting down...`);
      this.shouldStop = true;
      this.isRunning = false;
      
      if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
      }
      
      await disconnectDB();
      console.log('👋 Goodbye!');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // Run first cycle immediately
    await this.runCycle();

    // Then run on interval
    const intervalMs = intervalMinutes * 60 * 1000;
    
    while (!this.shouldStop) {
      console.log(`\n⏳ Next check in ${intervalMinutes} minutes...`);
      
      await new Promise(resolve => {
        const timeout = setTimeout(resolve, intervalMs);
        const stopCheck = setInterval(() => {
          if (this.shouldStop) {
            clearTimeout(timeout);
            clearInterval(stopCheck);
            resolve();
          }
        }, 1000);
      });

      if (!this.shouldStop) {
        await this.runCycle();
      }
    }
  }

  /**
   * Stop the running loop
   */
  static async stop() {
    if (fs.existsSync(PID_FILE)) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`✓ Sent stop signal to process ${pid}`);
        fs.unlinkSync(PID_FILE);
        return true;
      } catch (error) {
        if (error.code === 'ESRCH') {
          console.log('⚠️  Process not found (already stopped)');
          fs.unlinkSync(PID_FILE);
        }
        return false;
      }
    } else {
      console.log('⚠️  No running news loop found');
      return false;
    }
  }

  /**
   * Check if loop is running
   */
  static isLoopRunning() {
    if (fs.existsSync(PID_FILE)) {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8'));
      try {
        process.kill(pid, 0);
        return { running: true, pid };
      } catch {
        fs.unlinkSync(PID_FILE);
        return { running: false };
      }
    }
    return { running: false };
  }

  /**
   * Get recent articles
   */
  async getRecentArticles(limit = 10) {
    return await Article.find({ status: 'scraped' })
      .sort({ scrapedAt: -1 })
      .limit(limit)
      .populate('sourceId', 'name');
  }

  /**
   * Get pending articles
   */
  async getPendingArticles(limit = 10) {
    return await Article.find({ status: 'pending' })
      .sort({ discoveredAt: -1 })
      .limit(limit)
      .populate('sourceId', 'name');
  }

  /**
   * Get statistics
   */
  async getStats() {
    const total = await Article.countDocuments();
    const scraped = await Article.countDocuments({ status: 'scraped' });
    const pending = await Article.countDocuments({ status: 'pending' });
    const failed = await Article.countDocuments({ status: 'failed' });
    const sources = await Source.countDocuments({ active: true });

    return { total, scraped, pending, failed, sources };
  }

  /**
   * Clear all articles
   */
  async clearArticles() {
    const result = await Article.deleteMany({});
    console.log(`✓ Cleared ${result.deletedCount} articles`);
    await Source.updateMany({}, { totalArticles: 0 });
    return result.deletedCount;
  }

  /**
   * Clear all sources
   */
  async clearSources() {
    const result = await Source.deleteMany({});
    console.log(`✓ Cleared ${result.deletedCount} sources`);
    return result.deletedCount;
  }
}

/**
 * Default RSS feed sources
 */
export async function setupDefaultSources() {
  const feeds = [
    {
      name: 'BBC News',
      feedUrl: 'http://feeds.bbci.co.uk/news/rss.xml',
      baseUrl: 'https://www.bbc.com'
    },
    {
      name: 'TechCrunch',
      feedUrl: 'https://techcrunch.com/feed/',
      baseUrl: 'https://techcrunch.com'
    },
    {
      name: 'The Verge',
      feedUrl: 'https://www.theverge.com/rss/index.xml',
      baseUrl: 'https://www.theverge.com'
    },
    {
      name: 'Reuters World',
      feedUrl: 'https://www.reutersagency.com/feed/',
      baseUrl: 'https://www.reuters.com'
    }
  ];

  const newsLoop = new NewsLoop();
  
  for (const feed of feeds) {
    const exists = await Source.findOne({ feedUrl: feed.feedUrl });
    if (!exists) {
      await newsLoop.addSource(feed);
    } else {
      console.log(`   Source already exists: ${feed.name}`);
    }
  }

  return feeds;
}
