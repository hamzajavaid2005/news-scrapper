import mongoose from 'mongoose';

const articleSchema = new mongoose.Schema({
  // The unique URL of the article
  url: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Source information
  sourceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Source',
    required: true
  },
  
  // Extracted content
  title: {
    type: String,
    default: ''
  },
  
  textContent: {
    type: String,
    default: ''
  },
  
  excerpt: {
    type: String,
    default: ''
  },
  
  byline: {
    type: String,
    default: ''
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ['pending', 'scraped', 'failed'],
    default: 'pending'
  },
  
  errorMessage: {
    type: String,
    default: null
  },
  
  // Timestamps
  discoveredAt: {
    type: Date,
    default: Date.now
  },
  
  scrapedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Index for efficient queries
articleSchema.index({ sourceId: 1, status: 1 });
articleSchema.index({ discoveredAt: -1 });

export const Article = mongoose.model('Article', articleSchema);
