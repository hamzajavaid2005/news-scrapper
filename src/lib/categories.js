/**
 * Standardized News Categories
 * 
 * Based on real news websites: BBC, CNN, ARY News, Geo News, etc.
 * Excludes channel-specific categories (TV Shows, Videos, Live, Audio, etc.)
 */

export const CATEGORIES = [
  // === Main News ===
  'Latest News',
  'Breaking News',
  'Pakistan',
  'World',
  'Politics',
  'Business',
  'Sports',
  'Entertainment',
  'Health',
  'Technology',
  'Science',
  'Education',
  'Crime',
  'Weather',
  'Climate',
  'Trending',
  'Opinion',
  'Investigations',

  // === World Regions ===
  'Asia',
  'Middle East',
  'Europe',
  'Africa',
  'Americas',
  'UK',
  'US',
  'India',
  'China',

  // === Business & Economy ===
  'Economy',
  'Markets',
  'Real Estate',
  'Agriculture',

  // === Politics & Governance ===
  'Elections',
  'Governance',
  'Law',
  'Human Rights',
  'Immigration',
  'Security',
  'Public Policy',

  // === Entertainment ===
  'Bollywood',
  'Hollywood',
  'Celebrities',
  'Movies',
  'Music',
  'K-Pop',
  'Royals',

  // === Lifestyle ===
  'Lifestyle',
  'Beauty',
  'Fashion',
  'Food',
  'Horoscope',
  'Parenting',
  'Relationships',
  'Wellness',
  'Travel',

  // === Culture & Arts ===
  'Culture',
  'Arts',
  'Religion',
  'History',
  'Society',

  // === Science & Tech ===
  'Space',
  'Environment',
  'Energy',
  'Innovation',
  'Artificial Intelligence',
  'Cybersecurity',
  'Gadgets',
  'Digital',
  'Automobiles',

  // === Special ===
  'Special Reports',
  'Explainers',
  'Interviews',
];

/**
 * Maps common RSS category variations to our standardized category names.
 * Keys are lowercase for case-insensitive matching.
 */
