/**
 * Cookie Extractor Service
 * 
 * Extracts YouTube session cookies from OAuth tokens using youtubei.js.
 * Converts cookies to Netscape format for yt-dlp compatibility.
 * Encrypts cookie files at rest for security.
 */

import { Innertube } from 'youtubei.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

class CookieExtractor {
  constructor(cookiesDir = null) {
    this.cookiesDir = cookiesDir || process.env.COOKIES_DIR || path.join(process.cwd(), 'cookies');
    
    // Ensure cookies directory exists
    if (!fs.existsSync(this.cookiesDir)) {
      fs.mkdirSync(this.cookiesDir, { recursive: true });
      console.log(`[CookieExtractor] Created cookies directory: ${this.cookiesDir}`);
    }
    
    // Get encryption key (same as database service)
    this.encryptionKey = this.getEncryptionKey();
  }

  /**
   * Get or generate encryption key from environment variable
   */
  getEncryptionKey() {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      console.warn('[CookieExtractor] WARNING: ENCRYPTION_KEY not set, using default (NOT SECURE FOR PRODUCTION)');
      return crypto.scryptSync('default-key-change-in-production', 'salt', 32);
    }
    
    if (key.length === 64) {
      return Buffer.from(key, 'hex');
    }
    
    return crypto.scryptSync(key, 'video-grabber-salt', 32);
  }

  /**
   * Encrypt cookie file content
   */
  encryptCookieContent(text) {
    if (!text) return null;
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return IV + encrypted data
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt cookie file content
   */
  decryptCookieContent(encryptedText) {
    if (!encryptedText) return null;
    
    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 2) {
        console.error('[CookieExtractor] Invalid encrypted format');
        return null;
      }
      
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      console.error('[CookieExtractor] Decryption error:', error.message);
      return null;
    }
  }

  /**
   * Extract cookies from OAuth tokens using youtubei.js
   * @param {string} accessToken - OAuth access token
   * @param {string} refreshToken - OAuth refresh token (optional)
   * @returns {Promise<Object>} - YouTube session with cookies
   */
  async extractCookiesFromOAuth(accessToken, refreshToken = null) {
    try {
      console.log('[CookieExtractor] Initializing youtubei.js with OAuth tokens...');
      
      // Create YouTube session with OAuth tokens
      // youtubei.js can use OAuth tokens directly
      const session = await Innertube.create({
        fetch: async (input, init) => {
          // Add OAuth token to requests
          const headers = new Headers(init?.headers || {});
          headers.set('Authorization', `Bearer ${accessToken}`);
          
          return fetch(input, {
            ...init,
            headers
          });
        }
      });

      // Alternative: Use OAuth to authenticate
      // Some versions of youtubei.js support OAuth directly
      try {
        // Try to sign in with OAuth tokens
        if (refreshToken) {
          await session.oauth.signInWithRefreshToken(refreshToken);
        } else {
          // Use access token to authenticate
          await session.oauth.signInWithAccessToken(accessToken);
        }
      } catch (oauthError) {
        console.warn('[CookieExtractor] OAuth sign-in method not available, using session directly:', oauthError.message);
        // Continue with session - cookies may be available from initial requests
      }

      // Get cookies from session
      // youtubei.js stores cookies internally
      const cookies = await this.getCookiesFromSession(session);
      
      console.log(`[CookieExtractor] Extracted ${cookies.length} cookies from OAuth session`);
      
      return {
        session,
        cookies
      };
    } catch (error) {
      console.error('[CookieExtractor] Failed to extract cookies from OAuth:', error.message);
      throw new Error(`Cookie extraction failed: ${error.message}`);
    }
  }

  /**
   * Get cookies from youtubei.js session
   * @param {Object} session - YouTube session object
   * @returns {Promise<Array>} - Array of cookie objects
   */
  async getCookiesFromSession(session) {
    try {
      // youtubei.js stores cookies in session.context.client
      // We need to extract them from the session's cookie jar
      const cookies = [];
      
      // Try to access cookies from session
      if (session.context && session.context.client) {
        // Check if cookies are stored in client
        const client = session.context.client;
        
        // youtubei.js may store cookies in different places
        // Try common locations
        if (client.cookies) {
          return client.cookies;
        }
        
        // Try to get cookies from HTTP client
        if (client.http && client.http.cookies) {
          return client.http.cookies;
        }
      }

      // Alternative: Make a request to YouTube to trigger cookie generation
      // This will cause youtubei.js to set cookies
      try {
        await session.getHomeFeed();
        // After making a request, cookies should be available
        // This is a workaround if cookies aren't directly accessible
      } catch (feedError) {
        console.warn('[CookieExtractor] Could not fetch home feed to generate cookies:', feedError.message);
      }

      // Try again to get cookies after making request
      if (session.context && session.context.client) {
        const client = session.context.client;
        if (client.cookies) {
          return client.cookies;
        }
      }

      // If we still don't have cookies, try to extract from session storage
      // Some versions store cookies in a cookie jar
      return this.extractCookiesFromSessionStorage(session);
    } catch (error) {
      console.error('[CookieExtractor] Error getting cookies from session:', error.message);
      return [];
    }
  }

  /**
   * Extract cookies from session storage (fallback method)
   */
  async extractCookiesFromSessionStorage(session) {
    // This is a fallback - youtubei.js may store cookies differently
    // We'll need to inspect the session object to find where cookies are stored
    const cookies = [];
    
    // Try to extract from any cookie storage mechanism
    // This is implementation-specific and may need adjustment based on youtubei.js version
    try {
      // Check if session has a cookie jar or similar
      if (session.cookieJar) {
        // Extract cookies from cookie jar
        const jar = session.cookieJar;
        const cookiesList = jar.getCookiesSync('https://www.youtube.com');
        return cookiesList.map(cookie => ({
          name: cookie.key,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || '/',
          expires: cookie.expires ? Math.floor(cookie.expires.getTime() / 1000) : null,
          secure: cookie.secure || false,
          httpOnly: cookie.httpOnly || false
        }));
      }
    } catch (jarError) {
      console.warn('[CookieExtractor] Cookie jar extraction failed:', jarError.message);
    }

    // Return empty array if no cookies found
    console.warn('[CookieExtractor] Could not extract cookies from session - may need manual cookie export');
    return [];
  }

  /**
   * Convert cookies to Netscape format (yt-dlp compatible)
   * @param {Array} cookies - Array of cookie objects
   * @returns {string} - Netscape format cookie string
   */
  convertToNetscapeFormat(cookies) {
    if (!cookies || cookies.length === 0) {
      return '# Netscape HTTP Cookie File\n';
    }

    let netscape = '# Netscape HTTP Cookie File\n';
    netscape += '# This file was generated by Video Grabber OAuth cookie extraction\n';
    netscape += '# Format: domain\tflag\tpath\tsecure\texpiration\tname\tvalue\n\n';

    for (const cookie of cookies) {
      const domain = cookie.domain || '.youtube.com';
      const flag = 'TRUE'; // Domain cookie flag
      const cookiePath = cookie.path || '/';
      const secure = cookie.secure ? 'TRUE' : 'FALSE';
      const expiration = cookie.expires 
        ? Math.floor(cookie.expires / 1000) // Convert to Unix timestamp
        : (cookie.expiresAt ? Math.floor(cookie.expiresAt / 1000) : 0);
      const name = cookie.name || cookie.key;
      const value = cookie.value || '';

      // Skip invalid cookies
      if (!name || value === undefined) {
        continue;
      }

      // Format: domain\tflag\tpath\tsecure\texpiration\tname\tvalue
      netscape += `${domain}\t${flag}\t${cookiePath}\t${secure}\t${expiration}\t${name}\t${value}\n`;
    }

    return netscape;
  }

  /**
   * Save cookies to file in Netscape format (encrypted at rest)
   * @param {string} userId - User ID
   * @param {Array} cookies - Array of cookie objects
   * @returns {string} - Path to saved cookie file
   */
  saveCookiesToFile(userId, cookies) {
    const cookieFilePath = path.join(this.cookiesDir, `user-${userId}.txt`);
    const netscapeFormat = this.convertToNetscapeFormat(cookies);
    
    // Encrypt cookie content before writing
    const encryptedContent = this.encryptCookieContent(netscapeFormat);
    fs.writeFileSync(cookieFilePath, encryptedContent, 'utf-8');
    
    // Set restrictive file permissions (owner read/write only)
    fs.chmodSync(cookieFilePath, 0o600);
    
    console.log(`[CookieExtractor] Saved ${cookies.length} encrypted cookies to: ${cookieFilePath}`);
    
    return cookieFilePath;
  }

  /**
   * Read and decrypt cookie file
   * @param {string} userId - User ID
   * @returns {string|null} - Decrypted cookie content or null if not found/invalid
   */
  readCookiesFromFile(userId) {
    const cookieFilePath = this.getCookieFilePath(userId);
    
    if (!fs.existsSync(cookieFilePath)) {
      return null;
    }

    try {
      const encryptedContent = fs.readFileSync(cookieFilePath, 'utf-8');
      const decryptedContent = this.decryptCookieContent(encryptedContent);
      
      if (!decryptedContent) {
        console.error(`[CookieExtractor] Failed to decrypt cookie file for user: ${userId}`);
        return null;
      }
      
      return decryptedContent;
    } catch (error) {
      console.error(`[CookieExtractor] Error reading cookie file for user ${userId}:`, error.message);
      return null;
    }
  }

  /**
   * Get cookie file path for user
   * @param {string} userId - User ID
   * @returns {string} - Path to user's cookie file
   */
  getCookieFilePath(userId) {
    return path.join(this.cookiesDir, `user-${userId}.txt`);
  }

  /**
   * Check if user has valid cookies
   * @param {string} userId - User ID
   * @returns {boolean} - True if cookies exist and are valid
   */
  hasValidCookies(userId) {
    const cookieFilePath = this.getCookieFilePath(userId);
    
    if (!fs.existsSync(cookieFilePath)) {
      return false;
    }

    try {
      // Read and decrypt cookie file
      const content = this.readCookiesFromFile(userId);
      if (!content) {
        return false;
      }

      const lines = content.split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#');
      });

      // Check if we have at least some valid cookies
      if (lines.length === 0) {
        return false;
      }

      // Check if cookies are expired
      const now = Math.floor(Date.now() / 1000);
      let hasValidCookie = false;
      
      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 5) {
          const expiration = parseInt(parts[4], 10);
          // If expiration is 0, it's a session cookie (valid)
          // Otherwise check if it's expired
          if (expiration === 0 || expiration > now) {
            hasValidCookie = true;
            break;
          }
        }
      }

      return hasValidCookie;
    } catch (error) {
      console.error('[CookieExtractor] Error checking cookie validity:', error.message);
      return false;
    }
  }

  /**
   * Check cookie expiration explicitly
   * @param {string} userId - User ID
   * @returns {Object} - { valid: boolean, expired: boolean, expiresAt: number|null, message: string }
   */
  checkCookieExpiration(userId) {
    const cookieFilePath = this.getCookieFilePath(userId);
    
    if (!fs.existsSync(cookieFilePath)) {
      return {
        valid: false,
        expired: false,
        expiresAt: null,
        message: 'Cookie file not found'
      };
    }

    try {
      const content = this.readCookiesFromFile(userId);
      if (!content) {
        return {
          valid: false,
          expired: false,
          expiresAt: null,
          message: 'Failed to decrypt cookie file'
        };
      }

      const lines = content.split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#');
      });

      if (lines.length === 0) {
        return {
          valid: false,
          expired: false,
          expiresAt: null,
          message: 'No cookies found in file'
        };
      }

      const now = Math.floor(Date.now() / 1000);
      let latestExpiration = 0;
      let hasSessionCookie = false;

      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 5) {
          const expiration = parseInt(parts[4], 10);
          if (expiration === 0) {
            hasSessionCookie = true;
          } else if (expiration > latestExpiration) {
            latestExpiration = expiration;
          }
        }
      }

      if (hasSessionCookie) {
        return {
          valid: true,
          expired: false,
          expiresAt: null,
          message: 'Session cookies (no expiration)'
        };
      }

      if (latestExpiration === 0) {
        return {
          valid: false,
          expired: false,
          expiresAt: null,
          message: 'Invalid cookie expiration data'
        };
      }

      const expired = latestExpiration < now;
      
      return {
        valid: !expired,
        expired: expired,
        expiresAt: latestExpiration * 1000, // Convert to milliseconds
        message: expired 
          ? `Cookies expired on ${new Date(latestExpiration * 1000).toISOString()}`
          : `Cookies valid until ${new Date(latestExpiration * 1000).toISOString()}`
      };
    } catch (error) {
      console.error('[CookieExtractor] Error checking cookie expiration:', error.message);
      return {
        valid: false,
        expired: false,
        expiresAt: null,
        message: `Error: ${error.message}`
      };
    }
  }

  /**
   * Get temporary decrypted cookie file for yt-dlp to use
   * Creates a temporary file with decrypted content that yt-dlp can read
   * @param {string} userId - User ID
   * @returns {string|null} - Path to temporary decrypted cookie file, or null if error
   */
  getTemporaryDecryptedCookieFile(userId) {
    try {
      const decryptedContent = this.readCookiesFromFile(userId);
      if (!decryptedContent) {
        return null;
      }

      // Create temporary file in same directory
      const tempFilePath = path.join(this.cookiesDir, `temp-user-${userId}-${Date.now()}.txt`);
      fs.writeFileSync(tempFilePath, decryptedContent, 'utf-8');
      
      // Set restrictive permissions
      fs.chmodSync(tempFilePath, 0o600);
      
      return tempFilePath;
    } catch (error) {
      console.error(`[CookieExtractor] Error creating temporary cookie file for user ${userId}:`, error.message);
      return null;
    }
  }

  /**
   * Clean up temporary cookie file
   * @param {string} tempFilePath - Path to temporary file
   */
  cleanupTemporaryCookieFile(tempFilePath) {
    try {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch (error) {
      console.warn(`[CookieExtractor] Failed to cleanup temporary file ${tempFilePath}:`, error.message);
    }
  }

  /**
   * Delete user's cookie file
   * @param {string} userId - User ID
   */
  deleteCookies(userId) {
    const cookieFilePath = this.getCookieFilePath(userId);
    
    if (fs.existsSync(cookieFilePath)) {
      fs.unlinkSync(cookieFilePath);
      console.log(`[CookieExtractor] Deleted cookie file: ${cookieFilePath}`);
    }
  }
}

export default CookieExtractor;

