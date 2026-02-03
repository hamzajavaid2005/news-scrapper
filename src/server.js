import express from 'express';
import { serve } from 'inngest/express';
import { inngest, functions } from './inngest/index.js';
import { connectDB } from './prisma.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'running',
    message: 'News Scraper with Inngest + Supabase',
    inngestDashboard: 'http://localhost:8288'
  });
});

// Health check endpoint for Docker
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Inngest endpoint - this is where Inngest sends requests
app.use('/api/inngest', serve({
  client: inngest,
  functions: functions,
  signingKey: process.env.INNGEST_SIGNING_KEY,
}));

// Start server
async function start() {
  try {
    // Connect to Supabase
    await connectDB();

    app.listen(PORT, () => {
      console.log('');
      console.log('═'.repeat(60));
      console.log('🚀 NEWS SCRAPER SERVER STARTED');
      console.log('═'.repeat(60));
      console.log(`   Server:           http://localhost:${PORT}`);
      console.log(`   Inngest Endpoint: http://localhost:${PORT}/api/inngest`);
      console.log(`   Database:         Supabase (PostgreSQL)`);
      console.log('');
      console.log('📋 NEXT STEPS:');
      console.log('   1. In another terminal, run the Inngest dev server:');
      console.log('      npx inngest-cli@latest dev -u http://localhost:3000/api/inngest');
      console.log('');
      console.log('   2. Open Inngest dashboard: http://localhost:8288');
      console.log('');
      console.log('   3. The scraper will run automatically every 10 minutes');
      console.log('      Or trigger manually from the dashboard');
      console.log('═'.repeat(60));
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
