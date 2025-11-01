/**
 * Cookie Generator Service
 * 
 * Strategic Cookie Generation for YouTube Bot Detection Bypass
 * 
 * High-Level Strategy:
 * 1. **YouTube-First Focus (80% of activity)**: Prioritize YouTube engagement over generic browsing
 *    - Watching videos generates critical cookies (VISITOR_INFO1_LIVE, YSC, session cookies)
 *    - Interacting with YouTube feed creates natural browsing history
 *    - Multiple searches build search history that YouTube trusts
 * 
 * 2. **Cookie Quality > Quantity**: Focus on getting the RIGHT cookies, not just any cookies
 *    - VISITOR_INFO1_LIVE: Session identifier (critical for bot detection bypass)
 *    - YSC: YouTube session cookie (proves active YouTube session)
 *    - CONSENT: Privacy consent (legitimizes the session)
 *    - Google auth cookies: Support cross-domain authentication
 * 
 * 3. **Session Warmup Pattern**: Build legitimate browsing history
 *    - Homepage visit → Feed scroll → Search → Watch video → Search again → Watch another
 *    - Creates natural pattern YouTube's algorithms recognize as human
 * 
 * 4. **Maintenance Strategy**: 
 *    - Light YouTube activity every 2-3 minutes (keeps session alive)
 *    - Full session renewal every 10 minutes (fresh cookies)
 *    - Export cookies immediately after video watching (capture session cookies)
 * 
 * The goal: Generate cookies that make yt-dlp requests appear to come from
 * an active, engaged browser session, not a cold automated request.
 */

import puppeteer from 'puppeteer-core';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

// Configure puppeteer-extra with stealth plugin to reduce bot detection
puppeteerExtra.use(StealthPlugin());

class CookieGenerator {
  constructor(cookiesPath, profileDir) {
    this.cookiesPath = cookiesPath;
    this.profileDir = profileDir;
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.cookieUpdateInterval = null;
    this.restartTimeout12h = null;
    this.restartTimeout24h = null;
    this.sessionDuration12h = 12 * 60 * 60 * 1000; // 12 hours in milliseconds
    this.sessionDuration24h = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    this.botDetectionFailures = 0; // Track consecutive bot detection failures
    this.maxConsecutiveFailures = 3; // Restart after 3 consecutive failures (even with fresh cookies)
    this.lastFailureTime = null;
    this.restartCooldown = 30 * 60 * 1000; // Don't restart more than once every 30 minutes
    this.lastRestartTime = null;
    this.captchaSolver = null; // CAPTCHA solver service (optional)
    
    // Initialize CAPTCHA solver asynchronously (optional dependency)
    this.initCaptchaSolver();
  }

  /**
   * Initialize CAPTCHA solver (async, non-blocking)
   */
  async initCaptchaSolver() {
    try {
      const captchaSolverModule = await import('./captcha-solver.mjs');
      const CaptchaSolver = captchaSolverModule.default;
      this.captchaSolver = new CaptchaSolver();
      console.log('[CookieGenerator] CAPTCHA solver initialized');
    } catch (error) {
      console.log('[CookieGenerator] CAPTCHA solver not available (optional):', error.message);
      this.captchaSolver = null;
    }
  }

