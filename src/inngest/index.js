/**
 * Inngest Functions Index
 * 
 * Central export for all Inngest functions
 * Modular pipeline architecture for news scraping
 */

export { inngest } from './client.js';

// ============================================
// MODULAR RSS PIPELINE FUNCTIONS (8 Steps)
// ============================================

// Step 1: RSS Trigger (Cron every 5 min)
export { rssTrigger } from './rssTrigger.js';

// Step 2: Fetch RSS Feed & Create Pending Articles
export { fetchRssFeed } from './fetchRssFeed.js';

// Step 3: Scrape Article Content
export { scrapeContent } from './scrapeContent.js';

// Step 4: Generate Embedding Vector
export { generateArticleEmbedding } from './generateEmbedding.js';

// Step 5: Check for Semantic Duplicates
export { checkDuplicate } from './checkDuplicate.js';

// Step 6: Save Article to Database
export { saveArticle } from './saveArticle.js';

// Step 7: Generate AI Article
export { generateArticle } from './generateArticle.js';

// Step 8: Send to Webhooks
export { sendWebhook } from './sendWebhook.js';

// ============================================
// IMPORTS FOR INNGEST SERVE
// ============================================
import { rssTrigger } from './rssTrigger.js';
import { fetchRssFeed } from './fetchRssFeed.js';
import { scrapeContent } from './scrapeContent.js';
import { generateArticleEmbedding } from './generateEmbedding.js';
import { checkDuplicate } from './checkDuplicate.js';
import { saveArticle } from './saveArticle.js';
import { generateArticle } from './generateArticle.js';
import { sendWebhook } from './sendWebhook.js';

// All functions for Inngest serve
export const functions = [
  // RSS Discovery Pipeline
  rssTrigger,
  fetchRssFeed,
  
  // Scraping Pipeline
  scrapeContent,
  generateArticleEmbedding,
  checkDuplicate,
  saveArticle,
  
  // AI Generation & Delivery
  generateArticle,
  sendWebhook
];
