import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import YouTubeExtractor from './services/youtube-extractor.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.text({ limit: '10mb' }));

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Ensure runtime directories exist
const runtimeDir = path.join(process.cwd(), 'runtime');
const ytdlpDir = path.join(runtimeDir, 'yt-dlp');
const chromeProfilesDir = path.join(runtimeDir, 'chrome-profiles');
const cookiesPath = process.env.COOKIES_FILE || path.join(ytdlpDir, 'cookies.txt');

// Initialize YouTube extractor
const youtubeExtractor = new YouTubeExtractor();

[runtimeDir, ytdlpDir, chromeProfilesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[Server] Created directory: ${dir}`);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

// Upload cookies endpoint
app.post('/api/upload-authenticated-cookies', (req, res) => {
  try {
    const cookiesContent = req.body;
    
    if (!cookiesContent || typeof cookiesContent !== 'string') {
      return res.status(400).json({ error: 'Invalid cookies content' });
    }

    // Validate cookies.txt format
    const lines = cookiesContent.split('\n');
    const validLines = lines.filter(line => {
      if (!line || line.startsWith('#')) return true;
      const parts = line.split('\t');
      return parts.length >= 7;
    });

    if (validLines.length === 0) {
      return res.status(400).json({ error: 'No valid cookies found' });
    }

    // Save cookies to file
    fs.writeFileSync(cookiesPath, cookiesContent, 'utf-8');
    
    console.log(`[Cookies] Saved ${validLines.length} cookie lines to ${cookiesPath}`);
    
    res.json({ 
      success: true, 
      message: 'Cookies uploaded successfully',
      cookieCount: validLines.length
    });
    } catch (error) {
    console.error('[Cookies] Upload error:', error);
    res.status(500).json({ error: 'Failed to save cookies' });
  }
});

// Get cookies status endpoint
app.get('/api/cookies-status', (req, res) => {
  try {
    if (!fs.existsSync(cookiesPath)) {
      return res.json({ 
        hasCookies: false,
        message: 'No cookies file found'
      });
    }

    const stats = fs.statSync(cookiesPath);
    const content = fs.readFileSync(cookiesPath, 'utf-8');
    const lines = content.split('\n').filter(line => line && !line.startsWith('#'));
    
    res.json({
      hasCookies: true,
      cookieCount: lines.length,
      lastModified: stats.mtime,
      fileSize: stats.size
    });
          } catch (error) {
    console.error('[Cookies] Status check error:', error);
    res.status(500).json({ error: 'Failed to check cookies status' });
  }
});

// Delete cookies endpoint
app.delete('/api/cookies', (req, res) => {
  try {
    if (fs.existsSync(cookiesPath)) {
      fs.unlinkSync(cookiesPath);
      console.log('[Cookies] Deleted cookies file');
    }
    
    res.json({ success: true, message: 'Cookies deleted successfully' });
      } catch (error) {
    console.error('[Cookies] Delete error:', error);
    res.status(500).json({ error: 'Failed to delete cookies' });
  }
});

// Extract video info endpoint
app.post('/api/extract', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Extract video ID from URL
    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    console.log(`[Extract] Processing video: ${videoId}`);
    
    // Extract video info
    const videoInfo = await youtubeExtractor.extract(videoId);
    
    res.json({
      success: true,
      data: videoInfo
    });
      } catch (error) {
    console.error('[Extract] Error:', error);
    res.status(500).json({ 
      error: 'Failed to extract video info',
      message: error.message
    });
  }
});

// Helper function to extract video ID from YouTube URL
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /^([a-zA-Z0-9_-]{11})$/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received, shutting down gracefully...');
  await youtubeExtractor.cleanup();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Server] SIGINT received, shutting down gracefully...');
  await youtubeExtractor.cleanup();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`[Server] Backend running on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Server] Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
