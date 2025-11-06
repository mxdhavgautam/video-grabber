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
import SQLiteSessionStore from './services/session-store.mjs';
import { getBrowserManager } from './services/browser-manager.mjs';

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

// Trust proxy - required for proper cookie handling behind reverse proxy (Caddy)
app.set('trust proxy', 1);

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.text({ limit: '10mb' }));
app.use(cookieParser());

// Session configuration with SQLite store for persistence
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.error('[Server] WARNING: SESSION_SECRET not set, using default (NOT SECURE FOR PRODUCTION)');
}

// Initialize SQLite session store
const sessionStore = new SQLiteSessionStore({
  dbPath: process.env.SESSION_DB_PATH
});

app.use(session({
  store: sessionStore,
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
  async (req, res) => {
    // Successful authentication - send loading page IMMEDIATELY
    console.log('[Server] OAuth callback successful for user:', req.user.id);
    console.log('[Server] Session ID:', req.sessionID);
    console.log('[Server] Is authenticated:', req.isAuthenticated());
    
    // Log successful authentication (non-blocking)
    db.logAuditEvent({
      userId: req.user.id,
      eventType: 'authentication',
      eventAction: 'oauth_login_success',
      eventDetails: { googleId: req.user.googleId, email: req.user.email },
      ipAddress: req.ip || 'unknown',
      userAgent: req.get('user-agent') || 'unknown',
      success: true
    });
    
    // Mark session as modified (only if session exists and has touch method)
    if (req.session && typeof req.session.touch === 'function') {
      req.session.touch();
    }
    
    // Send loading page IMMEDIATELY - don't wait for session save or browser automation
    console.log('[Server] Sending loading page immediately...');
    
    const loadingPage = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Setting up your account...</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
              background: hsl(0, 0%, 6%);
              color: hsl(0, 0%, 95%);
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
            }
            @media (prefers-color-scheme: light) {
              body {
                background: hsl(0, 0%, 100%);
                color: hsl(0, 0%, 8%);
              }
              .spinner {
                border-color: rgba(0, 0, 0, 0.1);
                border-top-color: hsl(0, 0%, 8%);
              }
              .status {
                color: hsl(0, 0%, 45%);
              }
            }
            .container {
              text-align: center;
              padding: 2rem;
              max-width: 500px;
            }
            .spinner {
              width: 50px;
              height: 50px;
              border: 4px solid rgba(255, 255, 255, 0.1);
              border-top-color: hsl(0, 0%, 95%);
              border-radius: 50%;
              animation: spin 1s linear infinite;
              margin: 0 auto 2rem;
            }
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
            h1 {
              font-size: 1.5rem;
              margin-bottom: 1rem;
              font-weight: 600;
              background: linear-gradient(to right, hsl(0, 0%, 95%), hsl(0, 0%, 60%));
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
            }
            @media (prefers-color-scheme: light) {
              h1 {
                background: linear-gradient(to right, hsl(0, 0%, 8%), hsl(0, 0%, 40%));
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
              }
            }
            .message {
              font-size: 1rem;
              opacity: 0.9;
              line-height: 1.6;
              color: hsl(0, 0%, 65%);
            }
            @media (prefers-color-scheme: light) {
              .message {
                color: hsl(0, 0%, 45%);
              }
            }
            .status {
              margin-top: 1.5rem;
              font-size: 0.9rem;
              opacity: 0.8;
              color: hsl(0, 0%, 65%);
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="spinner"></div>
            <h1>Setting up your account...</h1>
            <div class="message">
              We're preparing your server and extracting cookies from your browser session.
              <br>This may take a minute. Please wait...
            </div>
            <div class="status" id="status">Initializing...</div>
          </div>
          <script>
            let pollCount = 0;
            const maxPolls = 120; // 2 minutes max (1 second intervals)
            
            function updateStatus(message) {
              document.getElementById('status').textContent = message;
            }
            
            function checkReady() {
              pollCount++;
              
              if (pollCount > maxPolls) {
                updateStatus('Taking longer than expected. Redirecting anyway...');
                setTimeout(() => {
                  window.location.href = '${FRONTEND_URL}/?auth=success';
                }, 2000);
                return;
              }
              
              fetch('/api/auth/ready', {
                method: 'GET',
                credentials: 'include'
              })
              .then(res => res.json())
              .then(data => {
                if (data.ready) {
                  updateStatus('All set! Redirecting...');
                  setTimeout(() => {
                    window.location.href = '${FRONTEND_URL}/?auth=success';
                  }, 1000);
                } else {
                  updateStatus(data.message || 'Still setting up...');
                  setTimeout(checkReady, 1000);
                }
              })
              .catch(err => {
                console.error('Poll error:', err);
                updateStatus('Checking status...');
                setTimeout(checkReady, 1000);
              });
            }
            
            // Start polling after a short delay
            setTimeout(checkReady, 2000);
          </script>
        </body>
        </html>
      `;
    
    // Send response immediately
    res.send(loadingPage);
    
    // Save session in background (non-blocking)
    req.session.save((err) => {
      if (err) {
        console.error('[Server] Error saving session:', err);
      } else {
        console.log('[Server] Session saved in background');
      }
    });
    
    // Browser automation is already running in the Passport strategy callback
    // The loading page will poll /api/auth/ready to check when it's complete
  }
);

// Endpoint to check if browser setup is complete
app.get('/api/auth/ready', (req, res) => {
  // More lenient check - allow checking even if not fully authenticated yet
  // The session might still be setting up
  const user = authService.getUserFromSession(req);
  if (!user) {
    // Try to get user from session ID if available
    if (req.sessionID) {
      // Session exists but user not loaded yet - still setting up
      return res.json({ ready: false, message: 'Setting up session...' });
    }
    return res.json({ ready: false, message: 'Not authenticated' });
  }
  
  // Check if browser instance is ready
  const browserManager = getBrowserManager();
  const hasBrowser = browserManager.hasActiveBrowser(user.id);
  
  if (hasBrowser) {
    // Browser is ready, check if cookies are available
    const cookieFilePath = cookieExtractor.getCookieFilePath(user.id);
    if (cookieFilePath && fs.existsSync(cookieFilePath)) {
      try {
        const stats = fs.statSync(cookieFilePath);
        if (stats.size > 0) {
          console.log(`[Server] /api/auth/ready - Browser and cookies ready for user ${user.id}`);
          return res.json({ ready: true, message: 'Setup complete!' });
        }
      } catch (error) {
        console.error(`[Server] /api/auth/ready - Error checking cookie file:`, error.message);
      }
    }
    
    // Browser is ready even if cookies file check fails
    console.log(`[Server] /api/auth/ready - Browser ready for user ${user.id}`);
    return res.json({ ready: true, message: 'Browser ready' });
  }
  
  // Still setting up
  return res.json({ ready: false, message: 'Setting up browser and extracting cookies...' });
});

// Database reset endpoint (for fresh start)
app.post('/api/admin/reset-database', async (req, res) => {
  try {
    console.log('[Server] Database reset requested');
    
    // Close current database connection
    db.close();
    
    // Delete database file
    const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'database', 'video-grabber.db');
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      console.log('[Server] Deleted database file:', dbPath);
    }
    
    // Delete session database
    const sessionDbPath = process.env.SESSION_DB_PATH || 
                          path.join(process.env.DATABASE_PATH ? path.dirname(process.env.DATABASE_PATH) : process.cwd(), 'database', 'sessions.db');
    if (fs.existsSync(sessionDbPath)) {
      fs.unlinkSync(sessionDbPath);
      console.log('[Server] Deleted session database file:', sessionDbPath);
    }
    
    // Delete all cookie files
    const cookiesDir = process.env.COOKIES_DIR || path.join(process.cwd(), 'cookies');
    if (fs.existsSync(cookiesDir)) {
      const files = fs.readdirSync(cookiesDir);
      for (const file of files) {
        if (file.endsWith('.txt')) {
          fs.unlinkSync(path.join(cookiesDir, file));
        }
      }
      console.log('[Server] Deleted cookie files');
    }
    
    // Delete Chrome profiles
    const chromeProfileDir = process.env.CHROME_PROFILE_DIR || '/var/lib/video-grabber/chrome-profiles';
    if (fs.existsSync(chromeProfileDir)) {
      const profiles = fs.readdirSync(chromeProfileDir);
      for (const profile of profiles) {
        const profilePath = path.join(chromeProfileDir, profile);
        if (fs.statSync(profilePath).isDirectory()) {
          fs.rmSync(profilePath, { recursive: true, force: true });
        }
      }
      console.log('[Server] Deleted Chrome profiles');
    }
    
    // Reinitialize database (will create new schema)
    const { getDatabase: getDb } = await import('./services/database.mjs');
    const newDb = getDb();
    
    res.json({ 
      success: true, 
      message: 'Database reset successfully. Please restart the server.',
      note: 'The database will be reinitialized on next request'
    });
  } catch (error) {
    console.error('[Server] Database reset error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to reset database',
      message: error.message
    });
  }
});

// Logout endpoint
app.post('/auth/logout', async (req, res) => {
  const userId = req.user?.id;
  const ipAddress = req.ip || 'unknown';
  const userAgent = req.get('user-agent') || 'unknown';
  
  // Stop browser instance for user
  if (userId) {
    try {
      const browserManager = getBrowserManager();
      await browserManager.stopBrowserForUser(userId);
      console.log(`[Server] Stopped browser instance for user: ${userId}`);
    } catch (browserError) {
      console.error(`[Server] Error stopping browser for user ${userId}:`, browserError.message);
    }
  }
  
  // Clear session cookie explicitly
  const clearSessionCookie = () => {
    res.clearCookie('video-grabber-session', {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });
  };
  
  // Logout doesn't require authentication - allow logout even if session is invalid
  req.logout((err) => {
    if (err) {
      console.error('[Server] Logout error:', err);
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
    }
    
    // Destroy session after logout
    req.session.destroy((err) => {
      // Clear session cookie regardless of errors
      clearSessionCookie();
      
      if (err) {
        console.error('[Server] Session destroy error:', err);
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
      } else {
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
      }
      
      // Always return success and clear cookie
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

// Extract cookies endpoint (triggered after OAuth login)
app.post('/auth/extract-cookies', authService.requireAuth.bind(authService), async (req, res) => {
  try {
    const user = authService.getUserFromSession(req);
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    console.log(`[Server] Cookie extraction requested for user: ${user.id}`);

    // Get user's OAuth tokens from database
    const userData = db.getUserById(user.id);
    if (!userData || !userData.access_token) {
      return res.status(400).json({ error: 'No OAuth tokens found. Please sign in again.' });
    }

    // Extract cookies using OAuth token
    try {
      const { cookies } = await cookieExtractor.extractCookiesFromOAuth(
        userData.access_token,
        userData.refresh_token
      );

      if (cookies && cookies.length > 0) {
        // Save cookies to file
        const cookieFilePath = cookieExtractor.saveCookiesToFile(user.id, cookies);
        
        // Calculate cookie expiration (30 days default)
        const cookieExpiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
        
        // Update database with cookie file path
        db.updateUserCookies(user.id, cookieFilePath, cookieExpiresAt);
        
        // Log successful extraction
        db.logAuditEvent({
          userId: user.id,
          eventType: 'cookie',
          eventAction: 'extract_cookies_success',
          eventDetails: { cookieCount: cookies.length },
          ipAddress: req.ip || 'unknown',
          userAgent: req.get('user-agent') || 'unknown',
          success: true
        });
        
        console.log(`[Server] ✓ Extracted and saved ${cookies.length} cookies for user ${user.id}`);
        
        return res.json({ 
          success: true, 
          message: `Extracted ${cookies.length} cookies`,
          cookieCount: cookies.length
        });
      } else {
        console.warn(`[Server] ⚠️ No cookies extracted for user ${user.id}`);
        
        db.logAuditEvent({
          userId: user.id,
          eventType: 'cookie',
          eventAction: 'extract_cookies_failed',
          eventDetails: { reason: 'No cookies returned' },
          ipAddress: req.ip || 'unknown',
          userAgent: req.get('user-agent') || 'unknown',
          success: false,
          errorMessage: 'No cookies extracted from OAuth session'
        });
        
        return res.status(400).json({ 
          success: false,
          error: 'No cookies extracted. This may be due to YouTube restrictions.' 
        });
      }
    } catch (cookieError) {
      console.error(`[Server] Cookie extraction error for user ${user.id}:`, cookieError.message);
      
      db.logAuditEvent({
        userId: user.id,
        eventType: 'cookie',
        eventAction: 'extract_cookies_error',
        eventDetails: { error: cookieError.message },
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('user-agent') || 'unknown',
        success: false,
        errorMessage: cookieError.message
      });
      
      return res.status(500).json({ 
        success: false,
        error: `Cookie extraction failed: ${cookieError.message}` 
      });
    }
  } catch (error) {
    console.error('[Server] Cookie extraction endpoint error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Internal server error' 
    });
  }
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
    
    // Use browser manager to navigate to video URL and extract fresh cookies
    const browserManager = getBrowserManager();
    let freshCookies = null;
    
    try {
      // Navigate to video URL in browser and extract fresh cookies
      freshCookies = await browserManager.navigateToVideoAndExtractCookies(user.id, url);
      
      if (freshCookies && freshCookies.length > 0) {
        // Save fresh cookies to file
        const freshCookieFilePath = cookieExtractor.saveCookiesToFile(user.id, freshCookies);
        const cookieExpiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
        db.updateUserCookies(user.id, freshCookieFilePath, cookieExpiresAt);
        
        // Get temporary decrypted cookie file with fresh cookies
        if (tempCookieFilePath) {
          cookieExtractor.cleanupTemporaryCookieFile(tempCookieFilePath);
        }
        tempCookieFilePath = cookieExtractor.getTemporaryDecryptedCookieFile(user.id);
        
        console.log(`[Extract] Extracted ${freshCookies.length} fresh cookies from browser for video: ${videoId}`);
      } else {
        console.warn(`[Extract] No fresh cookies extracted, using existing cookies`);
      }
    } catch (browserError) {
      console.error(`[Extract] Error navigating to video in browser:`, browserError.message);
      console.log(`[Extract] Falling back to existing cookies`);
      // Continue with existing cookies if browser navigation fails
    }
    
    // Extract video info with user's cookies (fresh or existing)
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
