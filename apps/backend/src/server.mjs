/**
 * Express Server with OAuth Authentication
 * 
 * Handles Google OAuth authentication, per-user cookie management,
 * and YouTube video extraction with rate limiting.
 */

import express from 'express';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import passport from 'passport';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase } from './services/database.mjs';
import { getAuthService } from './services/auth.mjs';
import YouTubeExtractor from './services/youtube-extractor.mjs';
import CookieExtractor from './services/cookie-extractor.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;

// Initialize services
const db = getDatabase();
const authService = getAuthService();
const cookieExtractor = new CookieExtractor();
let youtubeExtractor = null;

// Initialize YouTube extractor (no cookie generator needed)
(async () => {
  try {
    youtubeExtractor = new YouTubeExtractor();
    await youtubeExtractor.init();
    console.log('[Server] YouTube extractor initialized');
  } catch (error) {
    console.error('[Server] Failed to initialize YouTube extractor:', error.message);
  }
})();

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.text({ limit: '10mb' }));
app.use(cookieParser());

// Session configuration
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.error('[Server] WARNING: SESSION_SECRET not set, using default (NOT SECURE FOR PRODUCTION)');
}

app.use(session({
  secret: sessionSecret || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production (required for sameSite: 'none')
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 'none' required for cross-subdomain cookies
    domain: process.env.NODE_ENV === 'production' ? '.mxdhavgautam.com' : undefined, // Allow cross-subdomain cookies in production
    path: '/' // Explicitly set path to root to ensure cookie is accessible from all paths
  },
  name: process.env.SESSION_COOKIE_NAME || 'video-grabber-session'
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Debug middleware to log all cookies
app.use((req, res, next) => {
  if (req.path === '/api/user' || req.path === '/auth/google/callback') {
    console.log(`[Debug] ${req.method} ${req.path} - All cookies:`, req.headers.cookie);
    console.log(`[Debug] ${req.method} ${req.path} - Origin:`, req.headers.origin);
    console.log(`[Debug] ${req.method} ${req.path} - Referer:`, req.headers.referer);
  }
  next();
});

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

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// OAuth Routes
app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email', 'openid'],
  accessType: 'offline',
  prompt: 'consent'
}));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: `${FRONTEND_URL}/login?error=auth_failed` }),
  (req, res) => {
    // Successful authentication
    console.log('[Server] OAuth callback successful for user:', req.user.id);
    console.log('[Server] Session ID:', req.sessionID);
    console.log('[Server] Session cookie:', req.session.cookie);
    console.log('[Server] Is authenticated:', req.isAuthenticated());
    
    // Log successful authentication
    db.logAuditEvent({
      userId: req.user.id,
      eventType: 'authentication',
      eventAction: 'oauth_login_success',
      eventDetails: { googleId: req.user.googleId, email: req.user.email },
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('user-agent') || 'unknown',
      success: true
    });
    
    // Mark session as modified to ensure express-session sets the cookie
    // Then save the session - express-session will automatically set the cookie
    req.session.touch();
    req.session.save((err) => {
      if (err) {
        console.error('[Server] Error saving session before redirect:', err);
        return res.redirect(`${FRONTEND_URL}/?auth=error`);
      }
      
      console.log('[Server] Session saved, redirecting to frontend');
      console.log('[Server] Session ID:', req.sessionID);
      console.log('[Server] Session cookie config:', req.session.cookie);
      
      // Use a small delay to ensure session is fully committed to MemoryStore
      // This is necessary because redirects can happen before the session is fully saved
      setImmediate(() => {
        res.redirect(`${FRONTEND_URL}/?auth=success`);
      });
    });
  }
);

// Logout endpoint
app.post('/auth/logout', (req, res) => {
  const userId = req.user?.id;
  const ipAddress = req.ip || 'unknown';
  const userAgent = req.get('user-agent') || 'unknown';
  
  req.logout((err) => {
    if (err) {
      db.logAuditEvent({
        userId,
        eventType: 'authentication',
        eventAction: 'logout_failed',
        eventDetails: { error: err.message },
        ipAddress,
        userAgent,
        success: false,
        errorMessage: err.message
      });
      
      return res.status(500).json({ error: 'Logout failed' });
    }
    req.session.destroy((err) => {
      if (err) {
        db.logAuditEvent({
          userId,
          eventType: 'authentication',
          eventAction: 'logout_session_destroy_failed',
          eventDetails: { error: err.message },
          ipAddress,
          userAgent,
          success: false,
          errorMessage: err.message
        });
        
        return res.status(500).json({ error: 'Session destruction failed' });
      }
      
      // Log successful logout
      db.logAuditEvent({
        userId,
        eventType: 'authentication',
        eventAction: 'logout_success',
        eventDetails: {},
        ipAddress,
        userAgent,
        success: true
      });
      
      res.json({ success: true, message: 'Logged out successfully' });
    });
  });
});

