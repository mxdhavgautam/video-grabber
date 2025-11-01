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

      // 1. Visit LinkedIn (social media activity)
      await this.humanVisit('https://www.linkedin.com', {
        waitTime: [3000, 6000],
        scroll: true,
        randomDelay: true
      });

      // 2. Visit GitHub (developer activity)
      await this.humanVisit('https://github.com', {
        waitTime: [2000, 4000],
        scroll: true,
        randomDelay: true
      });

      // 3. Search on Google (web browsing activity)
      await this.googleSearch('latest technology news 2025', {
        waitTime: [3000, 5000],
        scroll: true
      });

      // 4. Visit YouTube and search (video platform activity)
      await this.youtubeBrowse({
        searchQueries: [
          'technology news',
          'programming tutorials',
          'latest updates'
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
      
      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

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
    }
  }

  /**
   * Perform Google search
   */
  async googleSearch(query, options = {}) {
    const { waitTime = [2000, 4000], scroll = false } = options;

    try {
      console.log(`[CookieGenerator] Searching Google for: ${query}...`);
      
      await this.page.goto('https://www.google.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      await this.sleep(this.randomBetween(1000, 2000));

      // Find and type in search box
      const searchBox = await this.page.$('input[name="q"]') || await this.page.$('textarea[name="q"]');
      if (searchBox) {
        await searchBox.type(query, { delay: this.randomBetween(50, 150) });
        await this.sleep(this.randomBetween(500, 1000));
        
        // Press Enter
        await searchBox.press('Enter');
        await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
      }

      await this.sleep(this.randomBetween(waitTime[0], waitTime[1]));

      if (scroll) {
        await this.humanScroll();
      }

      // Click on a result occasionally
      const results = await this.page.$$('h3');
      if (results.length > 0) {
        const randomResult = results[Math.floor(Math.random() * Math.min(3, results.length))];
        await randomResult.click();
        await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        await this.sleep(this.randomBetween(2000, 4000));
      }

    } catch (error) {
      console.warn(`[CookieGenerator] Google search failed:`, error.message);
    }
  }

  /**
   * Browse YouTube with searches
   */
  async youtubeBrowse(options = {}) {
    const { searchQueries = [], watchVideo = false } = options;

    try {
      console.log('[CookieGenerator] Browsing YouTube...');
      
      await this.page.goto('https://www.youtube.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      await this.sleep(this.randomBetween(2000, 4000));
      await this.humanScroll();

      // Perform searches
      for (const query of searchQueries) {
        try {
          // Find search box
          const searchBox = await this.page.$('input[name="search_query"]') || 
                           await this.page.$('#search');
          
          if (searchBox) {
            await searchBox.click();
            await this.sleep(this.randomBetween(200, 500));
            await searchBox.type(query, { delay: this.randomBetween(50, 150) });
            await this.sleep(this.randomBetween(500, 1000));
            await searchBox.press('Enter');
            
            await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
            await this.sleep(this.randomBetween(2000, 4000));
            await this.humanScroll();

            // Optionally click on a video (but don't watch to save time)
            if (watchVideo) {
              const videos = await this.page.$$('a#video-title');
              if (videos.length > 0) {
                const randomVideo = videos[Math.floor(Math.random() * Math.min(3, videos.length))];
                await randomVideo.click();
                await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
                await this.sleep(this.randomBetween(5000, 10000));
                await this.page.goBack();
                await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
              }
            }
          }
        } catch (error) {
          console.warn(`[CookieGenerator] YouTube search "${query}" failed:`, error.message);
        }
      }

    } catch (error) {
      console.warn('[CookieGenerator] YouTube browsing failed:', error.message);
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

