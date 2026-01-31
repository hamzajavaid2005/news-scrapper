#!/usr/bin/env node

import { NewsLoop, setupDefaultSources } from './newsLoop.js';
import { RSSDiscovery } from './discovery.js';
import { connectDB, disconnectDB, Source, Article } from './db/index.js';

const HELP = `
📰 News Scraper CLI (RSS-based)
═══════════════════════════════════════════════════════════

Usage: node src/cli.js <command> [options]

CONTROL COMMANDS:
  start [--interval N]    Start the news loop (default: 5 min interval)
  stop                    Stop the running news loop
  status                  Check if news loop is running
  run                     Run one cycle and exit

SOURCE COMMANDS:
  add <feed-url>          Add an RSS feed URL
  add-auto <website-url>  Auto-detect RSS feed from website
  remove <name>           Remove a source by name
  list                    List all configured sources
  setup-defaults          Add default feeds (BBC, TechCrunch, etc.)
  clear-sources           Remove all sources

DATA COMMANDS:
  stats                   Show scraping statistics
  recent [n]              Show n most recent articles (default: 5)
  pending [n]             Show n pending articles
  get <url>               Get full article content by URL
  clear                   Clear all articles from database

OPTIONS:
  --name "Name"           Source name (for add)
  --interval N            Check interval in minutes (for start)

EXAMPLES:
  node src/cli.js setup-defaults
  node src/cli.js start
  node src/cli.js start --interval 2
  node src/cli.js add https://techcrunch.com/feed/ --name "TechCrunch"
  node src/cli.js add-auto https://cnn.com
  node src/cli.js run
`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    return;
  }

  // Handle stop and status without DB
  if (command === 'stop') {
    await NewsLoop.stop();
    return;
  }

  if (command === 'status') {
    const { running, pid } = NewsLoop.isLoopRunning();
    if (running) {
      console.log(`\n✓ News loop is RUNNING (PID: ${pid})\n`);
    } else {
      console.log(`\n✗ News loop is NOT running\n`);
    }
    return;
  }

  // Connect to MongoDB
  await connectDB();
  const newsLoop = new NewsLoop();

  try {
    switch (command) {
      case 'start': {
        const interval = parseInt(getArg(args, '--interval') || '5');
        await newsLoop.start(interval);
        return;
      }

      case 'run': {
        await newsLoop.runCycle();
        break;
      }

      case 'add': {
        const feedUrl = args[1];
        const name = getArg(args, '--name');

        if (!feedUrl) {
          console.log('\n⚠️  Missing feed URL');
          console.log('Usage: add <feed-url> --name "Source Name"\n');
          break;
        }

        try {
          // Test if feed is valid
          const rss = new RSSDiscovery();
          const feed = await rss.fetchFeed(feedUrl);
          
          await newsLoop.addSource({
            name: name || feed.title || 'Unknown',
            feedUrl: feedUrl
          });
        } catch (error) {
          console.log(`\n✗ Invalid RSS feed: ${error.message}\n`);
        }
        break;
      }

      case 'add-auto': {
        const websiteUrl = args[1];
        const name = getArg(args, '--name');

        if (!websiteUrl) {
          console.log('\n⚠️  Missing website URL');
          console.log('Usage: add-auto <website-url> --name "Source Name"\n');
          break;
        }

        await newsLoop.addSourceFromUrl(websiteUrl, name);
        break;
      }

      case 'remove': {
        const name = args[1];
        if (!name) {
          console.log('Usage: remove <name>');
          break;
        }
        const removed = await newsLoop.removeSource(name);
        if (!removed) {
          console.log(`✗ Source not found: ${name}`);
        }
        break;
      }

      case 'list': {
        const sources = await newsLoop.listSources();
        
        if (sources.length === 0) {
          console.log('\n⚠️  No sources configured.');
          console.log('   Run "setup-defaults" or "add" to add sources.\n');
        } else {
          console.log('\n📋 RSS Feed Sources:\n');
          for (const source of sources) {
            console.log(`  ${source.active ? '✓' : '✗'} ${source.name}`);
            console.log(`    Feed:     ${source.feedUrl}`);
            console.log(`    Articles: ${source.totalArticles}`);
            console.log(`    Checked:  ${source.lastCheckedAt ? source.lastCheckedAt.toLocaleString() : 'never'}\n`);
          }
        }
        break;
      }

      case 'setup-defaults': {
        console.log('\n🔧 Setting up default RSS feeds...\n');
        await setupDefaultSources();
        console.log('\n✓ Default feeds configured!\n');
        break;
      }

      case 'clear-sources': {
        const confirm = args[1];
        if (confirm !== '--confirm') {
          console.log('\n⚠️  This will delete ALL sources.');
          console.log('   Run "clear-sources --confirm" to proceed.\n');
        } else {
          await newsLoop.clearSources();
        }
        break;
      }

      case 'stats': {
        const stats = await newsLoop.getStats();
        const { running, pid } = NewsLoop.isLoopRunning();
        
        console.log('\n📊 News Scraper Statistics\n');
        console.log(`   Status:         ${running ? `RUNNING (PID: ${pid})` : 'STOPPED'}`);
        console.log(`   Active Sources: ${stats.sources}`);
        console.log(`   Total Articles: ${stats.total}`);
        console.log(`   ├─ Scraped:     ${stats.scraped}`);
        console.log(`   ├─ Pending:     ${stats.pending}`);
        console.log(`   └─ Failed:      ${stats.failed}`);
        console.log('');
        break;
      }

      case 'recent': {
        const limit = parseInt(args[1]) || 5;
        const articles = await newsLoop.getRecentArticles(limit);
        
        if (articles.length === 0) {
          console.log('\n⚠️  No articles scraped yet.\n');
        } else {
          console.log(`\n📰 Recent ${articles.length} Articles:\n`);
          for (const article of articles) {
            console.log(`  📄 ${article.title || 'Untitled'}`);
            console.log(`     Source:  ${article.sourceId?.name || 'Unknown'}`);
            console.log(`     Scraped: ${article.scrapedAt?.toLocaleString()}`);
            console.log('');
          }
        }
        break;
      }

      case 'pending': {
        const limit = parseInt(args[1]) || 5;
        const articles = await newsLoop.getPendingArticles(limit);
        
        if (articles.length === 0) {
          console.log('\n✓ No pending articles\n');
        } else {
          console.log(`\n⏳ ${articles.length} Pending Articles:\n`);
          for (const article of articles) {
            console.log(`  • ${article.title || article.url}`);
            console.log(`    Source: ${article.sourceId?.name || 'Unknown'}`);
            console.log('');
          }
        }
        break;
      }

      case 'get': {
        const url = args[1];
        if (!url) {
          console.log('Usage: get <url>');
          break;
        }
        
        const article = await Article.findOne({ url }).populate('sourceId', 'name');
        if (!article) {
          console.log('\n✗ Article not found\n');
        } else {
          console.log('\n' + '═'.repeat(60));
          console.log('TITLE:', article.title || 'Untitled');
          console.log('═'.repeat(60));
          console.log('SOURCE:', article.sourceId?.name || 'Unknown');
          console.log('AUTHOR:', article.byline || 'N/A');
          console.log('STATUS:', article.status);
          console.log('═'.repeat(60));
          console.log('CONTENT:\n');
          console.log(article.textContent || 'No content');
          console.log('\n' + '═'.repeat(60));
        }
        break;
      }

      case 'clear': {
        const confirm = args[1];
        if (confirm !== '--confirm') {
          console.log('\n⚠️  This will delete ALL articles.');
          console.log('   Run "clear --confirm" to proceed.\n');
        } else {
          await newsLoop.clearArticles();
        }
        break;
      }

      default:
        console.log(`\n✗ Unknown command: ${command}`);
        console.log('   Run "help" to see available commands.\n');
    }

  } finally {
    await disconnectDB();
  }
}

function getArg(args, name) {
  const index = args.indexOf(name);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }
  return null;
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
