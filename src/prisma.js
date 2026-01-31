import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const { Pool } = pg;

/**
 * Create Prisma client with pg adapter for Supabase
 */
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

// Singleton pattern for Prisma client
const globalForPrisma = globalThis;
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Connect to database (for compatibility with existing code)
 */
export async function connectDB() {
  // Connection is established on first query, just log for compatibility
  console.log('✓ Connected to Supabase (PostgreSQL)');
}

/**
 * Disconnect from database
 */
export async function disconnectDB() {
  await prisma.$disconnect();
  console.log('✓ Disconnected from Supabase');
}
