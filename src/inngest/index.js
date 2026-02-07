/**
 * Inngest Functions Index
 *
 * Central export for all Inngest functions
 * Modular pipeline architecture for news scraping
 */

export { inngest } from "./client.js";

// ============================================
// MODULAR RSS PIPELINE FUNCTIONS (8 Functions)
// ============================================

// Step 1: RSS Trigger (Cron every 15 min)
export { rssTrigger } from "./rssTrigger.js";

// Step 2: Fetch RSS Feed & Create Pending Articles
export { fetchRssFeed } from "./fetchRssFeed.js";

// Step 3: Scrape Article Content
export { scrapeContent } from "./scrapeContent.js";

// Step 4: Generate Embedding Vector
export { generateArticleEmbedding } from "./generateEmbedding.js";

// Step 5: Check for Semantic Duplicates
export { checkDuplicate } from "./checkDuplicate.js";

// Step 6: Save Article to Database (pipeline ends here)
export { saveArticle } from "./saveArticle.js";

// Step 7: Smart Publisher (Cron every 30 min)
export { smartPublisher } from "./smartPublisher.js";

// Step 8: Cleanup Old Articles (Cron every 6 hours)
export { cleanupOldArticles } from "./cleanupOldArticles.js";

// ============================================
// IMPORTS FOR INNGEST SERVE
// ============================================
import { rssTrigger } from "./rssTrigger.js";
import { fetchRssFeed } from "./fetchRssFeed.js";
import { scrapeContent } from "./scrapeContent.js";
import { generateArticleEmbedding } from "./generateEmbedding.js";
import { checkDuplicate } from "./checkDuplicate.js";
import { saveArticle } from "./saveArticle.js";
import { smartPublisher } from "./smartPublisher.js";
import { cleanupOldArticles } from "./cleanupOldArticles.js";

// All functions for Inngest serve (8 functions)
export const functions = [
    // RSS Discovery Pipeline
    rssTrigger,
    fetchRssFeed,

    // Scraping Pipeline
    scrapeContent,
    generateArticleEmbedding,
    checkDuplicate,
    saveArticle,

    // Smart Publishing & Maintenance
    smartPublisher,
    cleanupOldArticles,
];