const CATEGORY_MAP = {
  // Direct / common aliases
  'latest': 'Latest News',
  'latest news': 'Latest News',
  'breaking': 'Breaking News',
  'breaking news': 'Breaking News',
  'top stories': 'Latest News',
  'top news': 'Latest News',
  'headlines': 'Latest News',
  'featured': 'Latest News',

  // Pakistan
  'pakistan': 'Pakistan',
  'pk': 'Pakistan',
  'national': 'Pakistan',

  // World / International
  'world': 'World',
  'international': 'World',
  'global': 'World',
  'world news': 'World',

  // Region
  'asia': 'Asia',
  'middle east': 'Middle East',
  'mideast': 'Middle East',
  'europe': 'Europe',
  'africa': 'Africa',
  'americas': 'Americas',
  'latin america': 'Americas',
  'north america': 'Americas',
  'south america': 'Americas',
  'us & canada': 'US',
  'us': 'US',
  'usa': 'US',
  'united states': 'US',
  'us news': 'US',
  'uk': 'UK',
  'united kingdom': 'UK',
  'britain': 'UK',
  'india': 'India',
  'china': 'China',
  'australia': 'World',

  // Politics
  'politics': 'Politics',
  'us politics': 'Politics',
  'political': 'Politics',
  'elections': 'Elections',
  'election': 'Elections',
  'governance': 'Governance',
  'government': 'Governance',
  'law': 'Law',
  'legal': 'Law',
  'judiciary': 'Law',
  'court': 'Law',
  'human rights': 'Human Rights',
  'rights': 'Human Rights',
  'immigration': 'Immigration',
  'security': 'Security',
  'defence': 'Security',
  'defense': 'Security',
  'military': 'Security',
  'public policy': 'Public Policy',
  'policy': 'Public Policy',

  // Business & Economy
  'business': 'Business',
  'business news': 'Business',
  'finance': 'Business',
  'economy': 'Economy',
  'economic': 'Economy',
  'markets': 'Markets',
  'market': 'Markets',
  'stocks': 'Markets',
  'stock market': 'Markets',
  'investing': 'Markets',
  'real estate': 'Real Estate',
  'property': 'Real Estate',
  'agriculture': 'Agriculture',
  'farming': 'Agriculture',

  // Sports
  'sport': 'Sports',
  'sports': 'Sports',
  'football': 'Sports',
  'soccer': 'Sports',
  'cricket': 'Sports',
  'tennis': 'Sports',
  'golf': 'Sports',
  'motorsport': 'Sports',
  'motorsports': 'Sports',
  'olympics': 'Sports',
  'us sports': 'Sports',
  'rugby': 'Sports',
  'basketball': 'Sports',
  'baseball': 'Sports',
  'boxing': 'Sports',
  'formula 1': 'Sports',
  'f1': 'Sports',
  'nfl': 'Sports',
  'nba': 'Sports',
  'ipl': 'Sports',
  'psl': 'Sports',

  // Entertainment
  'entertainment': 'Entertainment',
  'showbiz': 'Entertainment',
  'show biz': 'Entertainment',
  'celebrity': 'Celebrities',
  'celebrities': 'Celebrities',
  'bollywood': 'Bollywood',
  'lollywood': 'Bollywood',
  'hollywood': 'Hollywood',
  'movies': 'Movies',
  'movie': 'Movies',
  'film': 'Movies',
  'films': 'Movies',
  'cinema': 'Movies',
  'music': 'Music',
  'k-pop': 'K-Pop',
  'kpop': 'K-Pop',
  'royal family': 'Royals',
  'royals': 'Royals',
  'royalty': 'Royals',

  // Health
  'health': 'Health',
  'health news': 'Health',
  'medical': 'Health',
  'medicine': 'Health',
  'fitness': 'Health',
  'mental health': 'Health',
  'wellness': 'Wellness',
  'mindfulness': 'Wellness',
  'sleep': 'Health',

  // Science & Tech
  'technology': 'Technology',
  'tech': 'Technology',
  'science & tech': 'Technology',
  'sci-tech': 'Technology',
  'science and technology': 'Technology',
  'science': 'Science',
  'space': 'Space',
  'astronomy': 'Space',
  'earth': 'Environment',
  'environment': 'Environment',
  'climate': 'Climate',
  'climate change': 'Climate',
  'energy': 'Energy',
  'innovation': 'Innovation',
  'innovate': 'Innovation',
  'ai': 'Artificial Intelligence',
  'artificial intelligence': 'Artificial Intelligence',
  'cyber': 'Cybersecurity',
  'cybersecurity': 'Cybersecurity',
  'cyber security': 'Cybersecurity',
  'gadgets': 'Gadgets',
  'digital': 'Digital',
  'automobiles': 'Automobiles',
  'auto': 'Automobiles',
  'cars': 'Automobiles',
  'motoring': 'Automobiles',

  // Lifestyle
  'lifestyle': 'Lifestyle',
  'life style': 'Lifestyle',
  'life': 'Lifestyle',
  'beauty': 'Beauty',
  'fashion': 'Fashion',
  'style': 'Fashion',
  'food': 'Food',
  'food & drink': 'Food',
  'recipes': 'Food',
  'cooking': 'Food',
  'horoscope': 'Horoscope',
  'astrology': 'Horoscope',
  'parenting': 'Parenting',
  'family': 'Parenting',
  'relationships': 'Relationships',
  'relationship': 'Relationships',
  'travel': 'Travel',
  'destinations': 'Travel',

  // Culture & Arts
  'culture': 'Culture',
  'arts': 'Arts',
  'art': 'Arts',
  'design': 'Arts',
  'architecture': 'Arts',
  'religion': 'Religion',
  'faith': 'Religion',
  'islam': 'Religion',
  'history': 'History',
  'society': 'Society',
  'social': 'Society',

  // Education
  'education': 'Education',
  'schools': 'Education',
  'universities': 'Education',

  // Crime
  'crime': 'Crime',
  'police': 'Crime',
  'justice': 'Crime',

  // Weather
  'weather': 'Weather',
  'forecast': 'Weather',

  // Trending
  'trending': 'Trending',
  'viral': 'Trending',
  'amazing': 'Trending',
  'weird': 'Trending',
  'odd news': 'Trending',

  // Opinion / Editorial
  'opinion': 'Opinion',
  'editorial': 'Opinion',
  'op-ed': 'Opinion',
  'columns': 'Opinion',
  'analysis': 'Opinion',
  'commentary': 'Opinion',

  // Special
  'investigations': 'Investigations',
  'investigation': 'Investigations',
  'investigative': 'Investigations',
  'special reports': 'Special Reports',
  'special report': 'Special Reports',
  'in-depth': 'Special Reports',
  'long reads': 'Special Reports',
  'explainers': 'Explainers',
  'explainer': 'Explainers',
  'interviews': 'Interviews',
  'interview': 'Interviews',
};

