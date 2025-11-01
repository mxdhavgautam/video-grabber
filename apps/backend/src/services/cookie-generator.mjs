/**
 * Cookie Generator Service
 * 
 * Runs a Chrome browser instance that performs human-like browsing
 * to generate legitimate cookies for YouTube extraction.
 * 
 * Strategy:
 * - Visit LinkedIn, GitHub, Google, YouTube
 * - Perform searches, scroll, interact naturally
 * - Export cookies periodically (every 10 minutes)
 * - Run continuously in background
 * 
 * The cookies from this "warm" browser session are more trusted by YouTube
 * than cold requests from yt-dlp alone.
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

class CookieGenerator {
  constructor(cookiesPath, profileDir) {
    this.cookiesPath = cookiesPath;
    this.profileDir = profileDir;
    this.browser = null;
    this.page = null;
    this.isRunning = false;
    this.cookieUpdateInterval = null;
    this.sessionDuration = 10 * 60 * 1000; // 10 minutes in milliseconds
  }

  /**
   * Initialize and start the cookie generation service
   */
  async start() {
    if (this.isRunning) {
      console.log('[CookieGenerator] Already running');
      return;
    }

    try {
      console.log('[CookieGenerator] Starting Chrome browser for human-like browsing...');
      
      // Ensure profile directory exists
      if (!fs.existsSync(this.profileDir)) {
        fs.mkdirSync(this.profileDir, { recursive: true });
      }

      // Launch Chrome with persistent profile
      this.browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        ],
        userDataDir: this.profileDir,
      });

      this.page = await this.browser.newPage();
      
      // Hide automation indicators
      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        delete navigator.__proto__.webdriver;
      });

      // Set realistic viewport
      await this.page.setViewport({ width: 1920, height: 1080 });

      this.isRunning = true;
      console.log('[CookieGenerator] Browser started successfully');

      // Start the browsing session
      await this.performBrowsingSession();

      // Set up periodic cookie export (every 5 minutes)
      this.cookieUpdateInterval = setInterval(async () => {
        await this.exportCookies();
      }, 5 * 60 * 1000); // 5 minutes

      // Schedule session renewal (restart browsing after 10 minutes)
      setTimeout(() => {
        this.renewSession();
      }, this.sessionDuration);

    } catch (error) {
      console.error('[CookieGenerator] Failed to start:', error.message);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Perform human-like browsing activities
   */
  async performBrowsingSession() {
    try {
      console.log('[CookieGenerator] Starting human-like browsing session...');

      // 1. Visit LinkedIn (social media activity) - quick visit, don't need to fully load
      await this.humanVisit('https://www.linkedin.com', {
        waitTime: [2000, 4000],
        scroll: true,
        randomDelay: false // Skip mouse movement for speed
      });

      // 2. Visit GitHub (developer activity)
      await this.humanVisit('https://github.com', {
        waitTime: [2000, 4000],
        scroll: true,
        randomDelay: false
      });

      // 3. Search on Google (web browsing activity) - simplified
      // Use a simple search that's likely to work
      await this.googleSearch('technology', {
        waitTime: [2000, 3000],
        scroll: true
      });

      // 4. Visit YouTube and search (video platform activity) - most important for cookies
      await this.youtubeBrowse({
        searchQueries: [
          'technology' // Just one simple search
        ],
        watchVideo: false, // Just search, don't watch (faster)
      });

      // 5. Export cookies after initial browsing
      await this.exportCookies();
      
      console.log('[CookieGenerator] Initial browsing session completed, cookies exported');

      // Continue light browsing periodically
      this.scheduleLightBrowsing();

    } catch (error) {
      console.error('[CookieGenerator] Error during browsing session:', error.message);
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
      console.log(`[CookieGenerator] Searching Google for: ${query}...`);
      
      // Visit Google with lenient timeout
      try {
        await this.page.goto('https://www.google.com', {
          waitUntil: 'domcontentloaded',
          timeout: 20000
        });
      } catch (error) {
        console.warn(`[CookieGenerator] Google homepage load slow, continuing...`);
      }

      await this.sleep(this.randomBetween(1000, 2000));

      // Try multiple selectors for search box
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
          await searchBox.type(query, { delay: this.randomBetween(50, 150) });
          await this.sleep(this.randomBetween(500, 1000));
          
          // Press Enter
          await searchBox.press('Enter');
          
          // Wait for navigation with lenient timeout
          try {
            await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
          } catch (navError) {
            console.warn(`[CookieGenerator] Google search navigation timeout, but continuing...`);
          }
        } catch (typeError) {
          console.warn(`[CookieGenerator] Failed to type in Google search box:`, typeError.message);
        }
      } else {
        console.warn(`[CookieGenerator] Could not find Google search box, skipping search`);
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
   * Browse YouTube with searches
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
              await searchBox.type(query, { delay: this.randomBetween(50, 150) });
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

      const cookies = await this.page.cookies();
      
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

      if (youtubeCookies.length === 0) {
        console.log('[CookieGenerator] No YouTube/Google cookies found yet (will keep trying)');
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

    for (const cookie of cookies) {
      const domain = cookie.domain.startsWith('.') ? cookie.domain : `.${cookie.domain}`;
      const flag = 'TRUE';
      const path = cookie.path || '/';
      const secure = cookie.secure ? 'TRUE' : 'FALSE';
      const expiration = cookie.expires ? Math.floor(cookie.expires) : 0;
      const name = cookie.name;
      const value = cookie.value;

      lines.push(`${domain}\t${flag}\t${path}\t${secure}\t${expiration}\t${name}\t${value}`);
    }

    return lines.join('\n');
  }

  /**
   * Schedule light browsing to maintain session
   */
  scheduleLightBrowsing() {
    // Every 2-3 minutes, do a quick YouTube visit
    setInterval(async () => {
      if (this.isRunning && this.page) {
        try {
          await this.humanVisit('https://www.youtube.com', {
            waitTime: [1000, 2000],
            scroll: true,
            randomDelay: false
          });
        } catch (error) {
          console.warn('[CookieGenerator] Light browsing failed:', error.message);
        }
      }
    }, this.randomBetween(2 * 60 * 1000, 3 * 60 * 1000)); // 2-3 minutes
  }

  /**
   * Renew the browsing session (restart after 10 minutes)
   */
  async renewSession() {
    if (!this.isRunning) return;

    try {
      console.log('[CookieGenerator] Renewing browsing session...');
      
      // Export cookies one last time
      await this.exportCookies();
      
      // Start a new browsing session (don't await - run in background)
      this.performBrowsingSession().catch(error => {
        console.error('[CookieGenerator] Error during session renewal:', error.message);
      });
      
      // Schedule next renewal
      setTimeout(() => {
        this.renewSession();
      }, this.sessionDuration);
    } catch (error) {
      console.error('[CookieGenerator] Error renewing session:', error.message);
    }
  }

  /**
   * Stop the cookie generator
   */
  async stop() {
    if (!this.isRunning) return;

    console.log('[CookieGenerator] Stopping...');
    
    this.isRunning = false;
    
    if (this.cookieUpdateInterval) {
      clearInterval(this.cookieUpdateInterval);
      this.cookieUpdateInterval = null;
    }

    // Final cookie export
    await this.exportCookies();

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }

    console.log('[CookieGenerator] Stopped');
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

