/**
 * Inngest Functions Index
 * 
 * Central export for all Inngest functions
 */

export { inngest } from './client.js';
export { scrapeNewsCycle, manualScrape } from './functions.js';
export { generateArticle } from './generateArticle.js';
export { sendWebhook } from './sendWebhook.js';

// Export all functions for Inngest serve
import { scrapeNewsCycle, manualScrape } from './functions.js';
import { generateArticle } from './generateArticle.js';
import { sendWebhook } from './sendWebhook.js';

export const functions = [
  scrapeNewsCycle,
  manualScrape,
  generateArticle,
  sendWebhook
];