/**
 * Channel/platform-specific categories to SKIP
 * These are not real news categories
 */
const SKIP_CATEGORIES = new Set([
  'home', 'video', 'videos', 'tv', 'tv shows', 'live',
  'audio', 'listen', 'watch', 'newsletters', 'newsletter',
  'photos', 'pictures', 'in pictures', 'gallery',
  'podcasts', 'podcast', 'urdu', 'español', 'arabic',
  'games', 'crossword', 'sudoku', 'quiz',
  'about', 'contact', 'advertise', 'subscribe',
  'cnn fast', 'cnn 10', 'bbc indepth', 'bbc verify',
  'shows a-z', 'cnn tv schedule', 'cnn profiles',
  'cnn leadership', 'cnn newsletters', 'cnn heroes',
  'work for cnn', 'about cnn',
]);

/**
 * Normalize a single RSS category string to our standardized category.
 * Returns the standardized category name, or null if it should be skipped.
 * 
 * @param {string} rawCategory - The raw category string from RSS feed
 * @returns {string|null} - Standardized category or null
 */
export function normalizeCategory(rawCategory) {
  if (!rawCategory || typeof rawCategory !== 'string') return null;

  const cleaned = rawCategory.trim().toLowerCase();

  // Skip channel-specific categories
  if (SKIP_CATEGORIES.has(cleaned)) return null;

  // Direct map lookup
  if (CATEGORY_MAP[cleaned]) {
    return CATEGORY_MAP[cleaned];
  }

  // Partial match: only for longer keys (5+ chars) to avoid false positives
  // e.g., 'us' would incorrectly match 'business', 'justice', etc.
  for (const [key, value] of Object.entries(CATEGORY_MAP)) {
    if (key.length >= 5 && (cleaned.includes(key) || key.includes(cleaned))) {
      return value;
    }
  }

  // Check if it directly matches a standardized category (case-insensitive)
  const directMatch = CATEGORIES.find(
    cat => cat.toLowerCase() === cleaned
  );
  if (directMatch) return directMatch;

  return null;
}

/**
 * Normalize an array of RSS categories and return the best match.
 * Returns the first valid standardized category found.
 * 
 * @param {string[]} rssCategories - Array of raw category strings from RSS
 * @returns {{ primary: string|null, all: string[] }} - Primary category and all matched categories
 */
export function normalizeCategories(rssCategories) {
  if (!Array.isArray(rssCategories) || rssCategories.length === 0) {
    return { primary: null, all: [] };
  }

  const normalized = [];
  const seen = new Set();

  for (const raw of rssCategories) {
    const mapped = normalizeCategory(raw);
    if (mapped && !seen.has(mapped)) {
      seen.add(mapped);
      normalized.push(mapped);
    }
  }

  return {
    primary: normalized[0] || null,  // First valid category is primary
    all: normalized
  };
}
