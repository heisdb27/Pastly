const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Trust proxy for accurate client IPs (important for production)
app.set('trust proxy', 1);

// In-memory storage (use Redis or database in production)
const textStorage = new Map();

// Cleanup expired texts every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of textStorage.entries()) {
    if (now > data.expiresAt) {
      textStorage.delete(id);
    }
  }
}, 5 * 60 * 1000);

// Generate unique ID
function generateId() {
  return crypto.randomBytes(16).toString('hex');
}

// Rate limiting (simple implementation)
const rateLimiter = new Map();
const RATE_LIMIT = 10; // requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const userRequests = rateLimiter.get(ip) || [];
  
  // Remove old requests
  const validRequests = userRequests.filter(time => now - time < RATE_WINDOW);
  
  if (validRequests.length >= RATE_LIMIT) {
    return false;
  }
  
  validRequests.push(now);
  rateLimiter.set(ip, validRequests);
  return true;
}

// API Routes

// Create a new text share
app.post('/api/share', (req, res) => {
  try {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    // Check rate limit
    if (!checkRateLimit(clientIP)) {
      return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    }
    
    const { text, expirationHours = 24 } = req.body;
    
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text content is required' });
    }
    
    if (text.length > 100000) { // 100KB limit
      return res.status(400).json({ error: 'Text too large. Maximum 100,000 characters.' });
    }
    
    if (expirationHours < 0.1 || expirationHours > 24) {
      return res.status(400).json({ error: 'Expiration must be between 0.1 and 24 hours' });
    }
    
    const id = generateId();
    const expiresAt = Date.now() + (expirationHours * 60 * 60 * 1000);
    
    textStorage.set(id, {
      text: text.trim(),
      createdAt: Date.now(),
      expiresAt,
      views: 0,
      creatorIP: clientIP
    });
    
    // Get the host from request for proper URL generation
    const protocol = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('host');
    
    res.json({
      id,
      url: `${protocol}://${host}/share/${id}`,
      expiresAt: new Date(expiresAt).toISOString()
    });
  } catch (error) {
    console.error('Share creation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get shared text
app.get('/api/share/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = textStorage.get(id);
    
    if (!data) {
      return res.status(404).json({ error: 'Text not found or expired' });
    }
    
    if (Date.now() > data.expiresAt) {
      textStorage.delete(id);
      return res.status(404).json({ error: 'Text has expired' });
    }
    
    // Increment view count
    data.views++;
    
    res.json({
      text: data.text,
      createdAt: new Date(data.createdAt).toISOString(),
      expiresAt: new Date(data.expiresAt).toISOString(),
      views: data.views
    });
  } catch (error) {
    console.error('Share retrieval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get text stats
app.get('/api/stats/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = textStorage.get(id);
    
    if (!data) {
      return res.status(404).json({ error: 'Text not found or expired' });
    }
    
    if (Date.now() > data.expiresAt) {
      textStorage.delete(id);
      return res.status(404).json({ error: 'Text has expired' });
    }
    
    res.json({
      createdAt: new Date(data.createdAt).toISOString(),
      expiresAt: new Date(data.expiresAt).toISOString(),
      views: data.views,
      length: data.text.length
    });
  } catch (error) {
    console.error('Stats retrieval error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    activeTexts: textStorage.size
  });
});

// Serve the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/share/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'view.html'));
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Text Sharer server running on port ${PORT}`);
  console.log(`Access the app at http://localhost:${PORT}`);
});

module.exports = app;
