import { gateway } from '@ai-sdk/gateway';
import { embed, generateText } from 'ai';

/**
 * Generate embedding for text using Vercel AI Gateway
 * @param {string} text - Text to embed
 * @returns {Promise<Array<number>|null>} - 1536-dimensional vector or null if disabled
 */
export async function generateEmbedding(text) {
  
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

const CATEGORIES = [
  'Politics',
  'Sports',
  'Technology',
  'Entertainment',
  'Business',
  'Health',
  'World',
  'Pakistan',
  'Science',
  'Lifestyle',
  'Breaking News',
  'Opinion',
  'Investigations',
  'Economy',
  'Education',
  'Crime',
  'Law',
  'Security',
  'Climate',
  'Environment',
  'Energy',
  'Digital',
  'Artificial Intelligence',
  'Cybersecurity',
  'Gadgets',
  'Media',
  'Culture',
  'Travel',
  'Food',
  'Wellness',
  'Religion',
  'Human Rights',
  'Society',
  'History',
  'Space',
  'Innovation',
  'Automobiles',
  'Real Estate',
  'Agriculture',
  'Immigration',
  'Elections',
  'Governance',
  'Public Policy',
  'Explainers',
  'Special Reports',
  'Interviews'
];

/**
 * Generate AI-rewritten article with category
 * @param {object} article - Original article with title and textContent
 * @returns {Promise<{title: string, content: string, category: string}|null>}
 */
export async function generateArticleContent(article) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.warn('[AI] No AI_GATEWAY_API_KEY found - article generation disabled');
    return null;
  }

  if (!article.textContent) return null;

  const prompt = `You are a professional news writer. Write an article on the following news in a clear, engaging, and professional style. And generate a article in 4 to 6 paragraphs and each paragraph should be around 40 to 60 words. Also categorize it into one of these categories: ${CATEGORIES.join(', ')}.

ORIGINAL ARTICLE:
Title: ${article.title}
Content: ${article.textContent.substring(0, 15000)}

Respond in JSON format:
{
  "title": "Your news headline",
  "content": "Your news article (4 to 6 paragraphs, professional news style)",
  "category": "One of the listed categories"
}

Important:
- Keep the facts accurate
- Write in third person
- Use professional news language
- The content should be 200 to 350 words`;

  try {
    const { text } = await generateText({
      model: gateway('openai/gpt-4o-mini'),
      prompt,
    });

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid JSON response from AI');
    }

    const result = JSON.parse(jsonMatch[0]);
    
    // Validate category
    if (!CATEGORIES.includes(result.category)) {
      result.category = 'World'; // Default fallback
    }

    return {
      title: result.title,
      content: result.content,
      category: result.category
    };
  } catch (error) {
    console.error('Article generation failed:', error.message);
    return null;
  }
}

