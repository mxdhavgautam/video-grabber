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
    // Map of userId -> UserBrowserService instance
    this.browserInstances = new Map();
  }

  /**
   * Get or create browser instance for user
   * @param {string} userId - User ID
   * @param {string} cookiesDir - Cookies directory
   * @returns {UserBrowserService|null} - Browser service instance or null if not available
   */
  getBrowserInstance(userId, cookiesDir = null) {
    return this.browserInstances.get(userId) || null;
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
    // If browser already exists, return it
    const existing = this.browserInstances.get(userId);
    if (existing && existing.isRunning) {
      console.log(`[BrowserManager] Browser instance already exists for user: ${userId}`);
      return existing;
    }

    // Create new browser instance
    console.log(`[BrowserManager] Starting browser instance for user: ${userId}`);
    const browserService = new UserBrowserService(userId, cookiesDir, null);
    
    // Start and authenticate
    await browserService.startAndAuthenticate(accessToken, refreshToken, initialCookies);
    
    // Keep browser alive (don't call stop())
    this.browserInstances.set(userId, browserService);
    
    console.log(`[BrowserManager] Browser instance started and kept alive for user: ${userId}`);
    return browserService;
  }

  /**
   * Navigate to video URL in user's browser and extract fresh cookies
   * @param {string} userId - User ID
   * @param {string} videoUrl - YouTube video URL
   * @returns {Promise<Array>} - Fresh cookies from browser
   */
  async navigateToVideoAndExtractCookies(userId, videoUrl) {
    const browserService = this.browserInstances.get(userId);
    
    if (!browserService || !browserService.isRunning) {
      throw new Error(`No active browser instance for user: ${userId}`);
    }

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
    const browserService = this.browserInstances.get(userId);
    
    if (browserService) {
      console.log(`[BrowserManager] Stopping browser instance for user: ${userId}`);
      await browserService.stop();
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
    const browserService = this.browserInstances.get(userId);
    return browserService && browserService.isRunning;
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

