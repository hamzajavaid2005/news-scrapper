import { gateway } from '@ai-sdk/gateway';
import { embed } from 'ai';

/**
 * Vercel AI Gateway Configuration
 * 
 * Uses Vercel AI Gateway to access models with your Vercel credits.
 * Set VERCEL_AI_GATEWAY_API_KEY in your .env file.
 * 
 * Get your API key from: https://vercel.com/dashboard/settings/ai-gateway
 */

/**
 * Generate embedding for text using Vercel AI Gateway
 * @param {string} text - Text to embed
 * @returns {Promise<Array<number>|null>} - 1536-dimensional vector or null if disabled
 */
export async function generateEmbedding(text) {
  // Check if we have a Vercel AI Gateway key
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.warn('[AI] No AI_GATEWAY_API_KEY found - embeddings disabled');
    return null;
  }

  if (!text) return null;
  
  // Truncate text to avoid token limits
  const truncatedText = text.substring(0, 25000);

  try {
    const { embedding } = await embed({
      model: gateway.embeddingModel('openai/text-embedding-3-small'),
      value: truncatedText,
    });
    
    return embedding;
  } catch (error) {
    console.error('Embedding generation failed:', error.message);
    return null; // Return null instead of throwing - scraping continues without embeddings
  }
}
