import mongoose from 'mongoose';

const sourceSchema = new mongoose.Schema({
  // Name of the news source
  name: {
    type: String,
    required: true
  },
  
  // RSS/Atom feed URL (the main input now!)
  feedUrl: {
    type: String,
    required: true,
    unique: true
  },
  
  // Base URL of the news site (optional, for reference)
  baseUrl: {
    type: String,
    default: ''
  },
  
  // Whether this source is active
  active: {
    type: Boolean,
    default: true
  },
  
  // Last time we checked this feed
  lastCheckedAt: {
    type: Date,
    default: null
  },
  
  // Statistics
  totalArticles: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

sourceSchema.index({ active: 1 });

export const Source = mongoose.model('Source', sourceSchema);
