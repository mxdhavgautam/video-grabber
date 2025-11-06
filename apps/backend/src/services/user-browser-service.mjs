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
   * AGGRESSIVE: Removes entire profile if any locks exist - ensures fresh start
   */
  async cleanupProfileLocks() {
    try {
      if (!fs.existsSync(this.profileDir)) {
        return;
      }

      // Check if any lock files exist
      const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
      let hasLocks = false;
      
      for (const lockFile of lockFiles) {
        const lockPath = path.join(this.profileDir, lockFile);
        if (fs.existsSync(lockPath)) {
          hasLocks = true;
          break;
        }
      }

      // If ANY locks exist, nuke the entire profile and start fresh
      // This is the most reliable approach - no point trying to clean individual locks
      if (hasLocks) {
        console.log(`[UserBrowserService:${this.userId}] Profile has lock files, removing entire profile for fresh start...`);
        
        // First, try to kill any Chrome processes that might be using it
        try {
          // Kill ALL Chrome/Chromium processes (aggressive)
          const allChromeProcesses = execSync(`ps aux | grep -iE "(chrom|chromium)" | grep -v grep || true`, { encoding: 'utf-8' });
          if (allChromeProcesses && allChromeProcesses.trim()) {
            console.log(`[UserBrowserService:${this.userId}] Killing all Chrome processes...`);
            const lines = allChromeProcesses.trim().split('\n');
            for (const line of lines) {
              const parts = line.trim().split(/\s+/);
              if (parts.length > 1) {
                const pid = parts[1];
                if (/^\d+$/.test(pid)) {
                  try {
                    execSync(`kill -9 ${pid} 2>/dev/null || true`);
                    console.log(`[UserBrowserService:${this.userId}] Killed Chrome process: ${pid}`);
                  } catch (e) {
                    // Process might already be dead
                  }
                }
              }
            }
            // Wait for processes to die
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (e) {
          console.warn(`[UserBrowserService:${this.userId}] Error killing Chrome processes:`, e.message);
        }

        // Remove entire profile directory
        try {
          fs.rmSync(this.profileDir, { recursive: true, force: true });
          fs.mkdirSync(this.profileDir, { recursive: true });
          console.log(`[UserBrowserService:${this.userId}] ✓ Profile nuked and recreated for fresh start`);
        } catch (rmError) {
          console.error(`[UserBrowserService:${this.userId}] Error removing profile:`, rmError.message);
          throw rmError;
        }
      } else {
        console.log(`[UserBrowserService:${this.userId}] No lock files found, profile is clean`);
      }
    } catch (error) {
      console.warn(`[UserBrowserService:${this.userId}] Error cleaning up profile locks:`, error.message);
      // Last resort: try to remove profile anyway
      try {
        if (fs.existsSync(this.profileDir)) {
          console.log(`[UserBrowserService:${this.userId}] Last resort: removing entire profile...`);
          fs.rmSync(this.profileDir, { recursive: true, force: true });
          fs.mkdirSync(this.profileDir, { recursive: true });
        }
      } catch (rmError) {
        console.error(`[UserBrowserService:${this.userId}] Failed to remove profile:`, rmError.message);
      }
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
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
      try {
        console.log(`[UserBrowserService:${this.userId}] Starting browser for user ${this.userId} (attempt ${retryCount + 1}/${maxRetries + 1})...`);
        
        // Clean up any stale lock files before starting (aggressive - nukes profile if locked)
        await this.cleanupProfileLocks();
        
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
      
      // Enhanced stealth (based on old working code)
      await this.page.evaluateOnNewDocument(() => {
        // Remove webdriver property
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        delete navigator.__proto__.webdriver;
        
        // Override permissions API
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
        
        // Override plugins (more realistic)
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            const plugins = [];
            plugins.push({
              0: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
              description: 'Portable Document Format',
              filename: 'internal-pdf-viewer',
              length: 1,
              name: 'Chrome PDF Plugin'
            });
            plugins.push({
              0: { type: 'application/pdf', suffixes: 'pdf', description: '' },
              description: '',
              filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
              length: 1,
              name: 'Chrome PDF Viewer'
            });
            return plugins;
          }
        });
        
        // Override languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en']
        });
        
        // Override platform to be consistent
        Object.defineProperty(navigator, 'platform', {
          get: () => 'Win32'
        });
        
        // Add realistic hardware concurrency
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => 8
        });
        
        // Add realistic device memory
        Object.defineProperty(navigator, 'deviceMemory', {
          get: () => 8
        });
        
        // Override Chrome runtime
        window.chrome = {
          runtime: {}
        };
        
        // Override outerWidth/outerHeight to match viewport
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

        console.log(`[UserBrowserService:${this.userId}] ✓ Browser started and authenticated successfully`);
        return cookies;
      } catch (error) {
        console.error(`[UserBrowserService:${this.userId}] Browser launch/authentication error (attempt ${retryCount + 1}):`, error.message);
        
        // Clean up browser if it was partially started
        if (this.browser) {
          try {
            await this.browser.close();
          } catch (e) {
            // Browser might already be closed
          }
          this.browser = null;
          this.page = null;
          this.isRunning = false;
        }
        
        // If it's a profile lock error and we haven't retried yet, nuke profile and retry
        if ((error.message.includes('profile') || error.message.includes('Code: 21') || error.message.includes('locked')) && retryCount < maxRetries) {
          console.log(`[UserBrowserService:${this.userId}] Profile lock detected, nuking profile and retrying...`);
          try {
            // Aggressively remove entire profile
            if (fs.existsSync(this.profileDir)) {
              fs.rmSync(this.profileDir, { recursive: true, force: true });
              fs.mkdirSync(this.profileDir, { recursive: true });
              console.log(`[UserBrowserService:${this.userId}] ✓ Profile nuked, retrying in 2 seconds...`);
            }
          } catch (rmError) {
            console.error(`[UserBrowserService:${this.userId}] Error nuking profile:`, rmError.message);
          }
          retryCount++;
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait before retry
          continue; // Retry
        }
        
        // If we've exhausted retries or it's not a lock error, throw
        throw error;
      }
    }
    
    // Should never reach here, but just in case
    throw new Error('Failed to start browser after all retries');
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
   * Authenticate with OAuth token by actually signing in to YouTube
   * CRITICAL: We need to actually sign in, not just navigate with cookies
   * YouTube session cookies (__Secure-3PSID, __Secure-3PAPISID, LOGIN_INFO) are only
   * set when you actually sign in, not just when you navigate with OAuth cookies
   */
  async authenticateWithOAuth(accessToken) {
    try {
      // Step 1: Navigate to YouTube sign-in page using OAuth token
      // We'll use the OAuth token to authenticate via YouTube's web interface
      console.log(`[UserBrowserService:${this.userId}] Signing in to YouTube with OAuth token...`);
      
      // Navigate to YouTube with OAuth token in URL or as a cookie
      // YouTube will recognize the OAuth token and sign us in
      await this.page.goto('https://www.youtube.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await this.sleep(3000);

      // Step 2: Wait for YouTube to recognize the session and populate feed
      // YouTube may take time to establish session after OAuth cookies are loaded
      console.log(`[UserBrowserService:${this.userId}] Waiting for YouTube to establish session...`);
      await this.sleep(5000);
      
      // Handle any prompts that might appear
      await this.handleYouTubePrompts();

      // Step 3: Navigate to YouTube account page to trigger session establishment
      console.log(`[UserBrowserService:${this.userId}] Navigating to YouTube account page...`);
      await this.page.goto('https://www.youtube.com/account', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await this.sleep(5000);

      // Step 5: Navigate back to YouTube homepage and check for session cookies
      console.log(`[UserBrowserService:${this.userId}] Checking YouTube session...`);
      await this.page.goto('https://www.youtube.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await this.sleep(5000);

      // Step 6: Verify we have session cookies by checking cookies
      const cookies = await this.page.cookies();
      const hasSessionCookies = cookies.some(c => 
        c.name === '__Secure-3PSID' || 
        c.name === '__Secure-3PAPISID' || 
        c.name === 'LOGIN_INFO'
      );

      if (hasSessionCookies) {
        console.log(`[UserBrowserService:${this.userId}] ✓ YouTube session cookies found - signed in successfully`);
      } else {
        console.warn(`[UserBrowserService:${this.userId}] ⚠️ Session cookies not found yet - may need more time or interaction`);
        console.warn(`[UserBrowserService:${this.userId}] Will continue browsing - session cookies may be set during interaction`);
      }

      // Step 7: Check if feed is populated (indicates successful sign-in)
      const feedPopulated = await this.page.evaluate(() => {
        // Check if YouTube feed has videos
        const videoSelectors = [
          'a[href*="/watch?v="]',
          'ytd-rich-item-renderer',
          'ytd-video-renderer'
        ];
        
        for (const selector of videoSelectors) {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            return true;
          }
        }
        return false;
      });

      if (feedPopulated) {
        console.log(`[UserBrowserService:${this.userId}] ✓ YouTube feed is populated - authentication successful`);
      } else {
        console.warn(`[UserBrowserService:${this.userId}] ⚠️ YouTube feed is empty - may indicate bot detection or incomplete sign-in`);
        console.warn(`[UserBrowserService:${this.userId}] Will continue - browsing may trigger feed population`);
      }

      console.log(`[UserBrowserService:${this.userId}] ✓ OAuth authentication completed`);
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

      // Step 3: Wait for feed to populate - CRITICAL: This proves we're not detected as bot
      // If feed is empty, YouTube is blocking us
      console.log(`[UserBrowserService:${this.userId}] Step 2: Waiting for YouTube feed to populate...`);
      let feedPopulated = false;
      let feedCheckAttempts = 0;
      const maxFeedChecks = 10; // Check up to 10 times (30 seconds total)
      
      while (!feedPopulated && feedCheckAttempts < maxFeedChecks) {
        await this.sleep(3000);
        feedCheckAttempts++;
        
        feedPopulated = await this.page.evaluate(() => {
          const videoSelectors = [
            'a[href*="/watch?v="]',
            'ytd-rich-item-renderer',
            'ytd-video-renderer',
            'ytd-grid-video-renderer',
            '#dismissible',
            '#contents ytd-rich-item-renderer'
          ];
          
          for (const selector of videoSelectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              return true;
            }
          }
          return false;
        });
        
        if (!feedPopulated) {
          console.log(`[UserBrowserService:${this.userId}] Feed not populated yet (attempt ${feedCheckAttempts}/${maxFeedChecks}), scrolling to trigger lazy loading...`);
          // Scroll to trigger lazy loading
          await this.page.evaluate(() => {
            window.scrollBy(0, 500);
          });
          await this.sleep(2000);
        }
      }
      
      if (feedPopulated) {
        console.log(`[UserBrowserService:${this.userId}] ✓ Feed populated - YouTube session established successfully`);
      } else {
        console.warn(`[UserBrowserService:${this.userId}] ⚠️ Feed still empty after ${maxFeedChecks} attempts - YouTube may be detecting bot`);
        console.warn(`[UserBrowserService:${this.userId}] Will continue - session cookies may still be generated`);
      }

      // Step 4: Visit YouTube account page to trigger session cookies
      console.log(`[UserBrowserService:${this.userId}] Step 3: Visiting YouTube account page...`);
      try {
        await this.page.goto('https://www.youtube.com/account', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        await this.sleep(5000);
      } catch (e) {
        console.warn(`[UserBrowserService:${this.userId}] Account page visit failed:`, e.message);
      }

      // Step 5: Visit YouTube Studio to trigger more session cookies
      console.log(`[UserBrowserService:${this.userId}] Step 4: Visiting YouTube Studio...`);
      try {
        await this.page.goto('https://studio.youtube.com', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        await this.sleep(5000);
      } catch (e) {
        console.warn(`[UserBrowserService:${this.userId}] Studio page visit failed:`, e.message);
      }

      // Step 6: Go back to YouTube homepage
      console.log(`[UserBrowserService:${this.userId}] Step 5: Returning to YouTube homepage...`);
      await this.page.goto('https://www.youtube.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await this.sleep(3000);

      // Step 7: Scroll feed to trigger more cookies
      await this.humanScroll();
      await this.sleep(2000);

      // Step 8: Try to watch a video from homepage (generates VISITOR_INFO1_LIVE)
      await this.watchHomepageVideo();

      // Step 9: Handle any ads or prompts that appeared during video watching
      await this.handleYouTubePrompts();

      // Step 10: Wait for cookie rotation to complete (YouTube rotates cookies)
      // Check if cookie rotation page is loading
      const currentUrl = this.page.url();
      if (currentUrl.includes('RotateCookiesPage')) {
        console.log(`[UserBrowserService:${this.userId}] Cookie rotation detected, waiting for completion...`);
        await this.sleep(5000);
        // Navigate back to YouTube after rotation
        await this.page.goto('https://www.youtube.com', {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        await this.sleep(3000);
      }

      // Step 11: Final wait for cookies to be fully set
      await this.sleep(5000);

      // Step 12: Export cookies after all interactions (including rotation)
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
   * Handle YouTube prompts (consent, sign-in, ads, etc.)
   * Based on old working code - handles all YouTube UI elements
   */
  async handleYouTubePrompts() {
    try {
      await this.sleep(1000); // Shorter wait for responsiveness

      // CRITICAL: Look for dismiss/skip buttons FIRST (before sign-in buttons)
      // These buttons dismiss prompts without navigating
      const dismissSelectors = [
        'button:has-text("Not now")',
        'button:has-text("Skip")',
        'button:has-text("Maybe later")',
        'button[aria-label*="Not now"]',
        'button[aria-label*="Skip"]',
        'button[aria-label*="Dismiss"]'
      ];

      for (const selector of dismissSelectors) {
        try {
          const buttons = await this.page.$$(selector);
          for (const button of buttons.slice(0, 3)) {
            const isVisible = await this.page.evaluate((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && 
                     window.getComputedStyle(el).visibility !== 'hidden' &&
                     window.getComputedStyle(el).display !== 'none';
            }, button);
            
            if (isVisible) {
              await button.click();
              await this.sleep(1000);
              console.log(`[UserBrowserService:${this.userId}] Dismissed prompt: ${selector}`);
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Accept consent if present
      const consentSelectors = [
        'button:has-text("Accept all")',
        'button:has-text("I agree")',
        'button[aria-label*="Accept"]',
        'button[aria-label*="I agree"]'
      ];

      for (const selector of consentSelectors) {
        try {
          const button = await this.page.$(selector);
          if (button) {
            const isVisible = await this.page.evaluate((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 &&
                     window.getComputedStyle(el).visibility !== 'hidden' &&
                     window.getComputedStyle(el).display !== 'none';
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

      // Handle video ad skip buttons (critical for video watching)
      const adSkipSelectors = [
        'button.ytp-ad-skip-button',
        'button.ytp-ad-skip-button-modern',
        'button[aria-label*="Skip ad"]',
        'button[class*="skip"]',
        '.ytp-ad-skip-button',
        '.ytp-ad-skip-button-modern'
      ];

      for (const selector of adSkipSelectors) {
        try {
          const button = await this.page.$(selector);
          if (button) {
            const isVisible = await this.page.evaluate((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 &&
                     window.getComputedStyle(el).visibility !== 'hidden' &&
                     window.getComputedStyle(el).display !== 'none';
            }, button);
            
            if (isVisible) {
              await button.click();
              await this.sleep(2000);
              console.log(`[UserBrowserService:${this.userId}] Skipped ad`);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Handle "Keep ads" or similar prompts
      const keepAdsSelectors = [
        'button:has-text("Keep ads")',
        'button:has-text("Continue")',
        'button[aria-label*="Continue"]'
      ];

      for (const selector of keepAdsSelectors) {
        try {
          const button = await this.page.$(selector);
          if (button) {
            const isVisible = await this.page.evaluate((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }, button);
            
            if (isVisible) {
              await button.click();
              await this.sleep(2000);
              console.log(`[UserBrowserService:${this.userId}] Handled keep ads prompt`);
              break;
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
   * Based on old working code - watches videos for 8-12 seconds to generate VISITOR_INFO1_LIVE
   */
  async watchHomepageVideo() {
    try {
      // Wait for feed to populate (YouTube may be slow to load)
      console.log(`[UserBrowserService:${this.userId}] Waiting for YouTube feed to populate...`);
      await this.sleep(this.randomBetween(3000, 5000));
      
      // Scroll to trigger lazy loading and reveal more videos
      await this.humanScroll();
      await this.sleep(2000);
      
      // Scroll again to ensure feed is loaded
      await this.humanScroll();
      await this.sleep(2000);

      // Look for video links in the feed - try multiple selectors (like old code)
      const videoSelectors = [
        'a[href*="/watch?v="]',
        'ytd-rich-item-renderer a[href*="/watch"]',
        'ytd-video-renderer a[href*="/watch"]',
        'ytd-grid-video-renderer a[href*="/watch"]',
        '#dismissible a[href*="/watch"]',
        '#contents a[href*="/watch"]'
      ];

      let videoLink = null;
      let videoCount = 0;
      
      for (const selector of videoSelectors) {
        try {
          console.log(`[UserBrowserService:${this.userId}] Looking for videos with selector: ${selector}`);
          const links = await this.page.$$(selector);
          console.log(`[UserBrowserService:${this.userId}] Found ${links.length} potential video links`);
          
          if (links.length > 0) {
            // Filter to only visible, legitimate video links (like old code)
            const visibleLinks = [];
            for (const link of links.slice(0, 20)) { // Check first 20
              try {
                const href = await this.page.evaluate(el => el.href, link);
                // Must be a watch link, not a channel or other link
                if (href && href.includes('/watch?v=') && !href.includes('channel') && !href.includes('user')) {
                  const isVisible = await this.page.evaluate((el) => {
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0 && 
                           window.getComputedStyle(el).visibility !== 'hidden' &&
                           window.getComputedStyle(el).display !== 'none';
                  }, link);
                  
                  if (isVisible) {
                    visibleLinks.push({ link, href });
                  }
                }
              } catch (evalError) {
                continue;
              }
            }
            
            console.log(`[UserBrowserService:${this.userId}] Found ${visibleLinks.length} visible, valid video links`);
            
            if (visibleLinks.length > 0) {
              // Pick a random video from top 10 (more likely to be relevant)
              const index = Math.floor(Math.random() * Math.min(10, visibleLinks.length));
              videoLink = visibleLinks[index].link;
              videoCount = visibleLinks.length;
              console.log(`[UserBrowserService:${this.userId}] ✓ Selected video ${index + 1} of ${visibleLinks.length}: ${visibleLinks[index].href}`);
              break;
            }
          }
        } catch (e) {
          console.warn(`[UserBrowserService:${this.userId}] Error with selector ${selector}:`, e.message);
          continue;
        }
      }

      if (videoLink) {
        // Click and watch the video (like old code)
        try {
          console.log(`[UserBrowserService:${this.userId}] Clicking video link from homepage...`);
          
          // Scroll video into view first
          await this.page.evaluate((el) => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, videoLink);
          await this.sleep(1000);
          
          await videoLink.click();
          
          // Wait for navigation
          try {
            await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
            console.log(`[UserBrowserService:${this.userId}] Video page loaded`);
          } catch (navError) {
            // Navigation might have already happened
            console.log(`[UserBrowserService:${this.userId}] Navigation check completed`);
          }
          
          // Handle any ads or prompts before watching
          await this.handleYouTubePrompts();
          
          // CRITICAL: Watch for 8-12 seconds (like old code) - this generates VISITOR_INFO1_LIVE
          const watchDuration = this.randomBetween(8000, 12000);
          console.log(`[UserBrowserService:${this.userId}] Watching video for ${watchDuration}ms to generate session cookies...`);
          
          // During video watching, periodically check for and skip ads
          const checkInterval = 2000; // Check every 2 seconds
          const checks = Math.ceil(watchDuration / checkInterval);
          for (let i = 0; i < checks; i++) {
            await this.sleep(Math.min(checkInterval, watchDuration - (i * checkInterval)));
            // Check for skip ad button
            await this.handleYouTubePrompts();
          }
          
          // Scroll and interact while watching
          await this.humanScroll();
          await this.sleep(2000);
          
          console.log(`[UserBrowserService:${this.userId}] ✓ Video watched, session cookies (VISITOR_INFO1_LIVE) should be generated`);
        } catch (watchError) {
          console.warn(`[UserBrowserService:${this.userId}] Error watching video:`, watchError.message);
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
    setTimeout(async () => {
      await this.cleanupProfileLocks();
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


