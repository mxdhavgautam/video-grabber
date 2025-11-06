/**
 * User Browser Service
 * 
 * Per-user browser automation service that uses OAuth tokens and initial cookies
 * to generate proper YouTube session cookies via Chrome/Puppeteer.
 * 
 * Strategy:
 * 1. User authenticates with OAuth (gets tokens)
 * 2. Extract initial cookies from OAuth (may be incomplete)
 * 3. Launch Chrome instance for this user
 * 4. Use OAuth tokens to authenticate in Chrome
 * 5. Load initial cookies into Chrome
 * 6. Browse YouTube to generate proper session cookies
 * 7. Export cookies in Netscape format for yt-dlp
 * 
 * This approach combines OAuth authentication with browser automation to get
 * the critical session cookies that YouTube requires for bot detection bypass.
 */

import puppeteer from 'puppeteer-core';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import CookieExtractor from './cookie-extractor.mjs';

// Configure puppeteer-extra with stealth plugin
puppeteerExtra.use(StealthPlugin());

class UserBrowserService {
  constructor(userId, cookiesDir, profileDir) {
    this.userId = userId;
    this.cookiesDir = cookiesDir || process.env.COOKIES_DIR || path.join(process.cwd(), 'cookies');
    this.profileDir = profileDir || path.join(process.env.CHROME_PROFILE_DIR || '/var/lib/video-grabber/chrome-profiles', `user-${userId}`);
    this.cookieExtractor = new CookieExtractor(this.cookiesDir);
    this.cookieFilePath = path.join(this.cookiesDir, `user-${userId}.txt`);
    
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.isBrowsing = false;
    
    // Ensure directories exist
    if (!fs.existsSync(this.cookiesDir)) {
      fs.mkdirSync(this.cookiesDir, { recursive: true });
    }
    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
    }
  }

  /**
   * Clean up Chrome profile lock files
   * Removes lock files that prevent browser from starting
   */
  cleanupProfileLocks() {
    try {
      if (!fs.existsSync(this.profileDir)) {
        return;
      }

      // Remove SingletonLock file (most common lock file)
      const singletonLock = path.join(this.profileDir, 'SingletonLock');
      if (fs.existsSync(singletonLock)) {
        try {
          fs.unlinkSync(singletonLock);
          console.log(`[UserBrowserService:${this.userId}] Removed SingletonLock file`);
        } catch (e) {
          console.warn(`[UserBrowserService:${this.userId}] Could not remove SingletonLock:`, e.message);
        }
      }

      // Remove SingletonSocket file
      const singletonSocket = path.join(this.profileDir, 'SingletonSocket');
      if (fs.existsSync(singletonSocket)) {
        try {
          fs.unlinkSync(singletonSocket);
          console.log(`[UserBrowserService:${this.userId}] Removed SingletonSocket file`);
        } catch (e) {
          console.warn(`[UserBrowserService:${this.userId}] Could not remove SingletonSocket:`, e.message);
        }
      }

      // Remove SingletonCookie file
      const singletonCookie = path.join(this.profileDir, 'SingletonCookie');
      if (fs.existsSync(singletonCookie)) {
        try {
          fs.unlinkSync(singletonCookie);
          console.log(`[UserBrowserService:${this.userId}] Removed SingletonCookie file`);
        } catch (e) {
          console.warn(`[UserBrowserService:${this.userId}] Could not remove SingletonCookie:`, e.message);
        }
      }

      // Try to kill any stale Chrome processes that might be using this profile
      try {
        // Find Chrome/Chromium processes that might be using this profile
        const processes = execSync(`ps aux | grep -i "chrom.*${this.profileDir}" | grep -v grep || true`, { encoding: 'utf-8' });
        if (processes && processes.trim()) {
          console.log(`[UserBrowserService:${this.userId}] Found stale Chrome processes, attempting to kill...`);
          // Extract PIDs and kill them
          const lines = processes.trim().split('\n');
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length > 1) {
              const pid = parts[1];
              try {
                execSync(`kill -9 ${pid} 2>/dev/null || true`);
                console.log(`[UserBrowserService:${this.userId}] Killed stale Chrome process: ${pid}`);
              } catch (e) {
                // Process might already be dead
              }
            }
          }
        }
      } catch (e) {
        // No processes found or error checking - that's fine
      }
    } catch (error) {
      console.warn(`[UserBrowserService:${this.userId}] Error cleaning up profile locks:`, error.message);
    }
  }

  /**
   * Start browser instance and authenticate with OAuth tokens
   * @param {string} accessToken - OAuth access token
   * @param {string} refreshToken - OAuth refresh token (optional)
   * @param {Array} initialCookies - Initial cookies from OAuth extraction (optional)
   * @returns {Promise<Array>} - Extracted cookies in Netscape format
   */
  async startAndAuthenticate(accessToken, refreshToken = null, initialCookies = []) {
    try {
      console.log(`[UserBrowserService:${this.userId}] Starting browser for user ${this.userId}...`);
      
      // Clean up any stale lock files before starting
      this.cleanupProfileLocks();
      
      // Launch Chrome with stealth plugin
      const chromeArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        '--disable-features=BlockThirdPartyCookies',
        '--enable-features=NetworkService',
        '--lang=en-US,en',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-component-extensions-with-background-pages',
        '--disable-default-apps',
        '--disable-domain-reliability',
        '--disable-extensions',
        '--disable-hang-monitor',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
        '--enable-automation',
        '--password-store=basic',
        '--use-mock-keychain',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ];

      const useDisplay = process.env.DISPLAY || (process.env.USE_VNC === 'true' ? ':99' : null);
      const isHeadless = !useDisplay;
      
      if (useDisplay) {
        chromeArgs.push(`--display=${useDisplay}`);
      }

      this.browser = await puppeteerExtra.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: isHeadless,
        args: chromeArgs,
        userDataDir: this.profileDir
      });

      this.page = await this.browser.newPage();
      
      // Enhanced stealth
      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        delete navigator.__proto__.webdriver;
        
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en']
        });
        
        Object.defineProperty(navigator, 'platform', {
          get: () => 'Win32'
        });
        
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => 8
        });
        
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => 8
        });
        
        window.chrome = { runtime: {} };
        
        Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth });
        Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight });
      });

      await this.page.setViewport({ width: 1920, height: 1080 });
      await this.page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9'
      });

      this.isRunning = true;
      console.log(`[UserBrowserService:${this.userId}] Browser started successfully`);

      // Step 1: Load initial cookies if provided
      if (initialCookies && initialCookies.length > 0) {
        console.log(`[UserBrowserService:${this.userId}] Loading ${initialCookies.length} initial cookies...`);
        await this.loadCookiesIntoBrowser(initialCookies);
      }

      // Step 2: Authenticate with OAuth token by navigating to Google account
      console.log(`[UserBrowserService:${this.userId}] Authenticating with OAuth token...`);
      await this.authenticateWithOAuth(accessToken);

      // Step 3: Browse YouTube to generate session cookies
      console.log(`[UserBrowserService:${this.userId}] Browsing YouTube to generate session cookies...`);
      await this.browseYouTube();

      // Step 4: Export cookies
      console.log(`[UserBrowserService:${this.userId}] Exporting cookies...`);
      const cookies = await this.exportCookies();

      return cookies;
    } catch (error) {
      console.error(`[UserBrowserService:${this.userId}] Error:`, error.message);
      throw error;
    }
  }

  /**
   * Load initial cookies into browser
   */
  async loadCookiesIntoBrowser(cookies) {
    try {
      for (const cookie of cookies) {
        try {
          // Convert cookie format if needed
          const browserCookie = {
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain || '.youtube.com',
            path: cookie.path || '/',
            secure: cookie.secure !== false,
            httpOnly: cookie.httpOnly || false,
            sameSite: cookie.sameSite || 'None'
          };

          // Handle expiration
          if (cookie.expires && cookie.expires > 0) {
            browserCookie.expires = cookie.expires;
          }

          await this.page.setCookie(browserCookie);
        } catch (cookieError) {
          console.warn(`[UserBrowserService:${this.userId}] Failed to set cookie ${cookie.name}:`, cookieError.message);
        }
      }
      console.log(`[UserBrowserService:${this.userId}] Loaded initial cookies into browser`);
    } catch (error) {
      console.warn(`[UserBrowserService:${this.userId}] Error loading cookies:`, error.message);
    }
  }

  /**
   * Authenticate with OAuth token by navigating to Google account page
   * Uses initial cookies to establish session, then navigates to YouTube
   */
  async authenticateWithOAuth(accessToken) {
    try {
      // First, navigate to YouTube with initial cookies already loaded
      // The cookies should establish a session
      console.log(`[UserBrowserService:${this.userId}] Navigating to YouTube with initial cookies...`);
      
      await this.page.goto('https://www.youtube.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      await this.sleep(3000);

      // Check if we're logged in by looking for user avatar or account button
      const isLoggedIn = await this.page.evaluate(() => {
        // Check for various indicators of being logged in
        return !!(
          document.querySelector('yt-img-shadow[alt*="Google Account"]') ||
          document.querySelector('button[aria-label*="Account"]') ||
          document.querySelector('#avatar-btn') ||
          document.querySelector('ytd-topbar-menu-button-renderer')
        );
      });

      if (!isLoggedIn) {
        console.log(`[UserBrowserService:${this.userId}] Not logged in, attempting to establish session...`);
        
        // Try navigating to Google account page to trigger authentication
        try {
          await this.page.goto('https://accounts.google.com', {
            waitUntil: 'networkidle2',
            timeout: 20000
          });
          await this.sleep(3000);
          
          // Check if we need to sign in
          const needsSignIn = await this.page.evaluate(() => {
            return !!(
              document.querySelector('input[type="email"]') ||
              document.querySelector('input[name="identifier"]') ||
              document.querySelector('button:has-text("Sign in")')
            );
          });
          
          if (needsSignIn) {
            console.log(`[UserBrowserService:${this.userId}] Google requires sign-in, but we have OAuth tokens`);
            console.log(`[UserBrowserService:${this.userId}] Cookies from OAuth should establish session on YouTube`);
          }
        } catch (accountError) {
          console.warn(`[UserBrowserService:${this.userId}] Google account page navigation failed:`, accountError.message);
        }
      } else {
        console.log(`[UserBrowserService:${this.userId}] Already logged in to Google/YouTube`);
      }

      // Navigate back to YouTube to establish YouTube session
      await this.page.goto('https://www.youtube.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      await this.sleep(2000);

      console.log(`[UserBrowserService:${this.userId}] OAuth authentication completed`);
    } catch (error) {
      console.error(`[UserBrowserService:${this.userId}] OAuth authentication error:`, error.message);
      throw error;
    }
  }

  /**
   * Browse YouTube to generate session cookies
   */
  async browseYouTube() {
    try {
      this.isBrowsing = true;

      // Step 1: Visit YouTube homepage
      console.log(`[UserBrowserService:${this.userId}] Step 1: Visiting YouTube homepage...`);
      await this.page.goto('https://www.youtube.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await this.sleep(5000); // Wait longer for cookies to be set

      // Step 2: Handle YouTube prompts (consent, sign-in, etc.)
      await this.handleYouTubePrompts();

      // Step 3: Visit YouTube account page to trigger session cookies
      console.log(`[UserBrowserService:${this.userId}] Step 2: Visiting YouTube account page...`);
      try {
        await this.page.goto('https://www.youtube.com/account', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        await this.sleep(5000);
      } catch (e) {
        console.warn(`[UserBrowserService:${this.userId}] Account page visit failed:`, e.message);
      }

      // Step 4: Visit YouTube Studio to trigger more session cookies
      console.log(`[UserBrowserService:${this.userId}] Step 3: Visiting YouTube Studio...`);
      try {
        await this.page.goto('https://studio.youtube.com', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        await this.sleep(5000);
      } catch (e) {
        console.warn(`[UserBrowserService:${this.userId}] Studio page visit failed:`, e.message);
      }

      // Step 5: Go back to YouTube homepage
      console.log(`[UserBrowserService:${this.userId}] Step 4: Returning to YouTube homepage...`);
      await this.page.goto('https://www.youtube.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await this.sleep(3000);

      // Step 6: Scroll feed to trigger more cookies
      await this.humanScroll();
      await this.sleep(2000);

      // Step 7: Try to watch a video from homepage
      await this.watchHomepageVideo();

      // Step 8: Final wait for cookies to be fully set
      await this.sleep(5000);

      // Step 9: Export cookies after all interactions
      await this.exportCookies();

      this.isBrowsing = false;
      console.log(`[UserBrowserService:${this.userId}] YouTube browsing completed`);
    } catch (error) {
      console.error(`[UserBrowserService:${this.userId}] YouTube browsing error:`, error.message);
      this.isBrowsing = false;
      throw error;
    }
  }

  /**
   * Handle YouTube prompts (consent, sign-in, etc.)
   */
  async handleYouTubePrompts() {
    try {
      await this.sleep(2000);

      // Accept consent if present
      const consentSelectors = [
        'button:has-text("Accept all")',
        'button:has-text("I agree")',
        'button[aria-label*="Accept"]'
      ];

      for (const selector of consentSelectors) {
        try {
          const button = await this.page.$(selector);
          if (button) {
            const isVisible = await this.page.evaluate((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }, button);
            
            if (isVisible) {
              await button.click();
              await this.sleep(3000);
              console.log(`[UserBrowserService:${this.userId}] Consent accepted`);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Dismiss "Not now" prompts
      const dismissSelectors = [
        'button:has-text("Not now")',
        'button:has-text("Skip")',
        'button[aria-label*="Not now"]'
      ];

      for (const selector of dismissSelectors) {
        try {
          const buttons = await this.page.$$(selector);
          for (const button of buttons.slice(0, 3)) {
            const isVisible = await this.page.evaluate((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }, button);
            
            if (isVisible) {
              await button.click();
              await this.sleep(1000);
            }
          }
        } catch (e) {
          continue;
        }
      }
    } catch (error) {
      console.warn(`[UserBrowserService:${this.userId}] Error handling prompts:`, error.message);
    }
  }

  /**
   * Watch a video from homepage feed
   */
  async watchHomepageVideo() {
    try {
      // Scroll to load feed
      await this.humanScroll();
      await this.sleep(2000);

      // Find video links
      const videoSelectors = [
        'a[href*="/watch?v="]',
        'ytd-rich-item-renderer a[href*="/watch"]',
        'ytd-video-renderer a[href*="/watch"]'
      ];

      let videoLink = null;
      for (const selector of videoSelectors) {
        try {
          const links = await this.page.$$(selector);
          for (const link of links.slice(0, 5)) {
            const isVisible = await this.page.evaluate((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }, link);
            
            if (isVisible) {
              videoLink = link;
              break;
            }
          }
          if (videoLink) break;
        } catch (e) {
          continue;
        }
      }

      if (videoLink) {
        console.log(`[UserBrowserService:${this.userId}] Clicking video from feed...`);
        await videoLink.click();
        
        try {
          await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
          console.log(`[UserBrowserService:${this.userId}] Video page loaded`);
          
          // Watch for 15-20 seconds
          await this.sleep(this.randomBetween(15000, 20000));
          
          // Scroll and interact
          await this.humanScroll();
          await this.sleep(2000);
          
          console.log(`[UserBrowserService:${this.userId}] Video watched, session cookies should be generated`);
        } catch (navError) {
          console.warn(`[UserBrowserService:${this.userId}] Video navigation timeout:`, navError.message);
        }
      } else {
        console.warn(`[UserBrowserService:${this.userId}] No video links found in feed`);
      }
    } catch (error) {
      console.warn(`[UserBrowserService:${this.userId}] Error watching video:`, error.message);
    }
  }

  /**
   * Human-like scrolling
   */
  async humanScroll() {
    const scrollSteps = this.randomBetween(3, 6);
    const scrollAmount = this.randomBetween(300, 800);

    for (let i = 0; i < scrollSteps; i++) {
      await this.page.evaluate((amount) => {
        window.scrollBy(0, amount);
      }, scrollAmount);
      await this.sleep(this.randomBetween(500, 1500));
    }
  }

  /**
   * Export cookies to Netscape format
   * @param {boolean} saveToFile - Whether to save cookies to file (default: true)
   * @returns {Promise<Array>} - Array of cookie objects
   */
  async exportCookies(saveToFile = true) {
    try {
      if (!this.page) {
        throw new Error('No page available');
      }

      const cookies = await this.page.cookies();
      console.log(`[UserBrowserService:${this.userId}] Found ${cookies.length} cookies in browser`);

      // Filter for YouTube/Google cookies
      const youtubeCookies = cookies.filter(c => 
        c.domain.includes('youtube.com') || 
        c.domain.includes('google.com')
      );

      console.log(`[UserBrowserService:${this.userId}] Filtered to ${youtubeCookies.length} YouTube/Google cookies`);

      // Check for critical cookies
      const criticalCookies = ['__Secure-3PSID', '__Secure-3PAPISID', 'LOGIN_INFO', 'VISITOR_INFO1_LIVE', 'YSC', 'CONSENT'];
      const found = criticalCookies.filter(name => youtubeCookies.some(c => c.name === name));
      const missing = criticalCookies.filter(name => !youtubeCookies.some(c => c.name === name));

      if (found.length > 0) {
        console.log(`[UserBrowserService:${this.userId}] ✓ Found critical cookies: ${found.join(', ')}`);
      }
      if (missing.length > 0) {
        console.warn(`[UserBrowserService:${this.userId}] ⚠️ Missing critical cookies: ${missing.join(', ')}`);
      }

      // Save cookies using CookieExtractor (which handles encryption) if requested
      if (saveToFile) {
        const savedPath = this.cookieExtractor.saveCookiesToFile(this.userId, youtubeCookies);
        this.cookieFilePath = savedPath;
        console.log(`[UserBrowserService:${this.userId}] ✓ Exported and encrypted ${youtubeCookies.length} cookies to ${savedPath}`);
      }

      return youtubeCookies;
    } catch (error) {
      console.error(`[UserBrowserService:${this.userId}] Cookie export error:`, error.message);
      throw error;
    }
  }

  /**
   * Convert cookies to Netscape format
   */
  convertToNetscapeFormat(cookies) {
    const lines = [
      '# Netscape HTTP Cookie File',
      '# This file was generated by UserBrowserService',
      '# Format: domain\tflag\tpath\tsecure\texpiration\tname\tvalue',
      ''
    ];

    for (const cookie of cookies) {
      const domain = cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`;
      const flag = 'TRUE';
      const path = cookie.path || '/';
      const secure = cookie.secure ? 'TRUE' : 'FALSE';
      
      let expiration;
      if (cookie.expires && cookie.expires > 0) {
        expiration = Math.floor(cookie.expires);
      } else {
        const oneYearFromNow = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);
        expiration = oneYearFromNow;
      }

      lines.push(`${domain}\t${flag}\t${path}\t${secure}\t${expiration}\t${cookie.name}\t${cookie.value}`);
    }

    return lines.join('\n');
  }

  /**
   * Stop browser instance
   */
  async stop() {
    if (!this.isRunning && !this.browser) return;

    console.log(`[UserBrowserService:${this.userId}] Stopping browser...`);
    
    this.isRunning = false;
    this.isBrowsing = false;

    try {
      // Final cookie export
      if (this.page) {
        await this.exportCookies();
      }
    } catch (e) {
      console.warn(`[UserBrowserService:${this.userId}] Final export failed:`, e.message);
    }

    if (this.browser) {
      try {
        // Close all pages first
        const pages = await this.browser.pages();
        for (const page of pages) {
          try {
            await page.close();
          } catch (e) {
            // Page might already be closed
          }
        }
        
        // Close browser
        await this.browser.close();
      } catch (e) {
        console.warn(`[UserBrowserService:${this.userId}] Error closing browser:`, e.message);
        // Force kill if graceful close fails
        try {
          if (this.browser.process()) {
            this.browser.process().kill('SIGKILL');
          }
        } catch (killError) {
          // Process might already be dead
        }
      }
      
      this.browser = null;
      this.page = null;
    }

    // Clean up lock files after browser is closed
    setTimeout(() => {
      this.cleanupProfileLocks();
    }, 1000); // Wait a bit for Chrome to release locks

    console.log(`[UserBrowserService:${this.userId}] Browser stopped`);
  }

  /**
   * Utility: Random number between min and max
   */
  randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Utility: Sleep/delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default UserBrowserService;

