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
    this.restartTimeout12h = null;
    this.restartTimeout24h = null;
    this.sessionDuration12h = 12 * 60 * 60 * 1000; // 12 hours in milliseconds
    this.sessionDuration24h = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
    this.botDetectionFailures = 0; // Track consecutive bot detection failures
    this.maxConsecutiveFailures = 3; // Restart after 3 consecutive failures (even with fresh cookies)
    this.lastFailureTime = null;
    this.restartCooldown = 30 * 60 * 1000; // Don't restart more than once every 30 minutes
    this.lastRestartTime = null;
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

      await this.sleep(this.randomBetween(2000, 4000));

      // Step 2: Perform a search and watch a video (generates VISITOR_INFO1_LIVE)
      const searchQueries = [
        'technology',
        'programming tutorials',
        'latest tech news'
      ];
      
      // Do 2-3 searches with video watching
      for (let i = 0; i < Math.min(2, searchQueries.length); i++) {
        const query = searchQueries[i];
        console.log(`[CookieGenerator] YouTube search ${i + 1}: "${query}"`);
        
        await this.youtubeSearchAndWatch(query, {
          watchDuration: [8000, 12000], // Watch for 8-12 seconds (enough for cookies)
          scrollFeed: i === 0 // Scroll feed on first search
        });
        
        // Export cookies after watching (capture session cookies)
        if (i === 0 || Math.random() > 0.5) {
          await this.exportCookies();
        }
        
        // Wait between searches
        if (i < searchQueries.length - 1) {
          await this.sleep(this.randomBetween(3000, 5000));
        }
      }

      console.log('[CookieGenerator] ✓ YouTube session warmup completed');

    } catch (error) {
      console.warn('[CookieGenerator] YouTube session warmup error:', error.message);
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
      const currentUrl = this.page.url();
      if (!currentUrl.includes('youtube.com')) {
        await this.humanVisit('https://www.youtube.com', {
          waitTime: [2000, 3000],
          scroll: scrollFeed,
          randomDelay: false
        });
      }

      // Find and use search box
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

      if (!searchBox) {
        console.warn('[CookieGenerator] Could not find YouTube search box');
        return;
      }

      // Perform search
      await searchBox.click({ delay: this.randomBetween(50, 100) });
      await this.sleep(this.randomBetween(200, 500));
      
      // Clear any existing text
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('a');
      await this.page.keyboard.up('Control');
      await this.sleep(this.randomBetween(100, 200));
      
      await searchBox.type(query, { delay: this.randomBetween(50, 150) });
      await this.sleep(this.randomBetween(500, 1000));
      await searchBox.press('Enter');

      // Wait for search results
      try {
        await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (navError) {
        console.warn('[CookieGenerator] Search navigation timeout, continuing...');
      }

      await this.sleep(this.randomBetween(2000, 3000));
      await this.humanScroll(); // Scroll search results

      // CRITICAL: Click on a video and watch it (generates session cookies)
      try {
        const videoSelectors = [
          'a#video-title',
          'a#video-title-link',
          'ytd-video-renderer a',
          'a[href*="/watch"]'
        ];

        let videoLink = null;
        for (const selector of videoSelectors) {
          try {
            const links = await this.page.$$(selector);
            if (links.length > 0) {
              // Pick a video from top 5 results (most relevant)
              const index = Math.min(Math.floor(Math.random() * 5), links.length - 1);
              videoLink = links[index];
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (videoLink) {
          console.log('[CookieGenerator] Watching video to generate session cookies...');
          await videoLink.click();
          
          try {
            await this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
            
            // Watch video for specified duration (critical for cookie generation)
            const watchTime = this.randomBetween(watchDuration[0], watchDuration[1]);
            console.log(`[CookieGenerator] Watching video for ${Math.round(watchTime / 1000)}s...`);
            
            // Scroll a bit while watching (human-like behavior)
            await this.sleep(watchTime / 2);
            await this.humanScroll();
            await this.sleep(watchTime / 2);
            
            // Sometimes interact (scroll, move mouse) while watching
            await this.randomMouseMovement();
            
            console.log('[CookieGenerator] ✓ Video watched, session cookies generated');
          } catch (videoNavError) {
            console.warn('[CookieGenerator] Video navigation timeout, but may still have cookies');
          }
        } else {
          console.warn('[CookieGenerator] Could not find video link in search results');
        }
      } catch (watchError) {
        console.warn('[CookieGenerator] Error watching video:', watchError.message);
      }

    } catch (error) {
      console.warn(`[CookieGenerator] YouTube search and watch failed:`, error.message);
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

