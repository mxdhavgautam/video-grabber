/**
 * Cookie Extractor Service
 * 
 * Extracts YouTube session cookies from OAuth tokens using youtubei.js (Innertube).
 * Converts cookies to Netscape format for yt-dlp compatibility.
 * Encrypts cookie files at rest for security.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Innertube } from 'youtubei.js';

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
   * Handles both new format (IV:encrypted) and old format (plain text or different encryption)
   */
  decryptCookieContent(encryptedText) {
    if (!encryptedText) return null;
    
    try {
      // Check if it's in the new format (IV:encrypted)
      const parts = encryptedText.split(':');
      if (parts.length === 2) {
        try {
          const iv = Buffer.from(parts[0], 'hex');
          const encrypted = parts[1];
          
          // Validate IV is 16 bytes (128 bits)
          if (iv.length !== 16) {
            throw new Error('Invalid IV length');
          }
          
          const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
          
          let decrypted = decipher.update(encrypted, 'hex', 'utf8');
          decrypted += decipher.final('utf8');
          
          return decrypted;
        } catch (decryptError) {
          console.warn('[CookieExtractor] Decryption failed, trying as plain text...');
          // Fall through to try as plain text
        }
      }
      
      // Try as plain text (for old cookie files or unencrypted files)
      // Check if it looks like Netscape cookie format
      if (encryptedText.includes('# Netscape HTTP Cookie File') || 
          encryptedText.includes('\t') || 
          encryptedText.split('\n').length > 2) {
        console.log('[CookieExtractor] Treating as plain text cookie file');
        return encryptedText;
      }
      
      // If it doesn't look like a cookie file, it might be corrupted
      console.error('[CookieExtractor] File does not appear to be encrypted or plain text cookie format');
      return null;
    } catch (error) {
      console.error('[CookieExtractor] Decryption error:', error.message);
      return null;
    }
  }

  /**
   * Extract cookies from OAuth tokens using improved HTTP method
   * Tries youtubei.js first, then falls back to direct HTTP with OAuth token
   * @param {string} accessToken - OAuth access token
   * @param {string} refreshToken - OAuth refresh token (optional)
   * @param {string} userId - User ID (optional, for using saved cookies with youtubei.js)
   * @returns {Promise<Object>} - YouTube session with cookies
   */
  async extractCookiesFromOAuth(accessToken, refreshToken = null, userId = null) {
    try {
      console.log('[CookieExtractor] Extracting cookies using OAuth tokens...');
      
      // WORKAROUND: First check if user has saved cookies from browser
      // If they do, use those with youtubei.js (workaround from GitHub issue #1043)
      if (userId) {
        const savedCookies = this.readCookiesFromFile(userId);
        if (savedCookies) {
          console.log('[CookieExtractor] Found saved cookies, using them with youtubei.js...');
          try {
            // Convert Netscape format to cookie string for youtubei.js
            const cookieString = this.convertNetscapeToCookieString(savedCookies);
            if (cookieString) {
              // Use saved cookies with youtubei.js
              // WORKAROUND from GitHub issue #1043: Use specific player_id to avoid signature decipher errors
              const yt = await Innertube.create({
                client: 'WEB',
                cache: false,
                cookie: cookieString, // WORKAROUND: Pass cookies directly
                player_id: '0004de42' // WORKAROUND: Force known working player ID to fix signature decipher algorithm errors
              });
              
              // Extract cookies from the session
              const youtubeiCookies = await this.extractCookiesFromInnertubeSession(yt);
              if (youtubeiCookies.length > 0) {
                console.log(`[CookieExtractor] ✓ Extracted ${youtubeiCookies.length} cookies using saved cookies with youtubei.js`);
                return {
                  session: null,
                  cookies: youtubeiCookies
                };
              }
            }
          } catch (youtubeiError) {
            console.warn('[CookieExtractor] Failed to use saved cookies with youtubei.js:', youtubeiError.message);
            // Fall through to OAuth method
          }
        }
      }
      
      // Primary method: Use improved direct HTTP method with OAuth token
      // This method makes authenticated requests to YouTube which should set session cookies
      const cookies = await this.getCookiesFromOAuthToken(accessToken);
      
      // Check if we got critical cookies
      const criticalCookies = ['__Secure-3PSID', '__Secure-3PAPISID', 'LOGIN_INFO', 'VISITOR_INFO1_LIVE'];
      const hasCriticalCookies = criticalCookies.some(name => cookies.find(c => c.name === name));
      
      if (!hasCriticalCookies && cookies.length > 0) {
        console.log('[CookieExtractor] Missing critical cookies, trying youtubei.js as supplement...');
        try {
          // Try to get additional cookies from youtubei.js
          const youtubeiCookies = await this.getCookiesFromOAuthWithYoutubei(accessToken, refreshToken);
          // Merge cookies (avoid duplicates)
          for (const cookie of youtubeiCookies) {
            if (!cookies.find(c => c.name === cookie.name)) {
              cookies.push(cookie);
            }
          }
        } catch (youtubeiError) {
          console.warn('[CookieExtractor] youtubei.js supplement failed:', youtubeiError.message);
        }
      }
      
      console.log(`[CookieExtractor] Extracted ${cookies.length} cookies from OAuth session`);
      
      return {
        session: null, // We don't need the session object anymore
        cookies
      };
    } catch (error) {
      console.error('[CookieExtractor] Failed to extract cookies from OAuth:', error.message);
      throw new Error(`Cookie extraction failed: ${error.message}`);
    }
  }

  /**
   * Convert Netscape format cookie file to cookie string for youtubei.js
   * @param {string} netscapeContent - Netscape format cookie content
   * @returns {string|null} - Cookie string or null
   */
  convertNetscapeToCookieString(netscapeContent) {
    try {
      const lines = netscapeContent.split('\n').filter(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#');
      });

      const cookiePairs = [];
      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 7) {
          const name = parts[5]?.trim();
          const value = parts[6]?.trim();
          if (name && value) {
            cookiePairs.push(`${name}=${value}`);
          }
        }
      }

      return cookiePairs.length > 0 ? cookiePairs.join('; ') : null;
    } catch (error) {
      console.warn('[CookieExtractor] Failed to convert Netscape to cookie string:', error.message);
      return null;
    }
  }

  /**
   * Get cookies using youtubei.js (Innertube) with OAuth tokens
   * This method creates an authenticated YouTube session and extracts cookies from it
   * Note: This is experimental - OAuth tokens don't directly work with youtubei.js
   * @param {string} accessToken - OAuth access token
   * @param {string} refreshToken - OAuth refresh token (optional)
   * @returns {Promise<Array>} - Array of cookie objects
   */
  async getCookiesFromOAuthWithYoutubei(accessToken, refreshToken = null) {
    try {
      console.log('[CookieExtractor] Creating Innertube session...');
      
      // WORKAROUND from GitHub issue #1043: Pass cookies directly to youtubei.js
      // Instead of trying to generate session data, use existing cookies if available
      // First, try to get cookies from saved file if user has them
      let cookieString = null;
      
      // Try to read existing cookies from file (if user has imported them)
      // This is the workaround - use actual browser cookies instead of generating
      try {
        // We can't access userId here, so we'll skip this for now
        // The cookies should be passed in or we'll create without them
      } catch (e) {
        // Ignore - no cookies file available
      }
      
      // Create Innertube instance with explicit client configuration
      // Use WEB client to avoid signature decipher issues and ensure proper API version
      // WORKAROUND from GitHub issue #1043: Use specific player_id to avoid signature decipher errors
      // WORKAROUND: Don't use generate_session_data - it causes signature decipher errors
      // Instead, pass cookies directly if available, or let the library handle it
      const yt = await Innertube.create({
        client: 'WEB', // Explicitly set client to avoid vnull API version
        cache: false,
        // WORKAROUND: Don't use generate_session_data - causes PlayerError
        // Pass cookies directly if available (cookie: cookieString)
        ...(cookieString ? { cookie: cookieString } : {}),
        player_id: '0004de42' // WORKAROUND: Force known working player ID to fix signature decipher algorithm errors
      });

      // Make requests to YouTube to trigger cookie generation
      // Even without OAuth, browsing YouTube will set some cookies
      console.log('[CookieExtractor] Making requests to YouTube to generate cookies...');
      
      // Request home feed to trigger cookie generation
      try {
        await yt.getHomeFeed();
        console.log('[CookieExtractor] ✓ Home feed request successful');
      } catch (feedError) {
        console.warn('[CookieExtractor] Home feed request failed:', feedError.message);
      }

      // Try to get a video to trigger more cookies
      try {
        const video = await yt.getInfo('dQw4w9WgXcQ'); // Test video
        console.log('[CookieExtractor] ✓ Video info request successful');
      } catch (videoError) {
        console.warn('[CookieExtractor] Video info request failed:', videoError.message);
      }

      // Extract cookies from Innertube session
      const cookies = await this.extractCookiesFromInnertubeSession(yt);
      
      // Note: These cookies won't have OAuth authentication, so they may not include
      // the critical session cookies. We'll need to combine with OAuth-based cookies.
      return cookies;
    } catch (error) {
      console.error('[CookieExtractor] Error with youtubei.js method:', error.message);
      // Don't throw - return empty array so OAuth method can still work
      return [];
    }
  }

  /**
   * Extract cookies from Innertube session
   * @param {Object} yt - Innertube instance
   * @returns {Promise<Array>} - Array of cookie objects
   */
  async extractCookiesFromInnertubeSession(yt) {
    try {
      const cookies = [];
      
      // Innertube stores cookies in session.context.client.cookie_jar or similar
      // We need to access the cookie jar from the session
      const session = yt.session;
      
      if (!session) {
        console.warn('[CookieExtractor] No session found in Innertube instance');
        return cookies;
      }
      
      // Try to get cookies from different locations in the session
      // youtubei.js v7 stores cookies in session.context.client.cookie_jar
      if (session.context && session.context.client) {
        const client = session.context.client;
        
        // Check for cookie jar in client
        if (client.cookie_jar) {
          try {
            const cookieJar = client.cookie_jar;
            // Extract cookies from jar - use async method if available
            let jarCookies = [];
            if (typeof cookieJar.getCookiesSync === 'function') {
              jarCookies = cookieJar.getCookiesSync('https://www.youtube.com');
            } else if (typeof cookieJar.getCookies === 'function') {
              jarCookies = await cookieJar.getCookies('https://www.youtube.com');
            } else if (cookieJar.toJSON && typeof cookieJar.toJSON === 'function') {
              // Some versions store cookies as an object
              const jarData = cookieJar.toJSON();
              if (Array.isArray(jarData)) {
                jarCookies = jarData;
              }
            }
            
            for (const cookie of jarCookies) {
              cookies.push({
                name: cookie.key || cookie.name,
                value: cookie.value,
                domain: cookie.domain || '.youtube.com',
                path: cookie.path || '/',
                secure: cookie.secure || false,
                httpOnly: cookie.httpOnly || false,
                expires: cookie.expires ? (cookie.expires instanceof Date ? Math.floor(cookie.expires.getTime() / 1000) : cookie.expires) : null
              });
            }
          } catch (jarError) {
            console.warn('[CookieExtractor] Error accessing cookie jar:', jarError.message);
          }
        }
        
        // Also check HTTP client for cookies (different location in some versions)
        if (client.http) {
          try {
            // Check if http has a cookie jar
            if (client.http.cookie_jar) {
              const httpCookieJar = client.http.cookie_jar;
              let httpCookies = [];
              if (typeof httpCookieJar.getCookiesSync === 'function') {
                httpCookies = httpCookieJar.getCookiesSync('https://www.youtube.com');
              } else if (typeof httpCookieJar.getCookies === 'function') {
                httpCookies = await httpCookieJar.getCookies('https://www.youtube.com');
              }
              
              for (const cookie of httpCookies) {
                // Avoid duplicates
                if (!cookies.find(c => c.name === (cookie.key || cookie.name))) {
                  cookies.push({
                    name: cookie.key || cookie.name,
                    value: cookie.value,
                    domain: cookie.domain || '.youtube.com',
                    path: cookie.path || '/',
                    secure: cookie.secure || false,
                    httpOnly: cookie.httpOnly || false,
                    expires: cookie.expires ? (cookie.expires instanceof Date ? Math.floor(cookie.expires.getTime() / 1000) : cookie.expires) : null
                  });
                }
              }
            }
            
            // Try to access cookies directly from http client if available
            if (client.http.cookies && Array.isArray(client.http.cookies)) {
              for (const cookie of client.http.cookies) {
                if (!cookies.find(c => c.name === (cookie.key || cookie.name))) {
                  cookies.push({
                    name: cookie.key || cookie.name,
                    value: cookie.value,
                    domain: cookie.domain || '.youtube.com',
                    path: cookie.path || '/',
                    secure: cookie.secure || false,
                    httpOnly: cookie.httpOnly || false,
                    expires: cookie.expires ? (cookie.expires instanceof Date ? Math.floor(cookie.expires.getTime() / 1000) : cookie.expires) : null
                  });
                }
              }
            }
          } catch (httpError) {
            console.warn('[CookieExtractor] Error accessing HTTP client cookies:', httpError.message);
          }
        }
      }

      // Alternative: Try to access cookies from session directly
      if (cookies.length === 0 && session.cookie_jar) {
        try {
          let jarCookies = [];
          if (typeof session.cookie_jar.getCookiesSync === 'function') {
            jarCookies = session.cookie_jar.getCookiesSync('https://www.youtube.com');
          } else if (typeof session.cookie_jar.getCookies === 'function') {
            jarCookies = await session.cookie_jar.getCookies('https://www.youtube.com');
          }
          
          for (const cookie of jarCookies) {
            cookies.push({
              name: cookie.key || cookie.name,
              value: cookie.value,
              domain: cookie.domain || '.youtube.com',
              path: cookie.path || '/',
              secure: cookie.secure || false,
              httpOnly: cookie.httpOnly || false,
              expires: cookie.expires ? (cookie.expires instanceof Date ? Math.floor(cookie.expires.getTime() / 1000) : cookie.expires) : null
            });
          }
        } catch (sessionJarError) {
          console.warn('[CookieExtractor] Error accessing session cookie jar:', sessionJarError.message);
        }
      }

      console.log(`[CookieExtractor] Extracted ${cookies.length} cookies from Innertube session`);
      
      // Check for critical cookies
      const criticalCookies = ['__Secure-3PSID', '__Secure-3PAPISID', 'LOGIN_INFO', 'VISITOR_INFO1_LIVE'];
      const foundCriticalCookies = criticalCookies.filter(name => cookies.find(c => c.name === name));
      const missingCriticalCookies = criticalCookies.filter(name => !cookies.find(c => c.name === name));
      
      if (foundCriticalCookies.length > 0) {
        console.log(`[CookieExtractor] ✓ Found critical cookies: ${foundCriticalCookies.join(', ')}`);
      }
      
      if (missingCriticalCookies.length > 0) {
        console.warn(`[CookieExtractor] ⚠️ Missing critical cookies: ${missingCriticalCookies.join(', ')}`);
        console.warn('[CookieExtractor] These cookies may be required for bypassing bot detection');
      }

      return cookies;
    } catch (error) {
      console.error('[CookieExtractor] Error extracting cookies from Innertube session:', error.message);
      return [];
    }
  }

  /**
   * Get cookies by making authenticated requests to YouTube with OAuth token
   * Uses a cookie jar to maintain cookies across requests
   * @param {string} accessToken - OAuth access token
   * @returns {Promise<Array>} - Array of cookie objects
   */
  async getCookiesFromOAuthToken(accessToken) {
    try {
      const cookieMap = new Map(); // Use Map to avoid duplicates
      const cookieJar = new Map(); // Simple cookie jar to maintain cookies across requests
      
      // Helper to add cookies from response to jar
      const addCookiesToJar = (response, url) => {
        // Try multiple ways to get Set-Cookie headers
        let setCookies = [];
        
        // Method 1: getSetCookie() method (Node.js 18+)
        if (response.headers.getSetCookie) {
          setCookies = response.headers.getSetCookie();
        }
        // Method 2: Direct header access
        else if (response.headers['set-cookie']) {
          setCookies = Array.isArray(response.headers['set-cookie']) 
            ? response.headers['set-cookie'] 
            : [response.headers['set-cookie']];
        }
        // Method 3: Case-insensitive header access
        else {
          const headerKeys = Object.keys(response.headers);
          const setCookieKey = headerKeys.find(k => k.toLowerCase() === 'set-cookie');
          if (setCookieKey) {
            setCookies = Array.isArray(response.headers[setCookieKey])
              ? response.headers[setCookieKey]
              : [response.headers[setCookieKey]];
          }
        }
        
        for (const cookieHeader of setCookies) {
          const cookie = this.parseSetCookieHeader(cookieHeader);
          if (cookie) {
            cookieJar.set(cookie.name, cookie);
            cookieMap.set(cookie.name, cookie);
            console.log(`[CookieExtractor] Extracted cookie: ${cookie.name}`);
          }
        }
      };
      
      // Helper to build cookie header from jar
      const buildCookieHeader = () => {
        return Array.from(cookieJar.values())
          .map(c => `${c.name}=${c.value}`)
          .join('; ');
      };
      
      // Step 1: Visit YouTube homepage to get initial cookies
      console.log('[CookieExtractor] Step 1: Visiting YouTube homepage...');
      const homeResponse = await fetch('https://www.youtube.com/', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Cache-Control': 'max-age=0'
        },
        redirect: 'follow'
      });
      addCookiesToJar(homeResponse, 'https://www.youtube.com/');
      
      // Also try visiting with account context
      try {
        console.log('[CookieExtractor] Step 1b: Visiting YouTube with account context...');
        const accountHomeResponse = await fetch('https://www.youtube.com/?authuser=0', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Cookie': buildCookieHeader(),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.youtube.com/',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin'
          },
          redirect: 'follow'
        });
        addCookiesToJar(accountHomeResponse, 'https://www.youtube.com/?authuser=0');
      } catch (accountHomeError) {
        console.warn('[CookieExtractor] Account home request failed:', accountHomeError.message);
      }
      
      // Step 2: Visit YouTube watch page (triggers more cookies)
      console.log('[CookieExtractor] Step 2: Visiting YouTube watch page...');
      try {
        const watchResponse = await fetch('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Cookie': buildCookieHeader(),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.youtube.com/',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin'
          },
          redirect: 'follow'
        });
        addCookiesToJar(watchResponse, 'https://www.youtube.com/watch');
      } catch (watchError) {
        console.warn('[CookieExtractor] Watch page request failed:', watchError.message);
      }
      
      // Step 3: Visit YouTube account page (triggers account-specific cookies)
      console.log('[CookieExtractor] Step 3: Visiting YouTube account page...');
      try {
        const accountResponse = await fetch('https://www.youtube.com/account', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Cookie': buildCookieHeader(),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.youtube.com/',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin'
          },
          redirect: 'follow'
        });
        addCookiesToJar(accountResponse, 'https://www.youtube.com/account');
      } catch (accountError) {
        console.warn('[CookieExtractor] Account page request failed:', accountError.message);
      }
      
      // Step 4: Make authenticated InnerTube API request (may trigger additional cookies)
      console.log('[CookieExtractor] Step 4: Making InnerTube API request...');
      try {
        const apiResponse = await fetch('https://www.youtube.com/youtubei/v1/browse', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Cookie': buildCookieHeader(),
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'X-YouTube-Client-Name': '1',
            'X-YouTube-Client-Version': '2.20250106.00.00',
            'Origin': 'https://www.youtube.com',
            'Referer': 'https://www.youtube.com/',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9'
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: 'WEB',
                clientVersion: '2.20250106.00.00',
                hl: 'en',
                gl: 'US',
                utcOffsetMinutes: 0
              }
            },
            browseId: 'FEwhat_to_watch'
          })
        });
        addCookiesToJar(apiResponse, 'https://www.youtube.com/youtubei/v1/browse');
      } catch (apiError) {
        console.warn('[CookieExtractor] InnerTube API request failed:', apiError.message);
      }
      
      // Step 5: Try visiting YouTube with OAuth token in a way that might set session cookies
      // This attempts to use the OAuth token to authenticate with YouTube's web interface
      console.log('[CookieExtractor] Step 5: Attempting YouTube web authentication...');
      try {
        // Try visiting YouTube's authenticated endpoint
        const authResponse = await fetch('https://www.youtube.com/?authuser=0&feature=youtu.be', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Cookie': buildCookieHeader(),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.youtube.com/',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1'
          },
          redirect: 'follow'
        });
        addCookiesToJar(authResponse, 'https://www.youtube.com/?authuser=0');
      } catch (authError) {
        console.warn('[CookieExtractor] YouTube web authentication request failed:', authError.message);
      }
      
      // Step 6: Try making a request to YouTube's account page which might trigger session cookies
      console.log('[CookieExtractor] Step 6: Visiting YouTube account settings...');
      try {
        const settingsResponse = await fetch('https://www.youtube.com/account_advanced', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Cookie': buildCookieHeader(),
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.youtube.com/account',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin'
          },
          redirect: 'follow'
        });
        addCookiesToJar(settingsResponse, 'https://www.youtube.com/account_advanced');
      } catch (settingsError) {
        console.warn('[CookieExtractor] Account settings request failed:', settingsError.message);
      }

      // Convert Map to Array
      const finalCookies = Array.from(cookieMap.values());
      
      // Log cookie names for debugging
      const cookieNames = finalCookies.map(c => c.name).join(', ');
      console.log(`[CookieExtractor] Extracted ${finalCookies.length} unique cookies: ${cookieNames}`);
      
      // Check for critical cookies
      const criticalCookies = ['__Secure-3PSID', '__Secure-3PAPISID', 'LOGIN_INFO', 'VISITOR_INFO1_LIVE'];
      const foundCriticalCookies = criticalCookies.filter(name => cookieMap.has(name));
      const missingCriticalCookies = criticalCookies.filter(name => !cookieMap.has(name));
      
      if (foundCriticalCookies.length > 0) {
        console.log(`[CookieExtractor] ✓ Found critical cookies: ${foundCriticalCookies.join(', ')}`);
      }
      
      if (missingCriticalCookies.length > 0) {
        console.warn(`[CookieExtractor] ⚠️ Missing critical cookies: ${missingCriticalCookies.join(', ')}`);
        console.warn('[CookieExtractor] NOTE: OAuth tokens do not provide YouTube session cookies.');
        console.warn('[CookieExtractor] These cookies (__Secure-3PSID, __Secure-3PAPISID, LOGIN_INFO, VISITOR_INFO1_LIVE)');
        console.warn('[CookieExtractor] are only set when browsing YouTube in a browser.');
        console.warn('[CookieExtractor] The extracted cookies may not be sufficient for bypassing bot detection.');
        console.warn('[CookieExtractor] Users may need to export cookies from their browser manually.');
      }

      return finalCookies;
    } catch (error) {
      console.error('[CookieExtractor] Error getting cookies from OAuth token:', error.message);
      return [];
    }
  }

  /**
   * Parse Set-Cookie header into cookie object
   * @param {string} cookieHeader - Set-Cookie header value
   * @returns {Object|null} - Cookie object or null
   */
  parseSetCookieHeader(cookieHeader) {
    try {
      const parts = cookieHeader.split(';').map(p => p.trim());
      const [nameValue] = parts;
      const [name, value] = nameValue.split('=');
      
      if (!name || !value) {
        return null;
      }

      const cookie = {
        name: name.trim(),
        value: value.trim(),
        domain: '.youtube.com',
        path: '/',
        secure: false,
        httpOnly: false,
        expires: null
      };

      // Parse attributes
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i].toLowerCase();
        if (part === 'secure') {
          cookie.secure = true;
        } else if (part === 'httponly') {
          cookie.httpOnly = true;
        } else if (part.startsWith('domain=')) {
          cookie.domain = part.substring(7);
        } else if (part.startsWith('path=')) {
          cookie.path = part.substring(5);
        } else if (part.startsWith('expires=')) {
          const expiresStr = part.substring(8);
          const expiresDate = new Date(expiresStr);
          if (!isNaN(expiresDate.getTime())) {
            cookie.expires = Math.floor(expiresDate.getTime() / 1000);
          }
        } else if (part.startsWith('max-age=')) {
          const maxAge = parseInt(part.substring(8), 10);
          if (!isNaN(maxAge)) {
            cookie.expires = Math.floor(Date.now() / 1000) + maxAge;
          }
        }
      }

      return cookie;
    } catch (error) {
      console.warn('[CookieExtractor] Failed to parse Set-Cookie header:', error.message);
      return null;
    }
  }

  /**
   * Parse cookie string (alternative format)
   * @param {string} cookieString - Cookie string
   * @returns {Array} - Array of cookie objects
   */
  parseCookieString(cookieString) {
    const cookies = [];
    if (!cookieString) return cookies;

    const pairs = cookieString.split(';');
    for (const pair of pairs) {
      const [name, value] = pair.split('=').map(s => s.trim());
      if (name && value) {
        cookies.push({
          name,
          value,
          domain: '.youtube.com',
          path: '/',
          secure: false,
          httpOnly: false,
          expires: null
        });
      }
    }

    return cookies;
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
      
      // Handle expiration: yt-dlp requires 0 for session cookies, not -1
      // Netscape format: 0 = session cookie, > 0 = expiration timestamp (Unix seconds)
      let expiration = 0; // Default to session cookie
      
      if (cookie.expires !== undefined && cookie.expires !== null) {
        if (cookie.expires > 0) {
          // Cookie has expiration
          if (cookie.expires > 1000000000000) {
            // Already in milliseconds, convert to seconds
            expiration = Math.floor(cookie.expires / 1000);
          } else if (cookie.expires > 1000000000) {
            // Already in seconds
            expiration = Math.floor(cookie.expires);
          } else {
            // Very small number, treat as session cookie
            expiration = 0;
          }
        } else {
          // expires is 0, -1, or negative - treat as session cookie
          expiration = 0;
        }
      } else if (cookie.expiresAt !== undefined && cookie.expiresAt !== null && cookie.expiresAt > 0) {
        // Use expiresAt if available
        if (cookie.expiresAt > 1000000000000) {
          expiration = Math.floor(cookie.expiresAt / 1000);
        } else {
          expiration = Math.floor(cookie.expiresAt);
        }
      }
      
      // Ensure expiration is never negative
      if (expiration < 0) {
        expiration = 0;
      }
      
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
   * Also normalizes cookie expiration values (-1 -> 0 for session cookies)
   * @param {string} userId - User ID
   * @returns {string|null} - Path to temporary decrypted cookie file, or null if error
   */
  getTemporaryDecryptedCookieFile(userId) {
    try {
      const decryptedContent = this.readCookiesFromFile(userId);
      if (!decryptedContent) {
        return null;
      }

      // Normalize cookie file: convert -1 expiration to 0 (session cookies)
      // yt-dlp requires 0 for session cookies, not -1
      const normalizedContent = this.normalizeCookieFile(decryptedContent);

      // Create temporary file in same directory
      const tempFilePath = path.join(this.cookiesDir, `temp-user-${userId}-${Date.now()}.txt`);
      fs.writeFileSync(tempFilePath, normalizedContent, 'utf-8');
      
      // Set restrictive permissions
      fs.chmodSync(tempFilePath, 0o600);
      
      return tempFilePath;
    } catch (error) {
      console.error(`[CookieExtractor] Error creating temporary cookie file for user ${userId}:`, error.message);
      return null;
    }
  }

  /**
   * Normalize cookie file content
   * Converts -1 expiration values to 0 (session cookies) for yt-dlp compatibility
   * @param {string} content - Cookie file content
   * @returns {string} - Normalized content
   */
  normalizeCookieFile(content) {
    if (!content) {
      return content;
    }

    const lines = content.split('\n');
    const normalizedLines = lines.map(line => {
      // Skip comment lines and empty lines
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return line;
      }

      // Parse Netscape format: domain\tflag\tpath\tsecure\texpiration\tname\tvalue
      const parts = line.split('\t');
      if (parts.length >= 6) {
        const expiration = parts[4];
        
        // Convert -1 to 0 for session cookies
        if (expiration === '-1') {
          parts[4] = '0';
          return parts.join('\t');
        }
        
        // Also handle negative numbers
        const expirationNum = parseInt(expiration, 10);
        if (expirationNum < 0) {
          parts[4] = '0';
          return parts.join('\t');
        }
      }
      
      return line;
    });

    return normalizedLines.join('\n');
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


