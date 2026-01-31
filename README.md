# 📰 RSS News Scraper

A lightweight news scraper using RSS feeds for discovery and Readability for content extraction.

## Installation

```bash
pnpm install
```

## Quick Start

```bash
# Setup default RSS feeds (BBC, TechCrunch, The Verge, Reuters)
node src/cli.js setup-defaults

# Start the scraper (checks every 5 minutes)
node src/cli.js start

# Run one cycle and exit
node src/cli.js run

# Stop the running scraper
node src/cli.js stop
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `start` | Start continuous loop |
| `stop` | Stop the loop |
| `status` | Check if running |
| `run` | Run one cycle |
| `list` | List RSS sources |
| `add <url>` | Add RSS feed |
| `remove <name>` | Remove source |
| `stats` | Show statistics |
| `recent [n]` | Show recent articles |

## Project Structure

```
src/
├── cli.js         # Command-line interface
├── newsLoop.js    # Main orchestrator
├── discovery.js   # RSS feed discovery
├── scraper.js     # Article content extraction
├── index.js       # Exports
└── db/
    ├── connection.js      # MongoDB connection
    └── models/
        ├── Article.js     # Article schema
        └── Source.js      # Source schema
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  1. RSS DISCOVERY (discovery.js)                            │
│     Fetch XML → Parse → Get article URLs                    │
│     Check MongoDB → Filter NEW only                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  2. CONTENT EXTRACTION (scraper.js)                         │
│     Fetch HTML → JSDOM → Readability → Clean text           │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  3. STORAGE (MongoDB)                                        │
│     Save: title, textContent, excerpt, byline, url          │
└─────────────────────────────────────────────────────────────┘
```

## Dependencies

- `rss-parser` - Parse RSS/Atom feeds
- `jsdom` - Parse HTML
- `@mozilla/readability` - Extract article content
- `mongoose` - MongoDB ODM
