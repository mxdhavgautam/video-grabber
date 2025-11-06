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
    
    // Browser timeout: 40 minutes (40 * 60 * 1000 ms)
    this.browserTimeout = 40 * 60 * 1000;
    
    // Start cleanup interval to check for expired browsers
    this.startCleanupInterval();
  }
  
  /**
   * Start periodic cleanup to check for expired browser instances
   */
  startCleanupInterval() {
    // Check every 5 minutes for expired browsers
    setInterval(() => {
      this.cleanupExpiredBrowsers();
    }, 5 * 60 * 1000);
  }
  
  /**
   * Clean up browser instances that haven't been used in 40 minutes
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
      console.log(`[BrowserManager] Browser instance expired (40 min timeout) for user: ${userId}`);
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
      
      // Set timeout to stop browser after 40 minutes of inactivity
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
   * @returns {Promise<UserBrowserService>} - Browser service instance
   */
  async startBrowserForUser(userId, accessToken, refreshToken, initialCookies = [], cookiesDir = null) {
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
    
    // Start and authenticate
    await browserService.startAndAuthenticate(accessToken, refreshToken, initialCookies);
    
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
    
    console.log(`[BrowserManager] Browser instance started and kept alive for user: ${userId} (will timeout after 40 min inactivity)`);
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
      await browserService.page.goto(videoUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Wait a bit for cookies to be set
      await browserService.sleep(3000);

      // Extract fresh cookies (don't save to file yet - will be saved in extraction endpoint)
      const cookies = await browserService.exportCookies(false);
      
      console.log(`[BrowserManager] Extracted ${cookies.length} fresh cookies from browser`);
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
   * @returns {Promise<UserBrowserService>} - Browser service instance
   */
  async ensureBrowserForUser(userId, accessToken, refreshToken, initialCookies = [], cookiesDir = null) {
    const instanceData = this.browserInstances.get(userId);
    
    // If browser exists and is running, just update last used
    if (instanceData && instanceData.browserService && instanceData.browserService.isRunning) {
      this.updateLastUsed(userId);
      return instanceData.browserService;
    }
    
    // Browser doesn't exist or is not running, start a new one
    console.log(`[BrowserManager] Browser not active for user ${userId}, starting new instance...`);
    return await this.startBrowserForUser(userId, accessToken, refreshToken, initialCookies, cookiesDir);
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

