import mongoose from 'mongoose';

/**
 * Connect to MongoDB
 * @param {string} uri - MongoDB connection URI (default: localhost)
 */
export async function connectDB(uri = 'mongodb://localhost:27017/news-scraper') {
  try {
    await mongoose.connect(uri);
    console.log('✓ Connected to MongoDB');
    return mongoose.connection;
  } catch (error) {
    console.error('✗ MongoDB connection error:', error.message);
    throw error;
  }
}

/**
 * Disconnect from MongoDB
 */
export async function disconnectDB() {
  await mongoose.disconnect();
  console.log('✓ Disconnected from MongoDB');
}

export default mongoose;