// Get current user endpoint
app.get('/api/user', (req, res) => {
  console.log('[Server] /api/user request - Session ID:', req.sessionID);
  console.log('[Server] /api/user request - Is authenticated:', req.isAuthenticated());
  console.log('[Server] /api/user request - User:', req.user);
  console.log('[Server] /api/user request - Cookies:', req.headers.cookie);
  
  if (!authService.isAuthenticated(req)) {
    console.log('[Server] /api/user - Not authenticated, returning 401');
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const user = authService.getUserFromSession(req);
  console.log('[Server] /api/user - Returning user:', user);
  res.json({ 
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture
  });
});

// Get user's cookie status
app.get('/api/cookies-status', authService.requireAuth.bind(authService), (req, res) => {
  try {
    const user = authService.getUserFromSession(req);
    const cookieFilePath = cookieExtractor.getCookieFilePath(user.id);
    
    if (!cookieFilePath || !fs.existsSync(cookieFilePath)) {
      return res.json({ 
        hasCookies: false,
        message: 'No cookies found. Please sign in again to generate cookies.'
      });
    }

    const stats = fs.statSync(cookieFilePath);
    const content = fs.readFileSync(cookieFilePath, 'utf-8');
    const lines = content.split('\n').filter(line => line && !line.startsWith('#'));
    
    res.json({
      hasCookies: true,
      cookieCount: lines.length,
      lastModified: stats.mtime,
      fileSize: stats.size
    });
          } catch (error) {
    console.error('[Server] Cookie status error:', error);
    res.status(500).json({ error: 'Failed to check cookie status' });
  }
});

// Extract video info endpoint (requires authentication)
app.post('/api/extract', authService.requireAuth.bind(authService), async (req, res) => {
  let tempCookieFilePath = null;
  
  try {
    // Get client info for audit logging
    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('user-agent') || 'unknown';

    // Wait for extractor to be initialized
    let attempts = 0;
    while (!youtubeExtractor && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    if (!youtubeExtractor) {
      db.logAuditEvent({
        userId: req.user?.id,
        eventType: 'extraction',
        eventAction: 'extract_video',
        eventDetails: { error: 'Service not ready' },
        ipAddress,
        userAgent,
        success: false,
        errorMessage: 'YouTube extractor is not ready yet'
      });
      
      return res.status(503).json({ 
        error: 'Service initializing, please try again in a moment',
        message: 'YouTube extractor is not ready yet'
      });
    }

    const user = authService.getUserFromSession(req);
    if (!user || !user.id) {
      db.logAuditEvent({
        userId: null,
        eventType: 'authentication',
        eventAction: 'extract_attempt',
        eventDetails: { error: 'User not in session' },
        ipAddress,
        userAgent,
        success: false,
        errorMessage: 'User not found in session'
      });
      
      return res.status(401).json({ error: 'User not found in session' });
    }

    // Check rate limit (30 videos per hour)
    const rateLimit = db.checkRateLimit(user.id, 30, 3600000);
    if (!rateLimit.allowed) {
      const resetTime = new Date(rateLimit.resetAt);
      
      db.logAuditEvent({
        userId: user.id,
        eventType: 'rate_limit',
        eventAction: 'rate_limit_exceeded',
        eventDetails: { resetAt: rateLimit.resetAt, remaining: rateLimit.remaining },
        ipAddress,
        userAgent,
        success: false,
        errorMessage: 'Rate limit exceeded'
      });
      
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `You have reached the rate limit of 30 videos per hour. Please try again after ${resetTime.toISOString()}`,
        resetAt: rateLimit.resetAt,
        remaining: rateLimit.remaining
      });
    }

    // Explicit cookie expiration check
    const cookieExpirationCheck = cookieExtractor.checkCookieExpiration(user.id);
    if (!cookieExpirationCheck.valid) {
      console.log(`[Extract] Cookie expiration check: ${cookieExpirationCheck.message}`);
      
      // Try to refresh cookies
      const refreshSuccess = await authService.refreshCookiesForUser(user.id);
      
      if (!refreshSuccess) {
        db.logAuditEvent({
          userId: user.id,
          eventType: 'cookie',
          eventAction: 'cookie_refresh_failed',
          eventDetails: { expirationCheck: cookieExpirationCheck },
          ipAddress,
          userAgent,
          success: false,
          errorMessage: cookieExpirationCheck.message
        });
        
        return res.status(401).json({
          error: 'Cookies expired',
          message: cookieExpirationCheck.message + '. Please sign in again to generate fresh cookies.'
        });
      }
    }

    // Get user's cookie file path
    const userData = db.getUserById(user.id);
    const encryptedCookieFilePath = userData?.cookie_file_path || cookieExtractor.getCookieFilePath(user.id);

    // Check if encrypted cookie file exists
    if (!encryptedCookieFilePath || !fs.existsSync(encryptedCookieFilePath)) {
      db.logAuditEvent({
        userId: user.id,
        eventType: 'cookie',
        eventAction: 'cookie_file_missing',
        eventDetails: {},
        ipAddress,
        userAgent,
        success: false,
        errorMessage: 'Cookie file not found'
      });
      
      return res.status(401).json({
        error: 'No cookies found',
        message: 'Please sign in again to generate cookies from your Google account.'
      });
    }

    // Get temporary decrypted cookie file for yt-dlp
    tempCookieFilePath = cookieExtractor.getTemporaryDecryptedCookieFile(user.id);
    if (!tempCookieFilePath) {
      db.logAuditEvent({
        userId: user.id,
        eventType: 'cookie',
        eventAction: 'cookie_decrypt_failed',
        eventDetails: {},
        ipAddress,
        userAgent,
        success: false,
        errorMessage: 'Failed to decrypt cookie file'
      });
      
      return res.status(500).json({
        error: 'Cookie decryption failed',
        message: 'Failed to decrypt cookies. Please sign in again.'
      });
    }

    const { url } = req.body;
    
    if (!url) {
      db.logAuditEvent({
        userId: user.id,
        eventType: 'extraction',
        eventAction: 'extract_attempt',
        eventDetails: { error: 'URL missing' },
        ipAddress,
        userAgent,
        success: false,
        errorMessage: 'URL is required'
      });
      
      return res.status(400).json({ error: 'URL is required' });
    }

    // Extract video ID from URL
    const videoId = extractVideoId(url);
    if (!videoId) {
      db.logAuditEvent({
        userId: user.id,
        eventType: 'extraction',
        eventAction: 'extract_attempt',
        eventDetails: { url, error: 'Invalid URL' },
        ipAddress,
        userAgent,
        success: false,
        errorMessage: 'Invalid YouTube URL'
      });
      
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    console.log(`[Extract] Processing video: ${videoId} for user: ${user.id}`);
    
    // Extract video info with user's cookies
    const videoInfo = await youtubeExtractor.extract(videoId, tempCookieFilePath);
    
    // Log successful extraction
    db.logAuditEvent({
      userId: user.id,
      eventType: 'extraction',
      eventAction: 'extract_success',
      eventDetails: { videoId, url },
      ipAddress,
      userAgent,
      success: true
    });
    
    res.json({
      success: true,
      data: videoInfo,
      rateLimit: {
        remaining: rateLimit.remaining,
        resetAt: rateLimit.resetAt
      }
    });
  } catch (error) {
    console.error('[Extract] Error:', error);
    
    // Log error
    db.logAuditEvent({
      userId: req.user?.id,
      eventType: 'extraction',
      eventAction: 'extract_error',
      eventDetails: { error: error.message },
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('user-agent') || 'unknown',
      success: false,
      errorMessage: error.message
    });
    
    res.status(500).json({ 
      error: 'Failed to extract video info',
      message: error.message
    });
  } finally {
    // Clean up temporary decrypted cookie file
    if (tempCookieFilePath) {
      cookieExtractor.cleanupTemporaryCookieFile(tempCookieFilePath);
    }
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
  if (youtubeExtractor) {
    await youtubeExtractor.cleanup();
  }
  db.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Server] SIGINT received, shutting down gracefully...');
  if (youtubeExtractor) {
    await youtubeExtractor.cleanup();
  }
  db.close();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`[Server] Backend running on port ${PORT}`);
  console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`[Server] Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  console.log(`[Server] Frontend URL: ${FRONTEND_URL}`);
  console.log(`[Server] OAuth enabled - authentication required for video extraction`);
});
