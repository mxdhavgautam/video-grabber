/**
 * Browser Manager Service
 * 
 * Manages per-user browser instances, keeping them alive for video extraction.
 * 
 * Flow:
 * 1. After OAuth, browser is started and authenticated
 * 2. Browser stays alive for the user's session
 * 3. When extraction is requested, navigate to video URL in browser
 * 4. Extract fresh cookies from browser
 * 5. Use cookies with yt-dlp for extraction
 */

import UserBrowserService from './user-browser-service.mjs';

class BrowserManager {
  constructor() {
    // Map of userId -> { browserService, lastUsed, timeoutId }
    this.browserInstances = new Map();
    
    // Browser timeout: 5 minutes (5 * 60 * 1000 ms) - disconnect after 5 min inactivity
    this.browserTimeout = 5 * 60 * 1000;
    
    // Start cleanup interval to check for expired browsers
    this.startCleanupInterval();
  }
  
  /**
   * Start periodic cleanup to check for expired browser instances
   */
  startCleanupInterval() {
    // Check every 1 minute for expired browsers (more frequent since timeout is 5 min)
    setInterval(() => {
      this.cleanupExpiredBrowsers();
    }, 1 * 60 * 1000);
  }
  
  /**
   * Clean up browser instances that haven't been used in 5 minutes
   */
  async cleanupExpiredBrowsers() {
    const now = Date.now();
    const expiredUsers = [];
    
    for (const [userId, instanceData] of this.browserInstances.entries()) {
      if (now - instanceData.lastUsed > this.browserTimeout) {
        expiredUsers.push(userId);
      }
    }
    
    for (const userId of expiredUsers) {
      console.log(`[BrowserManager] Browser instance expired (5 min timeout) for user: ${userId}`);
      await this.stopBrowserForUser(userId);
    }
  }
  
  /**
   * Update last used timestamp for browser instance
   */
  updateLastUsed(userId) {
    const instanceData = this.browserInstances.get(userId);
    if (instanceData) {
      instanceData.lastUsed = Date.now();
      
      // Clear existing timeout and set new one
      if (instanceData.timeoutId) {
        clearTimeout(instanceData.timeoutId);
      }
      
      // Set timeout to stop browser after 5 minutes of inactivity
      instanceData.timeoutId = setTimeout(async () => {
        console.log(`[BrowserManager] Browser timeout reached for user: ${userId}`);
        await this.stopBrowserForUser(userId);
      }, this.browserTimeout);
    }
  }

  /**
   * Get or create browser instance for user
   * @param {string} userId - User ID
   * @param {string} cookiesDir - Cookies directory
   * @returns {UserBrowserService|null} - Browser service instance or null if not available
   */
  getBrowserInstance(userId, cookiesDir = null) {
    const instanceData = this.browserInstances.get(userId);
    if (instanceData && instanceData.browserService && instanceData.browserService.isRunning) {
      this.updateLastUsed(userId);
      return instanceData.browserService;
    }
    return null;
  }

  /**
   * Start and keep browser instance alive for user
   * @param {string} userId - User ID
   * @param {string} accessToken - OAuth access token
   * @param {string} refreshToken - OAuth refresh token
   * @param {Array} initialCookies - Initial cookies from OAuth
   * @param {string} cookiesDir - Cookies directory
   * @param {boolean} skipCookieGeneration - If true, skip browsing to generate cookies (go straight to video)
   * @returns {Promise<UserBrowserService>} - Browser service instance
   */
  async startBrowserForUser(userId, accessToken, refreshToken, initialCookies = [], cookiesDir = null, skipCookieGeneration = false) {
    // If browser already exists and is running, return it
    const existingData = this.browserInstances.get(userId);
    if (existingData && existingData.browserService && existingData.browserService.isRunning) {
      console.log(`[BrowserManager] Browser instance already exists for user: ${userId}`);
      this.updateLastUsed(userId);
      return existingData.browserService;
    }

    // Create new browser instance
    console.log(`[BrowserManager] Starting browser instance for user: ${userId}`);
    const browserService = new UserBrowserService(userId, cookiesDir, null);
    
    // Start and authenticate (skip cookie generation if we have a video URL to extract)
    await browserService.startAndAuthenticate(accessToken, refreshToken, initialCookies, skipCookieGeneration);
    
    // Keep browser alive with timeout tracking
    const now = Date.now();
    const timeoutId = setTimeout(async () => {
      console.log(`[BrowserManager] Browser timeout reached for user: ${userId}`);
      await this.stopBrowserForUser(userId);
    }, this.browserTimeout);
    
    this.browserInstances.set(userId, {
      browserService,
      lastUsed: now,
      timeoutId
    });
    
    console.log(`[BrowserManager] Browser instance started and kept alive for user: ${userId} (will timeout after 5 min inactivity)`);
    return browserService;
  }