  /**
   * Initialize and start the cookie generation service
   * Can be called multiple times for 12-hour restarts
   */
  async start() {
    // Allow restart even if already running (for 12-hour restarts)
    if (this.isRunning) {
      // If already running and this is a restart attempt, clean up first
      console.log('[CookieGenerator] Restarting browser instance...');
      await this.cleanupBrowser();
      this.isRunning = false;
    }

    try {
      console.log('[CookieGenerator] Starting Chrome browser for human-like browsing...');
      
      // Ensure profile directory exists (will be created fresh if wiped)
      if (!fs.existsSync(this.profileDir)) {
        fs.mkdirSync(this.profileDir, { recursive: true });
      }

      // Use Xvfb display if available (non-headless mode), otherwise fall back to headless
      const useDisplay = process.env.DISPLAY || (process.env.USE_VNC === 'true' ? ':99' : null);
      const isHeadless = !useDisplay;
      
      console.log(`[CookieGenerator] Launching Chrome in ${isHeadless ? 'headless' : 'VNC/Xvfb'} mode`);
      if (useDisplay) {
        console.log(`[CookieGenerator] Using DISPLAY: ${useDisplay}`);
      }

      // Chrome launch arguments with enhanced stealth and cookie support
      const chromeArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        // Cookie settings - allow ALL cookies (including third-party)
        '--disable-features=BlockThirdPartyCookies',
        '--enable-features=NetworkService',
        // Additional stealth features
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
      ];

      // GPU and rendering settings (adjust for VNC vs headless)
      if (isHeadless) {
        chromeArgs.push('--disable-accelerated-2d-canvas', '--disable-gpu');
      } else {
        chromeArgs.push('--display=' + useDisplay);
      }

      // Launch Chrome with persistent profile using puppeteer-extra (with stealth plugin)
      // puppeteerExtra.launch uses the same API as puppeteer.launch but includes stealth plugins
      this.browser = await puppeteerExtra.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: isHeadless,
        args: chromeArgs,
        userDataDir: this.profileDir,
      });

      this.page = await this.browser.newPage();
      
      // Enhanced stealth: Hide automation indicators
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
        
        // Override plugins
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5]
        });
        
        // Override languages
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en']
        });
      });

      // Set realistic viewport
      await this.page.setViewport({ width: 1920, height: 1080 });
      
      // Set extra headers
      await this.page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
      });
      
      // Note: Request interception can break some navigation, so we use Chrome args instead
      // Chrome args already include --disable-features=BlockThirdPartyCookies
      // This allows all cookies without intercepting requests

      this.isRunning = true;
      console.log('[CookieGenerator] Browser started successfully');

      // Reset bot detection failure counter on fresh start
      this.botDetectionFailures = 0;
      this.lastFailureTime = null;

      // Start the browsing session
      await this.performBrowsingSession();

      // Set up periodic cookie export (every 5 minutes)
      this.cookieUpdateInterval = setInterval(async () => {
        await this.exportCookies();
      }, 5 * 60 * 1000); // 5 minutes

      // Schedule 12-hour browser instance restart (primary renewal)
      this.restartTimeout12h = setTimeout(() => {
        this.restartBrowserInstance();
      }, this.sessionDuration12h);
      console.log(`[CookieGenerator] Scheduled browser restart in 12 hours`);

      // Schedule 24-hour browser instance restart (secondary renewal)
      this.restartTimeout24h = setTimeout(() => {
        this.restartBrowserInstance();
      }, this.sessionDuration24h);
      console.log(`[CookieGenerator] Scheduled browser restart in 24 hours`);

    } catch (error) {
      console.error('[CookieGenerator] Failed to start:', error.message);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Report bot detection failure from YouTube extraction
   * This allows the extractor to signal that cookies might be stale/reputation issues
   */
  reportBotDetectionFailure() {
    const now = Date.now();
    
    // Reset counter if last failure was more than 10 minutes ago (separate incidents)
    if (this.lastFailureTime && (now - this.lastFailureTime) > 10 * 60 * 1000) {
      this.botDetectionFailures = 0;
    }
    
    this.botDetectionFailures++;
    this.lastFailureTime = now;
    
    console.warn(`[CookieGenerator] Bot detection failure reported (${this.botDetectionFailures}/${this.maxConsecutiveFailures})`);
    
    // If we have fresh cookies but still getting bot detection, restart browser
    if (this.botDetectionFailures >= this.maxConsecutiveFailures) {
      const timeSinceLastRestart = this.lastRestartTime ? (now - this.lastRestartTime) : Infinity;
      
      if (timeSinceLastRestart > this.restartCooldown) {
        console.warn(`[CookieGenerator] ⚠️  ${this.botDetectionFailures} consecutive bot detection failures with fresh cookies`);
        console.warn(`[CookieGenerator] Restarting browser instance to reset reputation...`);
        this.restartBrowserInstance().catch(error => {
          console.error('[CookieGenerator] Error restarting due to bot detection:', error.message);
        });
      } else {
        console.log(`[CookieGenerator] Restart cooldown active (${Math.round((this.restartCooldown - timeSinceLastRestart) / 60000)}m remaining)`);
      }
    }
  }

  /**
   * Reset bot detection failure counter (called on successful extraction)
   */
  reportSuccessfulExtraction() {
    // Reset counter on success - this means cookies are working
    if (this.botDetectionFailures > 0) {
      console.log(`[CookieGenerator] Successful extraction - resetting bot detection failure counter`);
      this.botDetectionFailures = 0;
      this.lastFailureTime = null;
    }
  }

  /**
   * Perform human-like browsing activities
   * 
   * Strategic Pattern: YouTube-First Focus
   * - 80% YouTube activity (homepage, feed, searches, video watching)
   * - 20% supporting activity (Google search, quick visits)
   * - Priority: Generate high-quality YouTube session cookies
   */
  async performBrowsingSession() {
    try {
      console.log('[CookieGenerator] Starting strategic YouTube-focused browsing session...');

      // Phase 1: Quick Google visit (builds Google auth cookies that support YouTube)
      await this.googleSearch('technology news', {
        waitTime: [2000, 3000],
        scroll: false // Quick visit, no deep scrolling
      });

      // Phase 2: YouTube Session Warmup (CRITICAL - generates best cookies)
      // This is where we spend most of our time for maximum cookie quality
      await this.youtubeSessionWarmup();

      // Phase 3: Export cookies immediately after YouTube activity
      // This captures fresh session cookies from video watching
      await this.exportCookies();
      
      console.log('[CookieGenerator] ✓ YouTube-focused browsing session completed, cookies exported');
      
      // Verify cookie quality
      await this.verifyCookieQuality();

      // Continue light browsing periodically
      this.scheduleLightBrowsing();

    } catch (error) {
      console.error('[CookieGenerator] Error during browsing session:', error.message);
    }
  }

  /**
   * YouTube Session Warmup - Strategic Pattern
   * 
   * Pattern: Homepage → Feed Scroll → Search → Watch → Search → Watch
   * This creates natural browsing history that YouTube trusts
   */
  async youtubeSessionWarmup() {
    try {
      console.log('[CookieGenerator] Starting YouTube session warmup...');

      // Step 1: Visit YouTube homepage and scroll feed (builds initial session)
      await this.humanVisit('https://www.youtube.com', {
        waitTime: [3000, 5000],
        scroll: true, // Scroll through feed
        randomDelay: true
      });

      // Check for CAPTCHA/challenge after homepage load
      if (this.captchaSolver) {
        try {
          const captchaInfo = await this.captchaSolver.detectCaptcha(this.page);
          if (captchaInfo && captchaInfo.found) {
            console.log(`[CookieGenerator] CAPTCHA detected on homepage: ${captchaInfo.type}`);
            if (captchaInfo.type === 'youtube-challenge') {
              await this.captchaSolver.handleYouTubeChallenge(this.page);
            } else if (captchaInfo.type.includes('recaptcha')) {
              await this.captchaSolver.solveRecaptchaV2(this.page);
            }
            await this.sleep(3000); // Wait after CAPTCHA solving
          }
        } catch (captchaError) {
          console.warn('[CookieGenerator] CAPTCHA check error:', captchaError.message);
        }
      }

      await this.sleep(this.randomBetween(2000, 4000));

      // CRITICAL: Handle YouTube prompts before proceeding
      await this.handleYouTubePrompts();
      
      // Wait for feed to load and populate
      await this.sleep(this.randomBetween(2000, 3000));
      
      // Step 2: Try multiple strategies to watch videos and generate cookies
      // Strategy 1: Click videos directly from homepage feed (most reliable, no search needed)
      const watchedFromFeed = await this.watchHomepageVideos();
      
      // Strategy 2: If homepage videos didn't work, try searching (fallback)
      if (!watchedFromFeed) {
        console.log('[CookieGenerator] Homepage videos strategy failed, trying search...');
        const searchQueries = [
          'technology',
          'programming tutorials',
          'latest tech news'
        ];
        
        // Do 1-2 searches with video watching
        for (let i = 0; i < Math.min(1, searchQueries.length); i++) {
          const query = searchQueries[i];
          console.log(`[CookieGenerator] YouTube search ${i + 1}: "${query}"`);
          
          await this.youtubeSearchAndWatch(query, {
            watchDuration: [8000, 12000], // Watch for 8-12 seconds (enough for cookies)
            scrollFeed: i === 0 // Scroll feed on first search
          });
          
          // Export cookies after watching (capture session cookies)
          await this.exportCookies();
          
          // Wait between searches
          if (i < searchQueries.length - 1) {
            await this.sleep(this.randomBetween(3000, 5000));
          }
        }
      } else {
        // If we watched from feed, export cookies
        await this.exportCookies();
      }

      console.log('[CookieGenerator] ✓ YouTube session warmup completed');

    } catch (error) {
      console.warn('[CookieGenerator] YouTube session warmup error:', error.message);
    }
  }

  /**
   * Handle YouTube prompts (Sign in, consent dialogs, etc.)
   * These prompts block navigation and need to be dismissed
   */
  async handleYouTubePrompts() {
    try {
      console.log('[CookieGenerator] Checking for YouTube prompts/dialogs...');
      
      // Wait a moment for any dialogs to appear
      await this.sleep(2000);
      
      // Strategy 1: Dismiss "Sign in" prompts
      try {
        const signInSelectors = [
          'button[aria-label*="Sign in"]',
          'a[aria-label*="Sign in"]',
          'yt-button-renderer a[href*="/accounts/"]',
          '[aria-label="Sign in"]'
        ];
        
        for (const selector of signInSelectors) {
          try {
            const elements = await this.page.$$(selector);
            for (const el of elements.slice(0, 3)) {
              const isVisible = await this.page.evaluate((e) => {
                const rect = e.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && 
                       window.getComputedStyle(e).visibility !== 'hidden';
              }, el);
              
              if (isVisible) {
                const text = await this.page.evaluate(e => e.textContent?.toLowerCase() || '', el);
                // Only dismiss "Sign in" buttons in dialogs, not the main nav button
                if (text.includes('sign in') && !text.includes('subscribe')) {
                  console.log('[CookieGenerator] Found "Sign in" prompt, clicking to dismiss...');
                  await el.click();
                  await this.sleep(1000);
                  break;
                }
              }
            }
          } catch (e) {
            continue;
          }
        }
      } catch (error) {
        console.log('[CookieGenerator] Error handling sign in prompts:', error.message);
      }
      
      // Strategy 2: Accept cookies/consent if dialog appears
      try {
        const consentSelectors = [
          'button:has-text("Accept all")',
          'button:has-text("I agree")',
          'button[aria-label*="Accept"]',
          'button[aria-label*="Agree"]',
          '[id*="accept"]',
          '[id*="agree"]',
          'ytd-consent-bump-v2-lightbox button'
        ];
        
        for (const selector of consentSelectors) {
          try {
            const button = await this.page.$(selector);
            if (button) {
              const isVisible = await this.page.evaluate((e) => {
                const rect = e.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              }, button);
              
              if (isVisible) {
                console.log('[CookieGenerator] Found consent dialog, accepting...');
                await button.click();
                await this.sleep(2000);
                console.log('[CookieGenerator] ✓ Consent accepted');
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
      } catch (error) {
        console.log('[CookieGenerator] Error handling consent:', error.message);
      }
      
      // Strategy 3: Try clicking "Not now" or "Skip" on sign-in prompts
      try {
        const skipSelectors = [
          'button:has-text("Not now")',
          'button:has-text("Skip")',
          'button[aria-label*="Not now"]',
          'yt-button-renderer button[aria-label*="Not now"]'
        ];
        
        for (const selector of skipSelectors) {
          try {
            const button = await this.page.$(selector);
            if (button) {
              console.log('[CookieGenerator] Found skip/not now button, clicking...');
              await button.click();
              await this.sleep(1500);
              break;
            }
          } catch (e) {
            continue;
          }
        }
      } catch (error) {
        // Ignore errors
      }
      
      // Strategy 4: If there's a modal/overlay, try to close it
      try {
        const closeSelectors = [
          'button[aria-label="Close"]',
          'button[aria-label*="Close"]',
          '[aria-label="Close dialog"]',
          'paper-dialog button[aria-label*="Close"]'
        ];
        
        for (const selector of closeSelectors) {
          try {
            const button = await this.page.$(selector);
            if (button) {
              const isVisible = await this.page.evaluate((e) => {
                const rect = e.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
              }, button);
              
              if (isVisible) {
                console.log('[CookieGenerator] Found close button, clicking...');
                await button.click();
                await this.sleep(1000);
              }
            }
          } catch (e) {
            continue;
          }
        }
      } catch (error) {
        // Ignore errors
      }
      
      // Scroll a bit to show we're interacting
      await this.humanScroll();
      await this.sleep(1000);
      
    } catch (error) {
      console.warn('[CookieGenerator] Error handling YouTube prompts:', error.message);
    }
  }

  /**
   * Search YouTube and watch a video
   * This is critical for generating VISITOR_INFO1_LIVE and session cookies
   */
  async youtubeSearchAndWatch(query, options = {}) {
    const { watchDuration = [5000, 10000], scrollFeed = false } = options;

    try {
      // Navigate to YouTube if not already there
      let currentUrl = this.page.url();
      console.log(`[CookieGenerator] Current URL: ${currentUrl}`);
      
      if (!currentUrl.includes('youtube.com')) {
        console.log('[CookieGenerator] Not on YouTube, navigating to homepage...');
        await this.humanVisit('https://www.youtube.com', {
          waitTime: [2000, 3000],
          scroll: scrollFeed,
          randomDelay: false
        });
        console.log(`[CookieGenerator] After navigation, URL: ${this.page.url()}`);
      }

      // CRITICAL: Handle YouTube prompts before searching
      // YouTube shows "Sign in" and consent dialogs that block navigation
      await this.handleYouTubePrompts();

      // Wait a moment after handling prompts
      await this.sleep(this.randomBetween(1000, 2000));

      // Find and use search box
      console.log('[CookieGenerator] Looking for YouTube search box...');
      let searchBox = null;
      const selectors = [
        'input[name="search_query"]',
        'input[id="search"]',
        'input[placeholder*="Search"]',
        'input[aria-label*="Search"]',
        '#search-input input',
        'input[type="text"]'
      ];

      for (const selector of selectors) {
        try {
          console.log(`[CookieGenerator] Trying search selector: ${selector}`);
          searchBox = await this.page.$(selector);
          if (searchBox) {
            const isVisible = await this.page.evaluate((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
            }, searchBox);
            if (isVisible) {
              console.log(`[CookieGenerator] ✓ Found visible search box with selector: ${selector}`);
              break;
            } else {
              console.log(`[CookieGenerator] Found search box but it's not visible`);
              searchBox = null;
            }
          } else {
            console.log(`[CookieGenerator] No element found for selector: ${selector}`);
          }
        } catch (e) {
          console.log(`[CookieGenerator] Error trying selector ${selector}:`, e.message);
          continue;
        }
      }

      if (!searchBox) {
        console.warn('[CookieGenerator] Could not find YouTube search box');
        // Debug: Log page structure
        try {
          const pageTitle = await this.page.title();
          const pageUrl = this.page.url();
          console.log(`[CookieGenerator] Page debug - Title: "${pageTitle}", URL: ${pageUrl}`);
          
          // Check if YouTube loaded properly
          const hasYouTubeContent = await this.page.evaluate(() => {
            return document.body && document.body.innerText.includes('YouTube');
          });
          console.log(`[CookieGenerator] Page has YouTube content: ${hasYouTubeContent}`);
          
          // List all input elements
          const inputElements = await this.page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            return inputs.map(input => ({
              name: input.name,
              id: input.id,
              type: input.type,
              placeholder: input.placeholder,
              visible: input.offsetWidth > 0 && input.offsetHeight > 0
            })).slice(0, 10);
          });
          console.log(`[CookieGenerator] Available input elements:`, JSON.stringify(inputElements, null, 2));
        } catch (debugError) {
          console.warn('[CookieGenerator] Debug logging failed:', debugError.message);
        }
        return;
      }

      // Perform search with human-like typing
      console.log(`[CookieGenerator] Performing search for: "${query}"`);
      await searchBox.click({ delay: this.randomBetween(50, 100) });
      await this.sleep(this.randomBetween(200, 500));
      
      // Clear any existing text
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('a');
      await this.page.keyboard.up('Control');
      await this.sleep(this.randomBetween(100, 200));
      
      // Type with human-like behavior (24 WPM, typos, corrections)
      console.log(`[CookieGenerator] Typing search query character by character (human speed: ~24 WPM)...`);
      await this.humanType(searchBox, query, {
        typoRate: 0.05, // 5% typo chance
        backspaceRate: 0.03, // 3% correction chance after typo
        minCharDelay: 100, // ~24 WPM = ~250ms per char average
        maxCharDelay: 250
      });
      
      // Wait a moment before submitting (human hesitation)
      await this.sleep(this.randomBetween(500, 1000));
      
      // Try multiple methods to submit search (Enter key might not work due to YouTube's JS)
      // Method 1: Try clicking search button if available
      console.log(`[CookieGenerator] Submitting YouTube search...`);
      try {
        const searchButton = await this.page.$('button[aria-label="Search"]') || 
                            await this.page.$('button#search-icon-legacy') ||
                            await this.page.$('button.ytd-searchbox-button') ||
                            await this.page.$('yt-icon-button[aria-label="Search"]');
        if (searchButton) {
          console.log(`[CookieGenerator] Clicking YouTube search button...`);
          await searchButton.click();
        } else {
          console.log(`[CookieGenerator] No search button found, using Enter key...`);
          await searchBox.press('Enter');
        }
      } catch (buttonError) {
        console.log(`[CookieGenerator] Search button click failed, using Enter key:`, buttonError.message);
        await searchBox.press('Enter');
      }

      console.log('[CookieGenerator] Waiting for YouTube search results page to load...');
      
      // Wait a moment for navigation to start
      await this.sleep(1000);
      
      // Check if we're already on results page
      currentUrl = this.page.url();
      if (currentUrl.includes('/results')) {
        console.log(`[CookieGenerator] ✓ Already on search results page: ${currentUrl}`);
      } else {
        // Wait for navigation with multiple strategies
        try {
          // Strategy 1: Wait for URL to change to /results
          // Strategy 2: Wait for results container
          // Strategy 3: Wait for video renderers
          await Promise.race([
            this.page.waitForFunction(() => window.location.href.includes('/results'), { timeout: 15000 }),
            this.page.waitForSelector('#contents', { timeout: 15000 }).catch(() => null),
            this.page.waitForSelector('ytd-video-renderer', { timeout: 15000 }).catch(() => null),
            this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 })
          ]);
          
          currentUrl = this.page.url();
          console.log(`[CookieGenerator] ✓ Search results loaded, URL: ${currentUrl}`);
        } catch (navError) {
          console.warn('[CookieGenerator] Search navigation timeout, checking current state...');
          currentUrl = this.page.url();
          console.warn(`[CookieGenerator] Current URL: ${currentUrl}`);
          
          // Check if we're actually on a search results page
          const hasResults = await this.page.$('#contents').catch(() => null);
          const hasVideos = await this.page.$('ytd-video-renderer').catch(() => null);
          
          if (currentUrl.includes('/results') || hasResults || hasVideos) {
            console.log(`[CookieGenerator] Actually on search results page, navigation completed`);
          } else {
            console.warn('[CookieGenerator] ⚠️  Not on search results page - navigation may have failed');
            
            // Check if YouTube is blocking with prompts
            const pageContent = await this.page.content().catch(() => '');
            const bodyText = await this.page.evaluate(() => document.body?.innerText?.toLowerCase() || '').catch(() => '');
            
            if (pageContent.includes('Sign in') || bodyText.includes('sign in')) {
              console.warn('[CookieGenerator] ⚠️  Page shows "Sign in" prompt - attempting to dismiss...');
              await this.handleYouTubePrompts();
              await this.sleep(2000);
              
              // Try to re-submit search
              console.log('[CookieGenerator] Retrying search after handling prompts...');
              try {
                const searchBoxAgain = await this.page.$('input[name="search_query"]');
                if (searchBoxAgain) {
                  await searchBoxAgain.click();
                  await this.sleep(500);
                  await this.page.keyboard.press('Enter');
                  await this.sleep(3000);
                  currentUrl = this.page.url();
                  if (currentUrl.includes('/results')) {
                    console.log('[CookieGenerator] ✓ Search succeeded after handling prompts');
                  }
                }
              } catch (retryError) {
                console.warn('[CookieGenerator] Retry failed:', retryError.message);
              }
            }
          }
        }
      }

      await this.sleep(this.randomBetween(2000, 3000));
      await this.humanScroll(); // Scroll search results

      // CRITICAL: Click on a video and watch it (generates session cookies)
      console.log('[CookieGenerator] Looking for video links in search results...');
      try {
        const videoSelectors = [
          'a#video-title',
          'a#video-title-link',
          'ytd-video-renderer a#video-title',
          'ytd-video-renderer a#video-title-link',
          'ytd-video-renderer a[href*="/watch"]',
          'a[href*="/watch"]'
        ];

        let videoLink = null;
        let foundSelector = null;
        let videoCount = 0;
        
        for (const selector of videoSelectors) {
          try {
            console.log(`[CookieGenerator] Trying video selector: ${selector}`);
            const links = await this.page.$$(selector);
            console.log(`[CookieGenerator] Found ${links.length} elements with selector: ${selector}`);
            
            if (links.length > 0) {
              // Filter to only visible links
              const visibleLinks = [];
              for (const link of links.slice(0, 10)) {
                try {
                  const isVisible = await this.page.evaluate((el) => {
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0 && 
                           window.getComputedStyle(el).visibility !== 'hidden' &&
                           window.getComputedStyle(el).display !== 'none';
                  }, link);
                  if (isVisible) {
                    visibleLinks.push(link);
                  }
                } catch (evalError) {
                  console.warn(`[CookieGenerator] Error checking visibility:`, evalError.message);
                }
              }
              
              console.log(`[CookieGenerator] ${visibleLinks.length} visible video links found`);
              
              if (visibleLinks.length > 0) {
                // Pick a video from top 5 results (most relevant)
                const index = Math.min(Math.floor(Math.random() * Math.min(5, visibleLinks.length)), visibleLinks.length - 1);
                videoLink = visibleLinks[index];
                foundSelector = selector;
                videoCount = visibleLinks.length;
                console.log(`[CookieGenerator] ✓ Selected video ${index + 1} of ${visibleLinks.length} visible videos`);
                break;
              }
            }
          } catch (e) {
            console.warn(`[CookieGenerator] Error with selector ${selector}:`, e.message);
            continue;
          }
        }

        if (videoLink) {
          // Get video URL for logging
          const videoHref = await this.page.evaluate((el) => el.href, videoLink);
          console.log(`[CookieGenerator] Watching video: ${videoHref}`);
          console.log('[CookieGenerator] Clicking video link...');
          
          await videoLink.click();
          
          try {
            console.log('[CookieGenerator] Waiting for video page to load...');
            await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
            console.log(`[CookieGenerator] ✓ Video page loaded, URL: ${this.page.url()}`);
            
            // Wait a moment for video player to initialize
            await this.sleep(this.randomBetween(2000, 3000));
            
            // Watch video for specified duration (critical for cookie generation)
            const watchTime = this.randomBetween(watchDuration[0], watchDuration[1]);
            console.log(`[CookieGenerator] Watching video for ${Math.round(watchTime / 1000)}s to generate VISITOR_INFO1_LIVE cookie...`);
            
            // Scroll a bit while watching (human-like behavior)
            await this.sleep(watchTime / 2);
            await this.humanScroll();
            await this.sleep(watchTime / 2);
            
            // Sometimes interact (scroll, move mouse) while watching
            await this.randomMouseMovement();
            
            console.log('[CookieGenerator] ✓ Video watched, session cookies should be generated');
            
            // Verify we're still on video page
            const finalUrl = this.page.url();
            if (finalUrl.includes('/watch')) {
              console.log('[CookieGenerator] ✓ Confirmed on video watch page');
            } else {
              console.warn(`[CookieGenerator] ⚠️  Unexpected URL after watching: ${finalUrl}`);
            }
          } catch (videoNavError) {
            console.warn('[CookieGenerator] Video navigation timeout:', videoNavError.message);
            console.warn(`[CookieGenerator] Current URL: ${this.page.url()}`);
            // Page might still have loaded, cookies might still be generated
          }
        } else {
          console.warn('[CookieGenerator] ⚠️  Could not find any video links in search results');
          
          // Debug: Log page structure
          try {
            const pageTitle = await this.page.title();
            const pageUrl = this.page.url();
            console.log(`[CookieGenerator] Page debug - Title: "${pageTitle}", URL: ${pageUrl}`);
            
            // Check for common YouTube elements
            const pageStructure = await this.page.evaluate(() => {
              return {
                hasVideoRenderer: !!document.querySelector('ytd-video-renderer'),
                hasResults: !!document.querySelector('#contents'),
                hasSecondary: !!document.querySelector('#secondary'),
                bodyText: document.body ? document.body.innerText.substring(0, 200) : 'No body',
                allLinks: Array.from(document.querySelectorAll('a[href*="/watch"]')).slice(0, 5).map(a => ({
                  href: a.href,
                  text: a.innerText.substring(0, 50),
                  visible: a.offsetWidth > 0 && a.offsetHeight > 0
                }))
              };
            });
            console.log('[CookieGenerator] Page structure:', JSON.stringify(pageStructure, null, 2));
            
            // Check if YouTube is showing an error or blocking message
            const blockingMessages = await this.page.evaluate(() => {
              const text = document.body ? document.body.innerText.toLowerCase() : '';
              return {
                hasBotMessage: text.includes('confirm you') || text.includes('not a bot'),
                hasError: text.includes('error') || text.includes('something went wrong'),
                hasLoginPrompt: text.includes('sign in') || text.includes('login')
              };
            });
            console.log('[CookieGenerator] Blocking indicators:', JSON.stringify(blockingMessages, null, 2));
            
            // If blocking detected, try to solve CAPTCHA
            if (blockingMessages.hasBotMessage && this.captchaSolver) {
              console.log('[CookieGenerator] Bot detection message found, attempting CAPTCHA solving...');
              try {
                const captchaInfo = await this.captchaSolver.detectCaptcha(this.page);
                if (captchaInfo && captchaInfo.found) {
                  console.log(`[CookieGenerator] Detected ${captchaInfo.type}, attempting to solve...`);
                  
                  if (captchaInfo.type === 'youtube-challenge') {
                    await this.captchaSolver.handleYouTubeChallenge(this.page);
                    // Wait and check if challenge resolved
                    await this.sleep(5000);
                    const newUrl = this.page.url();
                    const newHasResults = await this.page.$('#contents').catch(() => null);
                    if (newUrl.includes('/results') || newHasResults) {
                      console.log('[CookieGenerator] ✓ YouTube challenge appears resolved');
                    }
                  } else if (captchaInfo.type === 'simple-image-captcha') {
                    // Try self-hosted solver first (free)
                    const solution = await this.captchaSolver.solveSimpleCaptcha(this.page);
                    if (solution) {
                      console.log('[CookieGenerator] ✓ Simple CAPTCHA solved with self-hosted OCR');
                      await this.sleep(2000);
                      // Try to submit form
                      try {
                        const submitButton = await this.page.$('button[type="submit"], input[type="submit"], button:contains("Submit")');
                        if (submitButton) {
                          await submitButton.click();
                          await this.sleep(2000);
                        }
                      } catch (e) {
                        // Submit may not be needed or button not found
                      }
                    } else {
                      console.log('[CookieGenerator] Self-hosted solver failed, CAPTCHA may be too complex');
                    }
                  } else if (captchaInfo.type.includes('recaptcha')) {
                    // reCAPTCHA cannot be fully solved with self-hosted OCR
                    // Will attempt basic interaction but likely won't solve image challenges
                    const solution = await this.captchaSolver.solveRecaptchaV2(this.page);
                    if (solution) {
                      console.log('[CookieGenerator] reCAPTCHA interaction attempted (may not fully solve)');
                      await this.sleep(3000);
                    } else {
                      console.warn('[CookieGenerator] reCAPTCHA cannot be solved with self-hosted solver');
                      console.warn('[CookieGenerator] Image selection challenges require human interaction');
                    }
                  }
                }
              } catch (captchaError) {
                console.warn('[CookieGenerator] CAPTCHA solving error:', captchaError.message);
              }
            }
            
          } catch (debugError) {
            console.warn('[CookieGenerator] Debug logging failed:', debugError.message);
          }
        }
      } catch (watchError) {
        console.warn('[CookieGenerator] Error watching video:', watchError.message);
        console.warn('[CookieGenerator] Error stack:', watchError.stack);
      }

    } catch (error) {
      console.warn(`[CookieGenerator] YouTube search and watch failed:`, error.message);
      console.warn(`[CookieGenerator] Error stack:`, error.stack);
    }
  }

  /**
   * Watch videos directly from YouTube homepage feed
   * This bypasses search navigation which is often blocked
   * Returns true if successful, false otherwise
   */
  async watchHomepageVideos() {
    try {
      console.log('[CookieGenerator] Attempting to watch videos from homepage feed...');
      
      // Wait for feed to be populated
      await this.sleep(this.randomBetween(2000, 4000));
      
      // Scroll to see more videos
      await this.humanScroll();
      await this.sleep(1000);
      
      // Look for video links in the feed - try multiple selectors
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
          console.log(`[CookieGenerator] Looking for videos with selector: ${selector}`);
          const links = await this.page.$$(selector);
          console.log(`[CookieGenerator] Found ${links.length} potential video links`);
          
          if (links.length > 0) {
            // Filter to only visible, legitimate video links
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
            
            console.log(`[CookieGenerator] Found ${visibleLinks.length} visible, valid video links`);
            
            if (visibleLinks.length > 0) {
              // Pick a random video from top 10 (more likely to be relevant)
              const index = Math.floor(Math.random() * Math.min(10, visibleLinks.length));
              videoLink = visibleLinks[index].link;
              videoCount = visibleLinks.length;
              console.log(`[CookieGenerator] ✓ Selected video ${index + 1} of ${visibleLinks.length}: ${visibleLinks[index].href}`);
              break;
            }
          }
        } catch (e) {
          console.warn(`[CookieGenerator] Error with selector ${selector}:`, e.message);
          continue;
        }
      }
      
      if (videoLink) {
        // Click and watch the video
        try {
          console.log('[CookieGenerator] Clicking video link from homepage...');
          
          // Scroll video into view first
          await this.page.evaluate((el) => {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, videoLink);
          await this.sleep(1000);
          
          await videoLink.click();
          
          // Wait for video page to load
          try {
            await Promise.race([
              this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
              this.page.waitForFunction(() => window.location.href.includes('/watch'), { timeout: 15000 })
            ]);
            
            const videoUrl = this.page.url();
            console.log(`[CookieGenerator] ✓ Video page loaded: ${videoUrl}`);
            
            // Wait for video player to initialize
            await this.sleep(this.randomBetween(2000, 3000));
            
            // Watch video for 8-12 seconds (critical for cookie generation)
            const watchTime = this.randomBetween(8000, 12000);
            console.log(`[CookieGenerator] Watching video for ${Math.round(watchTime / 1000)}s to generate VISITOR_INFO1_LIVE cookie...`);
            
            // Scroll a bit while watching (human-like behavior)
            await this.sleep(watchTime / 2);
            await this.humanScroll();
            await this.sleep(watchTime / 2);
            
            // Sometimes interact (scroll, move mouse) while watching
            await this.randomMouseMovement();
            
            console.log('[CookieGenerator] ✓ Video watched, session cookies should be generated');
            
            // Verify we're still on video page
            const finalUrl = this.page.url();
            if (finalUrl.includes('/watch')) {
              console.log('[CookieGenerator] ✓ Confirmed on video watch page');
            } else {
              console.warn(`[CookieGenerator] ⚠️  Unexpected URL after watching: ${finalUrl}`);
            }
            
            return true; // Success
          } catch (videoNavError) {
            console.warn('[CookieGenerator] Video navigation timeout:', videoNavError.message);
            console.warn(`[CookieGenerator] Current URL: ${this.page.url()}`);
            // Page might still have loaded, cookies might still be generated
            return true; // Assume success if we got here
          }
        } catch (clickError) {
          console.warn('[CookieGenerator] Error clicking video:', clickError.message);
          return false;
        }
      } else {
        console.warn('[CookieGenerator] ⚠️  Could not find any video links in homepage feed');
        console.warn('[CookieGenerator] YouTube may be blocking the feed or showing only "Sign in" prompts');
        return false;
      }
      
    } catch (error) {
      console.warn('[CookieGenerator] Error watching homepage videos:', error.message);
      return false;
    }
  }

  /**
   * Verify cookie quality - log which important cookies we have
   */
  async verifyCookieQuality() {
    try {
      if (!this.page) return;

      const cookies = await this.page.cookies();
      const youtubeCookies = cookies.filter(c => 
        c.domain.includes('youtube.com') || c.domain.includes('.youtube.com')
      );

      const criticalCookies = {
        'VISITOR_INFO1_LIVE': false,
        'YSC': false,
        'CONSENT': false,
        'PREF': false
      };

      const foundCookies = [];
      youtubeCookies.forEach(cookie => {
        if (criticalCookies.hasOwnProperty(cookie.name)) {
          criticalCookies[cookie.name] = true;
          foundCookies.push(cookie.name);
        }
      });

      console.log(`[CookieGenerator] Cookie Quality Check:`);
      console.log(`[CookieGenerator]   Total YouTube cookies: ${youtubeCookies.length}`);
      console.log(`[CookieGenerator]   Critical cookies found: ${foundCookies.join(', ') || 'none'}`);
      
      const missingCookies = Object.keys(criticalCookies).filter(
        name => !criticalCookies[name]
      );
      
      if (missingCookies.length > 0) {
        console.warn(`[CookieGenerator]   ⚠️  Missing critical cookies: ${missingCookies.join(', ')}`);
        console.warn(`[CookieGenerator]   💡 Watching more videos will generate these cookies`);
      } else {
        console.log(`[CookieGenerator]   ✓ All critical cookies present!`);
      }

    } catch (error) {
      console.warn('[CookieGenerator] Cookie quality verification failed:', error.message);
    }
  }

  /**
   * Visit a URL with human-like behavior
   */
  async humanVisit(url, options = {}) {
    const {
      waitTime = [2000, 4000],
      scroll = false,
      randomDelay = true
    } = options;

    try {
      console.log(`[CookieGenerator] Visiting ${url}...`);
      
      // Try multiple wait strategies - be more lenient with timeouts
      try {
        await this.page.goto(url, {
          waitUntil: 'domcontentloaded', // Less strict than networkidle2
          timeout: 20000 // 20 seconds
        });
      } catch (timeoutError) {
        // If domcontentloaded times out, try just loading
        console.warn(`[CookieGenerator] ${url} took too long, trying simpler load...`);
        try {
          await this.page.goto(url, {
            waitUntil: 'load',
            timeout: 15000
          });
        } catch (loadError) {
          // Even if load fails, continue - page might still be usable
          console.warn(`[CookieGenerator] ${url} load incomplete, but continuing...`);
        }
      }

      // Random wait (human-like)
      const wait = this.randomBetween(waitTime[0], waitTime[1]);
      await this.sleep(wait);

      // Scroll like a human would
      if (scroll) {
        await this.humanScroll();
      }

      // Random mouse movement
      if (randomDelay) {
        await this.randomMouseMovement();
      }

    } catch (error) {
      console.warn(`[CookieGenerator] Failed to visit ${url}:`, error.message);
      // Continue even if visit fails - not critical
    }
  }

  /**
   * Perform Google search
   */
  async googleSearch(query, options = {}) {
    const { waitTime = [2000, 4000], scroll = false } = options;

    try {
      console.log(`[CookieGenerator] Searching Google for: "${query}"...`);
      
      // Visit Google with lenient timeout
      console.log('[CookieGenerator] Navigating to Google homepage...');
      try {
        await this.page.goto('https://www.google.com', {
          waitUntil: 'domcontentloaded',
          timeout: 20000
        });
        console.log(`[CookieGenerator] ✓ Google homepage loaded, URL: ${this.page.url()}`);
      } catch (error) {
        console.warn(`[CookieGenerator] Google homepage load slow:`, error.message);
        console.warn(`[CookieGenerator] Current URL: ${this.page.url()}`);
      }

      console.log('[CookieGenerator] Waiting before interacting with page...');
      await this.sleep(this.randomBetween(1000, 2000));

      // Try multiple selectors for search box
      console.log('[CookieGenerator] Looking for Google search box...');
      let searchBox = null;
      const selectors = [
        'input[name="q"]',
        'textarea[name="q"]',
        'input[type="text"]',
        'input[aria-label*="Search"]',
        'input[title*="Search"]'
      ];

      for (const selector of selectors) {
        try {
          console.log(`[CookieGenerator] Trying Google search selector: ${selector}`);
          searchBox = await this.page.$(selector);
          if (searchBox) {
            // Check visibility
            const isVisible = await this.page.evaluate((el) => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
            }, searchBox);
            if (isVisible) {
              console.log(`[CookieGenerator] ✓ Found visible Google search box: ${selector}`);
              break;
            } else {
              console.log(`[CookieGenerator] Found search box but not visible`);
              searchBox = null;
            }
          } else {
            console.log(`[CookieGenerator] No element found for selector: ${selector}`);
          }
        } catch (e) {
          console.log(`[CookieGenerator] Error with selector ${selector}:`, e.message);
          continue;
        }
      }

      if (searchBox) {
        try {
          console.log(`[CookieGenerator] Clicking Google search box...`);
          await searchBox.click({ delay: this.randomBetween(50, 100) });
          await this.sleep(this.randomBetween(200, 500));
          
          // Type with human-like behavior (24 WPM, typos, corrections)
          console.log(`[CookieGenerator] Typing Google search "${query}" character by character (~24 WPM)...`);
          await this.humanType(searchBox, query, {
            typoRate: 0.05,
            backspaceRate: 0.03,
            minCharDelay: 100,
            maxCharDelay: 250
          });
          
          console.log(`[CookieGenerator] Search query typed, waiting before Enter...`);
          await this.sleep(this.randomBetween(500, 1000));
          
          // Submit search - try button first, then Enter
          console.log(`[CookieGenerator] Submitting Google search...`);
          try {
            // Try clicking Google search button
            const searchButton = await this.page.$('input[type="submit"]') ||
                                await this.page.$('button[aria-label="Google Search"]') ||
                                await this.page.$('button[name="btnK"]');
            if (searchButton) {
              console.log(`[CookieGenerator] Clicking Google search button...`);
              await searchButton.click();
            } else {
              console.log(`[CookieGenerator] No search button, using Enter key...`);
              await searchBox.press('Enter');
            }
          } catch (submitError) {
            console.log(`[CookieGenerator] Button click failed, using Enter:`, submitError.message);
            await searchBox.press('Enter');
          }
          
          // Wait for navigation with lenient timeout and better wait strategy
          console.log(`[CookieGenerator] Waiting for Google search results...`);
          try {
            // Wait for URL to change OR for search results to appear
            await Promise.race([
              this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
              this.page.waitForSelector('#search', { timeout: 20000 }).catch(() => null),
              this.page.waitForFunction(() => window.location.href.includes('/search'), { timeout: 20000 })
            ]);
            console.log(`[CookieGenerator] ✓ Google search results loaded, URL: ${this.page.url()}`);
          } catch (navError) {
            console.warn(`[CookieGenerator] Google search navigation timeout after 20s`);
            console.warn(`[CookieGenerator] Current URL: ${this.page.url()}`);
            // Check if we're on results page by checking URL or page content
            const currentUrl = this.page.url();
            const hasResults = await this.page.$('#search').catch(() => null);
            if (currentUrl.includes('/search') || hasResults) {
              console.log(`[CookieGenerator] Actually on search results page, navigation completed`);
            } else {
              console.warn(`[CookieGenerator] ⚠️  Not on search results page - navigation likely failed`);
            }
          }
        } catch (typeError) {
          console.warn(`[CookieGenerator] Failed to type in Google search box:`, typeError.message);
          console.warn(`[CookieGenerator] Error stack:`, typeError.stack);
        }
      } else {
        console.warn(`[CookieGenerator] ⚠️  Could not find Google search box, skipping search`);
        // Debug: Log page structure
        try {
          const pageTitle = await this.page.title();
          console.log(`[CookieGenerator] Page title: "${pageTitle}"`);
          const inputs = await this.page.$$('input');
          console.log(`[CookieGenerator] Found ${inputs.length} input elements on page`);
        } catch (debugError) {
          console.warn(`[CookieGenerator] Debug logging failed:`, debugError.message);
        }
        return;
      }

      await this.sleep(this.randomBetween(waitTime[0], waitTime[1]));

      if (scroll) {
        await this.humanScroll();
      }

      // Click on a result occasionally (with timeout handling)
      try {
        await this.sleep(this.randomBetween(1000, 2000));
        const results = await this.page.$$('h3');
        if (results.length > 0 && Math.random() > 0.5) { // 50% chance to click
          const randomResult = results[Math.floor(Math.random() * Math.min(3, results.length))];
          await randomResult.click();
          try {
            await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
            await this.sleep(this.randomBetween(2000, 4000));
          } catch (clickNavError) {
            console.warn(`[CookieGenerator] Result click navigation timeout, continuing...`);
          }
        }
      } catch (clickError) {
        // Non-critical - just continue
      }

    } catch (error) {
      console.warn(`[CookieGenerator] Google search failed:`, error.message);
      // Continue - not critical if search fails
    }
  }

  /**
   * Browse YouTube with searches (LEGACY - use youtubeSearchAndWatch instead)
   * @deprecated Use youtubeSearchAndWatch for better cookie generation
   */
  async youtubeBrowse(options = {}) {
    const { searchQueries = [], watchVideo = false } = options;

    try {
      console.log('[CookieGenerator] Browsing YouTube...');
      
      // Visit YouTube with lenient timeout
      try {
        await this.page.goto('https://www.youtube.com', {
          waitUntil: 'domcontentloaded',
          timeout: 20000
        });
      } catch (error) {
        console.warn(`[CookieGenerator] YouTube homepage load slow, continuing...`);
      }

      await this.sleep(this.randomBetween(2000, 4000));
      await this.humanScroll();

      // Perform searches (only first query to save time - main goal is cookies, not deep browsing)
      const queriesToUse = searchQueries.slice(0, 1); // Just do one search
      for (const query of queriesToUse) {
        try {
          // Try multiple selectors for YouTube search box
          let searchBox = null;
          const selectors = [
            'input[name="search_query"]',
            'input[id="search"]',
            'input[placeholder*="Search"]',
            'input[aria-label*="Search"]'
          ];

          for (const selector of selectors) {
            try {
              searchBox = await this.page.$(selector);
              if (searchBox) break;
            } catch (e) {
              continue;
            }
          }
          
          if (searchBox) {
            try {
              await searchBox.click({ delay: this.randomBetween(50, 100) });
              await this.sleep(this.randomBetween(200, 500));
              
              // Type with human-like behavior (24 WPM, typos, corrections)
              console.log(`[CookieGenerator] Typing YouTube search character by character...`);
              await this.humanType(searchBox, query, {
                typoRate: 0.05,
                backspaceRate: 0.03,
                minCharDelay: 100,
                maxCharDelay: 250
              });
              
              await this.sleep(this.randomBetween(500, 1000));
              await searchBox.press('Enter');
              
              // Wait for navigation with lenient timeout
              try {
                await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
              } catch (navError) {
                console.warn(`[CookieGenerator] YouTube search navigation timeout, but continuing...`);
              }
              
              await this.sleep(this.randomBetween(2000, 4000));
              await this.humanScroll();
            } catch (searchError) {
              console.warn(`[CookieGenerator] YouTube search interaction failed:`, searchError.message);
            }
          } else {
            console.warn(`[CookieGenerator] Could not find YouTube search box, skipping search`);
          }

          // Optionally click on a video (but don't watch to save time)
          if (watchVideo && Math.random() > 0.7) { // 30% chance
            try {
              const videos = await this.page.$$('a#video-title');
              if (videos.length > 0) {
                const randomVideo = videos[Math.floor(Math.random() * Math.min(3, videos.length))];
                await randomVideo.click();
                try {
                  await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
                  await this.sleep(this.randomBetween(3000, 5000));
                  await this.page.goBack();
                  try {
                    await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
                  } catch (backNavError) {
                    // Continue even if back navigation times out
                  }
                } catch (videoNavError) {
                  console.warn(`[CookieGenerator] Video navigation timeout, continuing...`);
                }
              }
            } catch (videoClickError) {
              // Non-critical
            }
          }
        } catch (error) {
          console.warn(`[CookieGenerator] YouTube search "${query}" failed:`, error.message);
          // Continue with next query or finish
        }
      }

    } catch (error) {
      console.warn('[CookieGenerator] YouTube browsing failed:', error.message);
      // Continue - not critical if browsing fails
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

    // Sometimes scroll back up a bit
    if (Math.random() > 0.7) {
      await this.page.evaluate(() => {
        window.scrollBy(0, -200);
      });
      await this.sleep(this.randomBetween(500, 1000));
    }
  }

  /**
   * Random mouse movement simulation
   */
  async randomMouseMovement() {
    const moves = this.randomBetween(2, 4);
    for (let i = 0; i < moves; i++) {
      const x = this.randomBetween(100, 1800);
      const y = this.randomBetween(100, 900);
      await this.page.mouse.move(x, y, { steps: this.randomBetween(5, 15) });
      await this.sleep(this.randomBetween(200, 500));
    }
  }

  /**
   * Export cookies to Netscape format for yt-dlp
   */
  async exportCookies() {
    try {
      if (!this.page) {
        console.warn('[CookieGenerator] No page available for cookie export');
        return;
      }

      console.log('[CookieGenerator] Collecting cookies from browser...');
      const cookies = await this.page.cookies();
      console.log(`[CookieGenerator] Found ${cookies.length} total cookies in browser`);
      
      if (cookies.length === 0) {
        console.warn('[CookieGenerator] No cookies to export');
        return;
      }

      // Filter for YouTube cookies (most important)
      const youtubeCookies = cookies.filter(c => 
        c.domain.includes('youtube.com') || 
        c.domain.includes('.youtube.com') ||
        c.domain.includes('google.com') ||
        c.domain.includes('.google.com')
      );

      console.log(`[CookieGenerator] Filtered to ${youtubeCookies.length} YouTube/Google cookies`);
      
      // Log cookie details for debugging
      if (youtubeCookies.length > 0) {
        const cookieNames = youtubeCookies.map(c => c.name).join(', ');
        console.log(`[CookieGenerator] Cookie names: ${cookieNames}`);
        
        // Check for critical cookies
        const criticalCookies = ['VISITOR_INFO1_LIVE', 'YSC', 'CONSENT', 'PREF'];
        const presentCookies = youtubeCookies.filter(c => criticalCookies.includes(c.name));
        const missingCookies = criticalCookies.filter(name => !youtubeCookies.find(c => c.name === name));
        
        if (presentCookies.length > 0) {
          console.log(`[CookieGenerator] ✓ Critical cookies present: ${presentCookies.map(c => c.name).join(', ')}`);
        }
        if (missingCookies.length > 0) {
          console.log(`[CookieGenerator] ⚠️  Missing critical cookies: ${missingCookies.join(', ')}`);
        }
      }

      if (youtubeCookies.length === 0) {
        console.log('[CookieGenerator] No YouTube/Google cookies found yet (will keep trying)');
        // Log all domains we have cookies for
        const allDomains = [...new Set(cookies.map(c => c.domain))];
        console.log(`[CookieGenerator] Cookies from other domains: ${allDomains.slice(0, 5).join(', ')}`);
        return;
      }

      // Ensure directory exists
      const cookiesDir = path.dirname(this.cookiesPath);
      if (!fs.existsSync(cookiesDir)) {
        fs.mkdirSync(cookiesDir, { recursive: true });
      }

      // Convert to Netscape format (for yt-dlp)
      const netscapeFormat = this.convertToNetscapeFormat(youtubeCookies);
      
      // Write to cookies file
      fs.writeFileSync(this.cookiesPath, netscapeFormat);
      
      console.log(`[CookieGenerator] ✓ Exported ${youtubeCookies.length} YouTube/Google cookies to ${this.cookiesPath}`);
      console.log(`[CookieGenerator] Cookies will be used by yt-dlp for extraction`);

    } catch (error) {
      console.error('[CookieGenerator] Failed to export cookies:', error.message);
      console.error('[CookieGenerator] Error stack:', error.stack);
    }
  }

  /**
   * Convert cookies to Netscape format (yt-dlp compatible)
   */
  convertToNetscapeFormat(cookies) {
    const lines = [
      '# Netscape HTTP Cookie File',
      '# This file was generated by CookieGenerator service',
      '# Format: domain\tflag\tpath\tsecure\texpiration\tname\tvalue',
      ''
    ];

    let skippedCount = 0;
    for (const cookie of cookies) {
      const domain = cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`;
      const flag = 'TRUE';
      const path = cookie.path || '/';
      const secure = cookie.secure ? 'TRUE' : 'FALSE';
      
      // Handle expiration: yt-dlp doesn't like -1, use 0 for session cookies or valid timestamp
      let expiration;
      if (cookie.expires && cookie.expires > 0) {
        // Valid expiration timestamp (seconds since epoch)
        expiration = Math.floor(cookie.expires);
      } else {
        // Session cookie or invalid expiration - use 0 (never expires in Netscape format)
        expiration = 0;
      }
      
      const name = cookie.name;
      const value = cookie.value;

      // Skip if expiration would be invalid (negative but not -1)
      if (expiration < 0 && expiration !== -1) {
        console.warn(`[CookieGenerator] Skipping cookie ${name} with invalid expiration: ${cookie.expires}`);
        skippedCount++;
        continue;
      }

      lines.push(`${domain}\t${flag}\t${path}\t${secure}\t${expiration}\t${name}\t${value}`);
    }

    if (skippedCount > 0) {
      console.warn(`[CookieGenerator] Skipped ${skippedCount} cookies with invalid expiration values`);
    }

    return lines.join('\n');
  }

  /**
   * Schedule light browsing to maintain session
   * Strategic: Quick YouTube activity every 2-3 minutes keeps session alive
   */
  scheduleLightBrowsing() {
    // Every 2-3 minutes, do quick YouTube activity (homepage or search)
    setInterval(async () => {
      if (this.isRunning && this.page) {
        try {
          // Alternate between homepage visit and quick search
          if (Math.random() > 0.5) {
            // Option 1: Visit homepage and scroll feed
            await this.humanVisit('https://www.youtube.com', {
              waitTime: [2000, 3000],
              scroll: true,
              randomDelay: false
            });
          } else {
            // Option 2: Quick search (faster but still generates cookies)
            await this.youtubeSearchAndWatch('latest', {
              watchDuration: [3000, 5000], // Short watch (3-5s)
              scrollFeed: false
            });
          }
          
          // Export cookies after light browsing
          await this.exportCookies();
        } catch (error) {
          console.warn('[CookieGenerator] Light browsing failed:', error.message);
        }
      }
    }, this.randomBetween(2 * 60 * 1000, 3 * 60 * 1000)); // 2-3 minutes
  }

  /**
   * Restart browser instance - completely close old Chrome and start fresh
   * This happens every 12 hours OR when consecutive bot detections occur
   * 
   * Strategy: Instead of renewing within the same browser session,
   * we completely wipe the old instance and start fresh. This:
   * - Creates a new browser fingerprint
   * - Starts with clean cookies (builds reputation from scratch)
   * - Avoids patterns that might flag long-running sessions
   */
  async restartBrowserInstance() {
    if (!this.isRunning) return;

    try {
      console.log('[CookieGenerator] Restarting browser instance (12h renewal or bot detection)...');
      
      // Export cookies one last time before closing
      await this.exportCookies();
      
      // Clean up current browser
      await this.cleanupBrowser();
      
      // Clear the profile directory to start completely fresh
      // This ensures we don't carry over any reputation or fingerprint issues
      try {
        if (fs.existsSync(this.profileDir)) {
          console.log('[CookieGenerator] Cleaning old Chrome profile for fresh start...');
          fs.rmSync(this.profileDir, { recursive: true, force: true });
          // Recreate directory
          fs.mkdirSync(this.profileDir, { recursive: true });
          console.log('[CookieGenerator] ✓ Profile cleaned, starting fresh browser instance');
        }
      } catch (cleanupError) {
        console.warn('[CookieGenerator] Profile cleanup warning:', cleanupError.message);
        // Continue anyway - profile might be in use or already clean
      }
      
      // Record restart time (for cooldown tracking)
      this.lastRestartTime = Date.now();
      
      // Reset bot detection counter
      this.botDetectionFailures = 0;
      this.lastFailureTime = null;
      
      // Start fresh browser instance (don't await - run in background)
      this.start().catch(error => {
        console.error('[CookieGenerator] Error restarting browser instance:', error.message);
        // Try again after a delay if startup fails
        setTimeout(() => {
          this.restartBrowserInstance();
        }, 5 * 60 * 1000); // Retry after 5 minutes
      });
      
    } catch (error) {
      console.error('[CookieGenerator] Error restarting browser instance:', error.message);
      // Try again after a delay
      setTimeout(() => {
        this.restartBrowserInstance();
      }, 5 * 60 * 1000);
    }
  }

  /**
   * Clean up browser resources (without stopping the service)
   */
  async cleanupBrowser() {
    try {
      // Clear intervals/timeouts
      if (this.cookieUpdateInterval) {
        clearInterval(this.cookieUpdateInterval);
        this.cookieUpdateInterval = null;
      }
      if (this.restartTimeout12h) {
        clearTimeout(this.restartTimeout12h);
        this.restartTimeout12h = null;
      }
      if (this.restartTimeout24h) {
        clearTimeout(this.restartTimeout24h);
        this.restartTimeout24h = null;
      }

      // Close browser instance
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
      }
    } catch (error) {
      console.warn('[CookieGenerator] Error during browser cleanup:', error.message);
    }
  }

  /**
   * Stop the cookie generator
   */
  async stop() {
    if (!this.isRunning) return;

    console.log('[CookieGenerator] Stopping...');
    
    this.isRunning = false;
    
    // Clean up all timers and browser
    await this.cleanupBrowser();

    // Final cookie export
    await this.exportCookies();

    console.log('[CookieGenerator] Stopped');
  }

  /**
   * Human-like typing simulation
   * Types character by character at ~24 words per minute with typos and corrections
   * @param {ElementHandle} element - Element to type into
   * @param {string} text - Text to type
   * @param {Object} options - Typing options
   */
  async humanType(element, text, options = {}) {
    const {
      typoRate = 0.05, // 5% chance of typo per character
      backspaceRate = 0.03, // 3% chance of backspace after typo
      minCharDelay = 100, // Minimum delay between characters (ms)
      maxCharDelay = 250, // Maximum delay between characters (ms)
      // 24 WPM = 24 words * 5 chars/word / 60 seconds = 2 chars/second = 500ms per char average
      // But we want variation, so use 100-250ms range
    } = options;

    try {
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        let charToType = char;

        // Occasionally make a typo (replace with nearby key)
        if (Math.random() < typoRate && i > 0) {
          const typoChar = this.getTypoChar(char);
          if (typoChar) {
            charToType = typoChar;
            console.log(`[CookieGenerator] Typo: "${char}" → "${typoChar}" (will correct)`);
          }
        }

        // Type the character (or typo)
        await element.type(charToType, { delay: 0 }); // Use 0 delay, we'll add our own
        await this.sleep(this.randomBetween(minCharDelay, maxCharDelay));

        // If we made a typo, occasionally backspace and correct
        if (charToType !== char && Math.random() < backspaceRate) {
          // Wait a moment (human realizes mistake)
          await this.sleep(this.randomBetween(200, 500));
          
          // Backspace the typo
          await this.page.keyboard.press('Backspace');
          await this.sleep(this.randomBetween(100, 200));
          
          // Type correct character
          await element.type(char, { delay: 0 });
          await this.sleep(this.randomBetween(minCharDelay, maxCharDelay));
          console.log(`[CookieGenerator] Corrected typo: "${charToType}" → "${char}"`);
        }

        // Occasional pause mid-word (especially for longer words)
        if (char === ' ' && Math.random() < 0.1) {
          await this.sleep(this.randomBetween(300, 600));
        }
      }
    } catch (error) {
      console.warn('[CookieGenerator] Human typing error:', error.message);
      // Fallback: type normally
      await element.type(text, { delay: this.randomBetween(minCharDelay, maxCharDelay) });
    }
  }

  /**
   * Get a typo character (adjacent key on keyboard)
   * Simulates human typing errors
   */
  getTypoChar(char) {
    const keyboard = {
      'q': ['w', 'a'], 'w': ['q', 'e', 's'], 'e': ['w', 'r', 'd'], 'r': ['e', 't', 'f'],
      't': ['r', 'y', 'g'], 'y': ['t', 'u', 'h'], 'u': ['y', 'i', 'j'], 'i': ['u', 'o', 'k'],
      'o': ['i', 'p', 'l'], 'p': ['o', '['],
      'a': ['q', 's', 'z'], 's': ['a', 'd', 'w', 'x'], 'd': ['s', 'f', 'e', 'c'],
      'f': ['d', 'g', 'r', 'v'], 'g': ['f', 'h', 't', 'b'], 'h': ['g', 'j', 'y', 'n'],
      'j': ['h', 'k', 'u', 'm'], 'k': ['j', 'l', 'i'], 'l': ['k', 'o'],
      'z': ['a', 'x'], 'x': ['z', 'c', 's'], 'c': ['x', 'v', 'd'], 'v': ['c', 'b', 'f'],
      'b': ['v', 'n', 'g'], 'n': ['b', 'm', 'h'], 'm': ['n', 'j'],
    };

    const lowerChar = char.toLowerCase();
    if (keyboard[lowerChar]) {
      const possible = keyboard[lowerChar];
      const typo = possible[Math.floor(Math.random() * possible.length)];
      // Preserve case
      return char === lowerChar ? typo : typo.toUpperCase();
    }
    
    // For other characters, return null (no typo)
    return null;
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

export default CookieGenerator;

