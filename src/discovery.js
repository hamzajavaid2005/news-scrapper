import Parser from 'rss-parser';
import { prisma } from './prisma.js';

const parser = new Parser({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)'
  }
});

/**
 * RSS Feed Discovery
 * 
 * Uses RSS/Atom feeds instead of web scraping.
 * Much faster and more accurate - top item is always the newest.
 */
export class RSSDiscovery {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Fetch and parse an RSS feed
   */
  async fetchFeed(feedUrl) {
    try {
      const feed = await parser.parseURL(feedUrl);
      return {
        title: feed.title,
        description: feed.description,
        items: feed.items.map(item => ({
          title: item.title,
          link: item.link,
          pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
          content: item.contentSnippet || item.content || '',
          author: item.creator || item.author || '',
          categories: item.categories || []
        }))
      };
    } catch (error) {
      throw new Error(`Failed to fetch RSS feed: ${error.message}`);
    }
  }

  /**
   * Check which URLs are new (not in database)
   */
  async filterNewUrls(urls) {
    const existingArticles = await prisma.article.findMany({
      where: { url: { in: urls } },
      select: { url: true }
    });

    const existingUrls = new Set(existingArticles.map(a => a.url));
    return urls.filter(url => !existingUrls.has(url));
  }

  /**
   * Discover new articles from a source's RSS feed
   * Returns array of new article items that haven't been scraped yet
   */
  async discoverNewArticles(source) {
    console.log(`\n📡 Fetching RSS: ${source.name}`);
    console.log(`   Feed URL: ${source.feedUrl}`);

    // Step 1: Fetch and parse RSS feed
    const feed = await this.fetchFeed(source.feedUrl);
    console.log(`   Found ${feed.items.length} items in feed`);

    // Step 2: Get all article links
    const articleLinks = feed.items.map(item => item.link);

    // Step 3: Filter out already scraped URLs
    const newUrls = await this.filterNewUrls(articleLinks);
    console.log(`   ${newUrls.length} new articles to scrape`);

    // Update source last checked time
    await prisma.source.update({
      where: { id: source.id },
      data: { lastCheckedAt: new Date() }
    });

    // Return full item data for new articles (includes title, date, etc.)
    const newItems = feed.items.filter(item => newUrls.includes(item.link));
    return newItems;
  }

  /**
   * Discover from all active sources
   */
  async discoverFromAllSources() {
    const sources = await prisma.source.findMany({
      where: { active: true },
      orderBy: { lastCheckedAt: 'asc' }
    });
    console.log(`\n🔍 Checking ${sources.length} RSS feed(s)...`);

    const allNewItems = [];

    for (const source of sources) {
      try {
        const newItems = await this.discoverNewArticles(source);
        allNewItems.push(
          ...newItems.map(item => ({ ...item, source }))
        );
      } catch (error) {
        console.error(`   ✗ Error fetching ${source.name}: ${error.message}`);
      }
    }

    return allNewItems;
  }

  /**
   * Auto-detect RSS feed URL from a website
   */
  static async detectFeed(websiteUrl) {
    const commonPaths = [
      '/feed',
      '/feed/',
      '/rss',
      '/rss.xml',
      '/feed.xml',
      '/atom.xml',
      '/index.xml',
      '/feeds/posts/default'
    ];

    const baseUrl = new URL(websiteUrl).origin;

    for (const path of commonPaths) {
      try {
        const feedUrl = baseUrl + path;
        const feed = await parser.parseURL(feedUrl);
        if (feed && feed.items && feed.items.length > 0) {
          return { feedUrl, title: feed.title };
        }
      } catch {
        // Try next path
      }
    }

    return null;
  }
}