  /**
   * Navigate to video URL in user's browser and extract fresh cookies
   * @param {string} userId - User ID
   * @param {string} videoUrl - YouTube video URL
   * @returns {Promise<Array>} - Fresh cookies from browser
   */
  async navigateToVideoAndExtractCookies(userId, videoUrl) {
    const instanceData = this.browserInstances.get(userId);
    const browserService = instanceData?.browserService;
    
    if (!browserService || !browserService.isRunning) {
      throw new Error(`No active browser instance for user: ${userId}`);
    }

    // Update last used timestamp
    this.updateLastUsed(userId);

    console.log(`[BrowserManager] Navigating to video URL in browser for user: ${userId}`);
    console.log(`[BrowserManager] Video URL: ${videoUrl}`);

    try {
      // Navigate to video URL
      console.log(`[BrowserManager] Navigating to video page...`);
      await browserService.page.goto(videoUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Handle any prompts (consent, ads, etc.)
      await browserService.handleYouTubePrompts();

      // Manually inject CONSENT cookie if missing (from old version approach)
      await browserService.injectConsentCookieIfMissing();

      // Wait for video player to load
      console.log(`[BrowserManager] Waiting for video player to initialize...`);
      try {
        await browserService.page.waitForSelector('#movie_player, ytd-player, #player', { timeout: 15000 });
        console.log(`[BrowserManager] ✓ Video player element found`);
      } catch (e) {
        console.warn(`[BrowserManager] Player element not found, continuing anyway...`);
      }

      // Wait for video to start playing
      console.log(`[BrowserManager] Waiting for video to start playing...`);
      await browserService.sleep(5000);

      // Check if video is playing
      const isPlaying = await browserService.page.evaluate(() => {
        const player = document.querySelector('#movie_player');
        if (player) {
          try {
            // Try to access player state via YouTube's player API
            if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args) {
              return true; // Player is loaded
            }
            // Check if video element exists and has src
            const video = player.querySelector('video');
            if (video && (video.readyState >= 2 || video.currentTime > 0)) {
              return true;
            }
          } catch (e) {
            // Ignore errors
          }
        }
        return false;
      });

      if (isPlaying) {
        console.log(`[BrowserManager] ✓ Video is playing`);
      } else {
        console.warn(`[BrowserManager] ⚠️ Video may not be playing yet, continuing anyway...`);
      }

      // Watch video for 10-15 seconds while monitoring cookies
      const watchDuration = browserService.randomBetween(10000, 15000);
      console.log(`[BrowserManager] Watching video for ${Math.round(watchDuration/1000)}s while monitoring cookies...`);
      
      const checkInterval = 2000; // Check cookies every 2 seconds
      const checks = Math.ceil(watchDuration / checkInterval);
      let cookiesDuringWatch = [];
      
      for (let i = 0; i < checks; i++) {
        await browserService.sleep(Math.min(checkInterval, watchDuration - (i * checkInterval)));
        
        // Check current cookies
        const currentCookies = await browserService.page.cookies();
        const youtubeCookies = currentCookies.filter(c => 
          c.domain.includes('youtube.com') || c.domain.includes('google.com')
        );
        
        // Log cookie status
        const criticalCookies = ['__Secure-3PSID', '__Secure-3PAPISID', 'LOGIN_INFO', 'VISITOR_INFO1_LIVE', 'CONSENT'];
        const found = criticalCookies.filter(name => youtubeCookies.some(c => c.name === name));
        const missing = criticalCookies.filter(name => !youtubeCookies.some(c => c.name === name));
        
        if (i === 0 || found.length > cookiesDuringWatch.length) {
          cookiesDuringWatch = found;
          console.log(`[BrowserManager] [${Math.round((i+1) * checkInterval / 1000)}s] Cookies found: ${found.join(', ') || 'none'}`);
          if (missing.length > 0) {
            console.log(`[BrowserManager] [${Math.round((i+1) * checkInterval / 1000)}s] Still missing: ${missing.join(', ')}`);
          }
        }
        
        // Handle any ads or prompts during watching
        await browserService.handleYouTubePrompts();
        
        // Scroll a bit to simulate watching
        if (i % 2 === 0) {
          await browserService.page.evaluate(() => {
            window.scrollBy(0, 200);
          });
        }
      }

      console.log(`[BrowserManager] ✓ Finished watching video, extracting final cookies...`);

      // Extract fresh cookies (don't save to file yet - will be saved in extraction endpoint)
      const cookies = await browserService.exportCookies(false);
      
      console.log(`[BrowserManager] Extracted ${cookies.length} fresh cookies from browser`);
      
      // Check for critical cookies
      const criticalCookies = ['__Secure-3PSID', '__Secure-3PAPISID', 'LOGIN_INFO', 'VISITOR_INFO1_LIVE'];
      const found = criticalCookies.filter(name => cookies.some(c => c.name === name));
      const missing = criticalCookies.filter(name => !cookies.some(c => c.name === name));
      
      if (found.length > 0) {
        console.log(`[BrowserManager] ✓ Found critical cookies: ${found.join(', ')}`);
      }
      if (missing.length > 0) {
        console.warn(`[BrowserManager] ⚠️ Still missing critical cookies: ${missing.join(', ')}`);
        console.warn(`[BrowserManager] Cookies may not be sufficient for extraction`);
      }
      
      return cookies;
    } catch (error) {
      console.error(`[BrowserManager] Error navigating to video:`, error.message);
      throw error;
    }
  }

