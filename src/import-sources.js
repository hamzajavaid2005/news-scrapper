import { prisma, disconnectDB } from './prisma.js';

const sources = [
  {
    name: "BBC News",
    feedUrl: "http://feeds.bbci.co.uk/news/rss.xml",
    baseUrl: "https://www.bbc.com",
    active: true
  },
  {
    name: "TechCrunch",
    feedUrl: "https://techcrunch.com/feed/",
    baseUrl: "https://techcrunch.com",
    active: true
  },
  {
    name: "The Verge",
    feedUrl: "https://www.theverge.com/rss/index.xml",
    baseUrl: "https://www.theverge.com",
    active: true
  },
  {
    name: "ARY News",
    feedUrl: "https://arynews.tv/feed/",
    baseUrl: "https://arynews.tv",
    active: true
  },
  {
    name: "Geo News",
    feedUrl: "https://www.geo.tv/rss/1/0",
    baseUrl: "https://www.geo.tv",
    active: true
  },
  {
    name: "Dawn News",
    feedUrl: "https://www.dawn.com/feeds/home",
    baseUrl: "https://www.dawn.com",
    active: true
  },
  {
    name: "BOL News",
    feedUrl: "https://bolnews.com/feed",
    baseUrl: "https://bolnews.com",
    active: true
  },
  {
    name: "Al Jazeera",
    feedUrl: "https://www.aljazeera.com/xml/rss/all.xml",
    baseUrl: "https://www.aljazeera.com",
    active: true
  },
  {
    name: "CNN",
    feedUrl: "http://rss.cnn.com/rss/edition.rss",
    baseUrl: "http://rss.cnn.com",
    active: true
  }
];

async function importSources() {
  console.log('📦 Importing sources into Supabase...');

  for (const source of sources) {
    try {
      // Upsert: Create if not exists, update if exists (by feedUrl unique key)
      const result = await prisma.source.upsert({
        where: { feedUrl: source.feedUrl },
        update: {
          name: source.name,
          baseUrl: source.baseUrl,
          active: source.active
        },
        create: {
          name: source.name,
          feedUrl: source.feedUrl,
          baseUrl: source.baseUrl,
          active: source.active
        }
      });
      console.log(`✓ Imported: ${result.name}`);
    } catch (error) {
      console.error(`✗ Failed to import ${source.name}: ${error.message}`);
    }
  }

  console.log('\n✅ Import complete!');
}

importSources()
  .catch(console.error)
  .finally(() => disconnectDB());
