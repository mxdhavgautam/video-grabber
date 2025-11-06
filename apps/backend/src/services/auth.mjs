/**
 * Authentication Service
 * 
 * Handles Google OAuth authentication using Passport.js
 * Manages user sessions and cookie extraction from OAuth tokens
 */

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { getDatabase } from './database.mjs';
import CookieExtractor from './cookie-extractor.mjs';
import UserBrowserService from './user-browser-service.mjs';

// Helper to get client info from request (if available)
function getClientInfo(req) {
  return {
    ipAddress: req?.ip || req?.connection?.remoteAddress || 'unknown',
    userAgent: req?.get?.('user-agent') || 'unknown'
  };
}

class AuthService {
  constructor() {
    this.db = getDatabase();
    this.cookieExtractor = new CookieExtractor();
    
    // Initialize Passport strategies
    this.initializePassport();
  }

  /**
   * Initialize Passport.js with Google OAuth strategy
   */
  initializePassport() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const callbackURL = process.env.OAUTH_REDIRECT_URI || 
      `${process.env.BACKEND_URL || 'http://localhost:3001'}/auth/google/callback`;

    if (!clientId || !clientSecret) {
      console.error('[Auth] ERROR: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
      throw new Error('OAuth credentials not configured');
    }

    // Configure Google OAuth strategy
    // access_type: 'offline' and prompt: 'consent' ensure we get a refresh token
    passport.use(new GoogleStrategy(
      {
        clientID: clientId,
        clientSecret: clientSecret,
        callbackURL: callbackURL,
        scope: ['profile', 'email', 'openid'],
        accessType: 'offline',
        prompt: 'consent'
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          console.log('[Auth] OAuth callback received for user:', profile.id);
          
          // Store tokens
          const tokens = {
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: 3600, // Default 1 hour
            expiry_date: Date.now() + 3600 * 1000
          };

          // Upsert user in database
          const userId = this.db.upsertUser(profile, tokens);
          console.log('[Auth] User upserted:', userId);

          // Return user profile IMMEDIATELY - don't wait for browser automation
          // This allows the loading page to show up right away
          done(null, {
            id: userId,
            googleId: profile.id,
            email: profile.emails?.[0]?.value || profile.email,
            name: profile.displayName || profile.name,
            picture: profile.photos?.[0]?.value || profile.picture
          });

          // Run browser automation in BACKGROUND (non-blocking)
          // This happens after the response is sent
          (async () => {
            try {
              console.log('[Auth] Starting background browser automation to generate session cookies...');
              
              // Step 1: Extract initial cookies from OAuth (may be incomplete)
              let initialCookies = [];
              try {
                const { cookies } = await this.cookieExtractor.extractCookiesFromOAuth(
                  accessToken,
                  refreshToken
                );
                if (cookies && cookies.length > 0) {
                  initialCookies = cookies;
                  console.log(`[Auth] Extracted ${initialCookies.length} initial cookies from OAuth`);
                }
              } catch (initialCookieError) {
                console.warn('[Auth] Initial cookie extraction failed (will continue with browser):', initialCookieError.message);
              }

              // Step 2: Use browser automation to generate proper session cookies
              const browserService = new UserBrowserService(
                userId,
                this.cookieExtractor.cookiesDir,
                null // profileDir will be auto-generated
              );

              try {
                console.log('[Auth] Starting browser automation to generate session cookies...');
                const browserCookies = await browserService.startAndAuthenticate(
                  accessToken,
                  refreshToken,
                  initialCookies
                );

                if (browserCookies && browserCookies.length > 0) {
                  // Browser service already saved cookies to file, just update database
                  const cookieFilePath = browserService.cookieFilePath;
                  const cookieExpiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
                  this.db.updateUserCookies(userId, cookieFilePath, cookieExpiresAt);
                  
                  // Check for critical cookies
                  const criticalCookies = ['__Secure-3PSID', '__Secure-3PAPISID', 'LOGIN_INFO', 'VISITOR_INFO1_LIVE', 'YSC', 'CONSENT'];
                  const found = criticalCookies.filter(name => browserCookies.some(c => c.name === name));
                  const missing = criticalCookies.filter(name => !browserCookies.some(c => c.name === name));
                  
                  if (found.length > 0) {
                    console.log(`[Auth] ✓ Generated ${browserCookies.length} cookies with critical cookies: ${found.join(', ')}`);
                  }
                  if (missing.length > 0) {
                    console.warn(`[Auth] ⚠️ Missing critical cookies: ${missing.join(', ')}`);
                  }
                } else {
                  console.warn('[Auth] ⚠️ Browser automation did not generate cookies');
                }

                // Clean up browser instance
                await browserService.stop();
              } catch (browserError) {
                console.error('[Auth] Browser automation failed:', browserError.message);
                // Fallback: Use initial cookies if available
                if (initialCookies.length > 0) {
                  console.log('[Auth] Falling back to initial OAuth cookies...');
                  const cookieFilePath = this.cookieExtractor.saveCookiesToFile(userId, initialCookies);
                  const cookieExpiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
                  this.db.updateUserCookies(userId, cookieFilePath, cookieExpiresAt);
                  console.log(`[Auth] ✓ Saved ${initialCookies.length} initial cookies as fallback`);
                }
              }
            } catch (cookieError) {
              console.error('[Auth] Failed to extract cookies in background:', cookieError.message);
              // Continue - user can still use the app, cookies will be extracted on next login
            }
          })();
        } catch (error) {
          console.error('[Auth] OAuth callback error:', error);
          return done(error, null);
        }
      }
    ));