  /**
   * Stop browser instance for user
   * @param {string} userId - User ID
   */
  async stopBrowserForUser(userId) {
    const instanceData = this.browserInstances.get(userId);
    
    if (instanceData) {
      // Clear timeout
      if (instanceData.timeoutId) {
        clearTimeout(instanceData.timeoutId);
      }
      
      console.log(`[BrowserManager] Stopping browser instance for user: ${userId}`);
      await instanceData.browserService.stop();
      this.browserInstances.delete(userId);
    }
  }

  /**
   * Stop all browser instances
   */
  async stopAllBrowsers() {
    console.log(`[BrowserManager] Stopping all browser instances...`);
    const promises = Array.from(this.browserInstances.keys()).map(userId => 
      this.stopBrowserForUser(userId).catch(err => {
        console.error(`[BrowserManager] Error stopping browser for user ${userId}:`, err.message);
      })
    );
    await Promise.all(promises);
  }

  /**
   * Check if user has active browser instance
   * @param {string} userId - User ID
   * @returns {boolean} - True if browser is active
   */
  hasActiveBrowser(userId) {
    const instanceData = this.browserInstances.get(userId);
    return instanceData && instanceData.browserService && instanceData.browserService.isRunning;
  }
  
  /**
   * Restart browser for user if it was closed due to timeout
   * Called when user returns to the site
   * @param {string} userId - User ID
   * @param {string} accessToken - OAuth access token
   * @param {string} refreshToken - OAuth refresh token
   * @param {Array} initialCookies - Initial cookies from OAuth
   * @param {string} cookiesDir - Cookies directory
   * @param {boolean} skipCookieGeneration - If true, skip browsing to generate cookies (go straight to video)
   * @returns {Promise<UserBrowserService>} - Browser service instance
   */
  async ensureBrowserForUser(userId, accessToken, refreshToken, initialCookies = [], cookiesDir = null, skipCookieGeneration = false) {
    const instanceData = this.browserInstances.get(userId);
    
    // If browser exists and is running, just update last used
    if (instanceData && instanceData.browserService && instanceData.browserService.isRunning) {
      this.updateLastUsed(userId);
      return instanceData.browserService;
    }
    
    // Browser doesn't exist or is not running, start a new one
    console.log(`[BrowserManager] Browser not active for user ${userId}, starting new instance...`);
    return await this.startBrowserForUser(userId, accessToken, refreshToken, initialCookies, cookiesDir, skipCookieGeneration);
  }
}

// Export singleton instance
let browserManagerInstance = null;

export function getBrowserManager() {
  if (!browserManagerInstance) {
    browserManagerInstance = new BrowserManager();
  }
  return browserManagerInstance;
}

export default BrowserManager;

