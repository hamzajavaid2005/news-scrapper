// Main exports for the news scraper module
export { NewsLoop, setupDefaultSources } from './newsLoop.js';
export { RSSDiscovery } from './discovery.js';
export { scrapeNewsArticle } from './scraper.js';
export { prisma, connectDB, disconnectDB } from './prisma.js';