    // Serialize user for session
    passport.serializeUser((user, done) => {
      done(null, user.id);
    });

    // Deserialize user from session
    passport.deserializeUser((userId, done) => {
      try {
        const user = this.db.getUserById(userId);
        if (!user) {
          return done(new Error('User not found'), null);
        }
        
        // Return user without sensitive tokens
        done(null, {
          id: user.id,
          googleId: user.google_id,
          email: user.email,
          name: user.name,
          picture: user.picture
        });
      } catch (error) {
        done(error, null);
      }
    });

    console.log('[Auth] Passport.js initialized with Google OAuth strategy');
  }

  /**
   * Get user from session
   */
  getUserFromSession(req) {
    return req.user || null;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(req) {
    return req.isAuthenticated && req.isAuthenticated();
  }

  /**
   * Require authentication middleware
   */
  requireAuth(req, res, next) {
    if (this.isAuthenticated(req)) {
      return next();
    }
    
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please sign in with Google to continue'
    });
  }

  /**
   * Refresh OAuth access token using refresh token
   * @param {string} refreshToken - OAuth refresh token
   * @returns {Promise<Object|null>} - New tokens or null if refresh failed
   */
  async refreshAccessToken(refreshToken) {
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error('OAuth credentials not configured');
      }

      const tokenEndpoint = 'https://oauth2.googleapis.com/token';
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      });

      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Auth] Token refresh failed:', response.status, errorText);
        return null;
      }

      const data = await response.json();
      
      return {
        access_token: data.access_token,
        refresh_token: refreshToken, // Refresh token doesn't change
        expires_in: data.expires_in || 3600,
        expiry_date: Date.now() + (data.expires_in || 3600) * 1000
      };
    } catch (error) {
      console.error('[Auth] Error refreshing access token:', error.message);
      return null;
    }
  }

  /**
   * Ensure user has valid access token (refresh if needed)
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - True if token is valid/refreshed, false otherwise
   */
  async ensureValidAccessToken(userId) {
    try {
      const user = this.db.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if access token is expired (with 5 minute buffer)
      const now = Date.now();
      const expiresAt = user.token_expires_at || 0;
      const bufferTime = 5 * 60 * 1000; // 5 minutes

      if (expiresAt > (now + bufferTime)) {
        // Token is still valid
        return true;
      }

      // Token expired or expiring soon, refresh it
      if (!user.refresh_token) {
        console.warn('[Auth] No refresh token available for user:', userId);
        return false;
      }

      console.log('[Auth] Refreshing access token for user:', userId);
      const newTokens = await this.refreshAccessToken(user.refresh_token);

      if (!newTokens) {
        console.error('[Auth] Failed to refresh access token for user:', userId);
        return false;
      }

      // Update tokens in database
      this.db.updateUserTokens(userId, newTokens);
      console.log('[Auth] ✓ Access token refreshed for user:', userId);

      return true;
    } catch (error) {
      console.error('[Auth] Error ensuring valid access token:', error.message);
      return false;
    }
  }

  /**
   * Refresh cookies for user (if expired)
   */
  async refreshCookiesForUser(userId) {
    try {
      const user = this.db.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Ensure access token is valid (refresh if needed)
      const tokenValid = await this.ensureValidAccessToken(userId);
      if (!tokenValid) {
        console.warn('[Auth] Cannot refresh cookies - access token invalid and refresh failed');
        return false;
      }

      // Get updated user data (with refreshed token if it was refreshed)
      const updatedUser = this.db.getUserById(userId);

      // Check if cookies are expired
      if (updatedUser.cookie_expires_at && updatedUser.cookie_expires_at > Date.now()) {
        console.log('[Auth] Cookies still valid for user:', userId);
        return true;
      }

      // Use browser automation to refresh cookies
      console.log('[Auth] Refreshing cookies using browser automation...');
      
      // Extract initial cookies first
      let initialCookies = [];
      try {
        const { cookies } = await this.cookieExtractor.extractCookiesFromOAuth(
          updatedUser.access_token,
          updatedUser.refresh_token
        );
        if (cookies && cookies.length > 0) {
          initialCookies = cookies;
        }
      } catch (e) {
        // Continue without initial cookies
      }

      // Use browser service to generate fresh cookies
      const browserService = new UserBrowserService(
        userId,
        this.cookieExtractor.cookiesDir,
        null
      );

      try {
        const browserCookies = await browserService.startAndAuthenticate(
          updatedUser.access_token,
          updatedUser.refresh_token,
          initialCookies
        );

        if (browserCookies && browserCookies.length > 0) {
          const cookieFilePath = browserService.cookieFilePath;
          const cookieExpiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000);
          this.db.updateUserCookies(userId, cookieFilePath, cookieExpiresAt);
          
          console.log(`[Auth] ✓ Refreshed cookies for user ${userId} using browser automation`);
          await browserService.stop();
          return true;
        }

        await browserService.stop();
      } catch (browserError) {
        console.error('[Auth] Browser automation refresh failed:', browserError.message);
        await browserService.stop().catch(() => {});
      }

      return false;
    } catch (error) {
      console.error('[Auth] Failed to refresh cookies:', error.message);
      return false;
    }
  }
}

// Export singleton instance
let authInstance = null;

export function getAuthService() {
  if (!authInstance) {
    authInstance = new AuthService();
  }
  return authInstance;
}

export default AuthService;

