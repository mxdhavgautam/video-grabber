/**
 * YouTube Extractor Service (OAuth-based)
 * 
 * Extracts video information using browser interception (preferred) or yt-dlp with per-user cookies.
 * Browser interception intercepts network responses from Chrome to extract video data directly.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import FormatParser from './format-parser.mjs';

class YouTubeExtractor {
  constructor(browserManager = null) {
    this.initialized = false;
    this.formatParser = new FormatParser();
    this.browserManager = browserManager; // Reference to browser manager for interception
  }

  async init() {
    if (this.initialized) return;
    console.log('[YouTubeExtractor] Initializing...');
    this.initialized = true;
  }

  /**
   * Extract video info using browser interception (preferred) or yt-dlp with user's cookies
   * @param {string} videoId - YouTube video ID
   * @param {string} cookieFilePath - Path to user's cookie file (Netscape format)
   * @param {string} userId - User ID (optional, for browser interception)
   * @returns {Promise<Object>} - Parsed video information
   */
  async extract(videoId, cookieFilePath = null, userId = null) {
    try {
      await this.init();
      console.log(`[Extract] Starting extraction for video: ${videoId}`);

      // Try browser interception first if we have an active browser (like old version)
      if (userId && this.browserManager && this.browserManager.hasActiveBrowser(userId)) {
        console.log('[Extract] Attempting browser interception (extract from Chrome network responses)...');
        try {
          const videoInfo = await this.extractWithBrowserInterception(videoId, userId, cookieFilePath);
          console.log('[Extract] ✓ Browser interception succeeded - extracted from Chrome network responses!');
          return videoInfo;
        } catch (browserError) {
          console.warn('[Extract] Browser interception failed:', browserError.message);
          console.warn('[Extract] Falling back to yt-dlp extraction...');
          // Fall through to yt-dlp extraction
        }
      }

      // Fallback to yt-dlp with user's cookies
      const videoInfo = await this.extractWithYtDlp(videoId, cookieFilePath);
      
      console.log('[Extract] ✓ Extraction successful');
      return videoInfo;
    } catch (error) {
      console.error('[Extract] Fatal error:', error.message);
      throw error;
    }
  }

  /**
   * Extract video data by intercepting Chrome's network requests
   * This bypasses yt-dlp entirely by using the responses Chrome receives
   * Aligned with old version's approach - sync cookies from file first, then intercept
   * @param {string} videoId - YouTube video ID
   * @param {string} userId - User ID for browser access
   * @param {string} cookieFilePath - Path to cookie file (for syncing into browser)
   * @returns {Promise<Object>} - Parsed video information
   */
  async extractWithBrowserInterception(videoId, userId, cookieFilePath = null) {
    if (!this.browserManager || !this.browserManager.hasActiveBrowser(userId)) {
      throw new Error('Browser interception requires active browser instance');
    }

    const instanceData = this.browserManager.browserInstances.get(userId);
    const browserService = instanceData?.browserService;
    const page = browserService?.page;

    if (!page) {
      throw new Error('Browser page not available for interception');
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // CRITICAL: Load cookies from file into browser BEFORE attempting interception (like old version)
    // This ensures cookies are properly synced and have correct domain/path attributes
    if (cookieFilePath && fs.existsSync(cookieFilePath)) {
      try {
        console.log('[BrowserIntercept] Loading and syncing cookies from file into browser context...');
        const cookiesContent = fs.readFileSync(cookieFilePath, 'utf8');
        const cookieLines = cookiesContent.split('\n').filter(line => line.trim() && !line.startsWith('#'));
        
        let cookiesSet = 0;
        // Parse Netscape format cookies and set them in browser
        for (const line of cookieLines) {
          const parts = line.split('\t');
          if (parts.length >= 7) {
            const domain = parts[0].trim();
            const path = parts[2].trim();
            const secure = parts[3] === 'TRUE';
            const expiration = parseInt(parts[4], 10);
            const name = parts[5].trim();
            const value = parts.slice(6).join('\t').trim();
            
            // Skip __Host- cookies (they have strict requirements)
            if (name.startsWith('__Host-')) {
              continue;
            }
            
            // Only set YouTube/Google cookies
            if (domain && name && (domain.includes('youtube.com') || domain.includes('google.com'))) {
              try {
                let cookieDomain = domain;
                if (!cookieDomain.startsWith('.')) {
                  cookieDomain = `.${cookieDomain}`;
                }
                
                await page.setCookie({
                  name,
                  value,
                  domain: cookieDomain,
                  path: path || '/',
                  secure: secure || true,
                  httpOnly: false,
                  sameSite: 'None',
                  expires: expiration > 0 ? expiration : undefined
                });
                cookiesSet++;
              } catch (cookieSetError) {
                // Some cookies might fail to set - continue
              }
            }
          }
        }
        console.log(`[BrowserIntercept] ✓ Set ${cookiesSet} cookies in browser context`);
      } catch (fileError) {
        console.warn(`[BrowserIntercept] Failed to load cookies from file: ${fileError.message}`);
      }
    }

    return new Promise(async (resolve, reject) => {
      let playerResponse = null;
      let extractionTimeout = null;
      const timeout = 30000;

      // Intercept network responses to capture YouTube API calls
      const responseHandler = async (response) => {
        const url = response.url();
        const status = response.status();
        
        // Intercept YouTube player API response (contains video formats)
        if (url.includes('/youtubei/v1/player') || url.includes('/get_video_info')) {
          try {
            if (status >= 200 && status < 300) {
              const text = await response.text();
              if (text) {
                try {
                  const json = JSON.parse(text);
                  // Prioritize responses with streamingData
                  if (json.streamingData && (json.streamingData.formats || json.streamingData.adaptiveFormats)) {
                    playerResponse = json;
                    console.log('[BrowserIntercept] ✓ Captured YouTube player API response with streamingData');
                    console.log(`[BrowserIntercept] StreamingData has ${json.streamingData.formats?.length || 0} formats and ${json.streamingData.adaptiveFormats?.length || 0} adaptive formats`);
                  } else if (json.videoDetails || json.playabilityStatus) {
                    if (!playerResponse || !playerResponse.streamingData) {
                      playerResponse = json;
                      console.log('[BrowserIntercept] ✓ Captured YouTube player API response (no streamingData yet)');
                    }
                  }
                } catch (e) {
                  if (text.includes('player_response') || text.includes('adaptiveFormats')) {
                    playerResponse = text;
                    console.log('[BrowserIntercept] ✓ Captured YouTube player API response (text format)');
                  }
                }
              }
            }
          } catch (error) {
            console.warn(`[BrowserIntercept] Error reading response ${url}:`, error.message);
          }
        }
      };

      // Set timeout
      extractionTimeout = setTimeout(() => {
        page.off('response', responseHandler);
        reject(new Error('Browser interception timeout - video data not captured'));
      }, timeout);

      // Listen for responses BEFORE navigating/refreshing
      page.on('response', responseHandler);

      try {
        // Verify we're on the video page (should already be there from navigateToVideoAndExtractCookies)
        const currentPageUrl = page.url();
        const isOnVideo = currentPageUrl.includes(`youtube.com/watch`) && currentPageUrl.includes(videoId);
        
        if (isOnVideo) {
          // Refresh page to trigger new API calls with synced cookies
          console.log('[BrowserIntercept] Refreshing video page to trigger API calls with synced cookies...');
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        } else {
          // Navigate to video if not already there
          console.log(`[BrowserIntercept] Navigating to video: ${videoUrl}`);
          await page.goto(videoUrl, { 
            waitUntil: 'domcontentloaded', 
            timeout: 30000,
            referer: 'https://www.youtube.com/'
          });
        }

        // Wait for YouTube player to initialize
        console.log('[BrowserIntercept] Waiting for YouTube player to initialize...');
        try {
          await page.waitForSelector('#movie_player, ytd-player, #player', { timeout: 15000 }).catch(() => {});
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
          // Continue anyway
        }

        // Extract from page JavaScript
        console.log('[BrowserIntercept] Attempting to extract video data from page JavaScript...');
        const pageData = await page.evaluate(() => {
          let playerResponse = null;
          
          if (window.ytInitialPlayerResponse) {
            playerResponse = window.ytInitialPlayerResponse;
          } else if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args && window.ytplayer.config.args.player_response) {
            try {
              playerResponse = typeof window.ytplayer.config.args.player_response === 'string' 
                ? JSON.parse(window.ytplayer.config.args.player_response) 
                : window.ytplayer.config.args.player_response;
            } catch (e) {
              playerResponse = window.ytplayer.config.args.player_response;
            }
          }
          
          return {
            playerResponse,
            title: document.title,
            videoId: new URL(window.location.href).searchParams.get('v')
          };
        });

        // Wait for network responses (YouTube makes API call after page loads)
        console.log('[BrowserIntercept] Waiting 8s for YouTube player API response...');
        await new Promise(resolve => setTimeout(resolve, 8000));

        // Clear timeout and remove handler
        if (extractionTimeout) clearTimeout(extractionTimeout);
        page.off('response', responseHandler);

        // Prioritize intercepted API response over page JavaScript
        let finalPlayerResponse = null;
        
        if (playerResponse && playerResponse.streamingData) {
          finalPlayerResponse = playerResponse;
          console.log('[BrowserIntercept] Using intercepted API response (has streamingData)');
        } else if (pageData.playerResponse && pageData.playerResponse.streamingData) {
          finalPlayerResponse = pageData.playerResponse;
          console.log('[BrowserIntercept] Using page JavaScript response (has streamingData)');
        } else if (playerResponse) {
          finalPlayerResponse = playerResponse;
          console.warn('[BrowserIntercept] Using intercepted response (no streamingData)');
        } else if (pageData.playerResponse) {
          finalPlayerResponse = pageData.playerResponse;
          console.warn('[BrowserIntercept] Using page JavaScript response (no streamingData)');
        }

        if (!finalPlayerResponse) {
          reject(new Error('Could not extract video data from browser - player response not found'));
          return;
        }

        // Check playability status
        if (finalPlayerResponse.playabilityStatus && finalPlayerResponse.playabilityStatus.status !== 'OK') {
          const reason = finalPlayerResponse.playabilityStatus.reason || 'Unknown reason';
          reject(new Error(`Video not playable: ${finalPlayerResponse.playabilityStatus.status} - ${reason}`));
          return;
        }

        // Convert to yt-dlp compatible format
        const videoInfo = this.convertPlayerResponseToYtDlpFormat(finalPlayerResponse, videoId, pageData.title);
        console.log('[BrowserIntercept] ✓ Successfully extracted video data from Chrome network responses');
        resolve(videoInfo);

      } catch (error) {
        page.off('response', responseHandler);
        if (extractionTimeout) clearTimeout(extractionTimeout);
        reject(new Error(`Browser interception failed: ${error.message}`));
      }
    });
  }

  /**
   * Convert YouTube player response to yt-dlp compatible JSON format
   */
  convertPlayerResponseToYtDlpFormat(playerResponse, videoId, title) {
    const videoDetails = playerResponse.videoDetails || {};
    const streamingData = playerResponse.streamingData || {};
    const formats = streamingData.formats || [];
    const adaptiveFormats = streamingData.adaptiveFormats || [];
    
    // Combine formats and adaptiveFormats
    const allFormats = [...formats, ...adaptiveFormats];
    
    console.log(`[BrowserIntercept] Converting ${allFormats.length} formats from player response`);
    
    // Parse formats to yt-dlp format
    const ytDlpFormats = allFormats
      .filter((format) => format.itag && format.itag > 0)
      .map((format) => {
        const formatId = format.itag;
        
        // Extract URL
        let url = format.url || '';
        if (!url && format.signatureCipher) {
          try {
            const params = new URLSearchParams(format.signatureCipher);
            url = params.get('url') || '';
          } catch (e) {
            console.warn(`[BrowserIntercept] Failed to parse signatureCipher for itag ${formatId}`);
          }
        }
        
        const mimeType = format.mimeType || '';
        const quality = format.quality || format.qualityLabel || '';
        
        // Parse codec from mimeType
        let vcodec = 'none';
        let acodec = 'none';
        if (mimeType) {
          const codecsMatch = mimeType.match(/codecs="([^"]+)"/);
          if (codecsMatch) {
            const codecs = codecsMatch[1].split(',').map(c => c.trim());
            vcodec = codecs.find(c => c.startsWith('vp') || c.startsWith('avc') || c.startsWith('hev')) || 'none';
            acodec = codecs.find(c => c.startsWith('opus') || c.startsWith('mp4a') || c.startsWith('vorbis')) || 'none';
          }
        }
        
        const hasVideo = mimeType.includes('video') || (format.width > 0 && format.height > 0);
        const hasAudio = mimeType.includes('audio') || acodec !== 'none';
        
        let ext = 'unknown';
        if (mimeType.includes('mp4')) ext = 'mp4';
        else if (mimeType.includes('webm')) ext = 'webm';
        else if (mimeType.includes('3gpp')) ext = '3gp';
        
        let formatNote = '';
        if (!hasVideo && hasAudio) {
          const audioBitrateKbps = format.audioBitrate > 0 ? Math.round(format.audioBitrate / 1000) : (format.bitrate > 0 ? Math.round(format.bitrate / 1000) : 0);
          formatNote = audioBitrateKbps > 0 ? `audio only - ${audioBitrateKbps}kbps` : 'audio only';
        } else if (hasVideo) {
          formatNote = quality || (format.height > 0 ? `${format.height}p${format.fps > 0 ? `@${format.fps}fps` : ''}` : 'unknown');
        }
        
        return {
          format_id: String(formatId),
          url: url,
          ext: ext,
          width: format.width || 0,
          height: format.height || 0,
          fps: format.fps || 0,
          tbr: format.bitrate > 0 ? format.bitrate / 1000 : 0,
          abr: format.audioBitrate > 0 ? format.audioBitrate / 1000 : 0,
          vcodec: vcodec,
          acodec: acodec,
          video_codec: vcodec,
          audio_codec: acodec,
          filesize: format.contentLength || 0,
          format_note: formatNote,
          protocol: url.startsWith('https') ? 'https' : 'https',
          hasVideo: hasVideo,
          hasAudio: hasAudio
        };
      });
    
    // Build yt-dlp compatible response
    const result = {
      id: videoId,
      title: title || videoDetails.title || 'Unknown',
      duration: parseInt(videoDetails.lengthSeconds) || 0,
      description: videoDetails.shortDescription || '',
      uploader: videoDetails.author || 'Unknown',
      uploader_id: videoDetails.channelId || '',
      upload_date: videoDetails.publishDate || '',
      view_count: parseInt(videoDetails.viewCount) || 0,
      formats: ytDlpFormats,
      thumbnail: videoDetails.thumbnail?.thumbnails?.[0]?.url || '',
      webpage_url: `https://www.youtube.com/watch?v=${videoId}`,
      _extractor: 'browser-interception',
      _extractor_key: 'youtube'
    };
    
    // Parse with format parser for consistency
    try {
      return this.formatParser.parse(result);
    } catch (parseError) {
      console.warn('[BrowserIntercept] Format parser error, returning raw result:', parseError.message);
      return result;
    }
  }

  /**
   * Extract video info using yt-dlp
   * @param {string} videoId - YouTube video ID
   * @param {string} cookieFilePath - Path to cookie file (optional)
   * @returns {Promise<Object>} - Parsed video information
   */
  async extractWithYtDlp(videoId, cookieFilePath = null) {
    return new Promise(async (resolve, reject) => {
      const args = [
        '--dump-json',
        '--no-warnings',
        '--no-check-certificates',
        '--prefer-insecure'
      ];

      // Add Deno runtime for EJS (required for latest yt-dlp with external n/sig solver)
      const denoAvailable = await this.checkDenoAvailable();
      if (denoAvailable) {
        args.push('--js-runtime', 'deno');
        console.log('[yt-dlp] Using Deno for JavaScript runtime');
      } else {
        console.warn('[yt-dlp] Deno not available, attempting without JS runtime');
      }

      // Add user's cookies if provided
      if (cookieFilePath && fs.existsSync(cookieFilePath)) {
        args.push('--cookies', cookieFilePath);
        console.log('[yt-dlp] Using user cookies from:', cookieFilePath);
      } else {
        console.warn('[yt-dlp] No cookies file provided - extraction may fail due to bot detection');
      }

      // Use mweb client with cookies (best format support)
      // If no cookies, fallback to android client
      const clientType = cookieFilePath && fs.existsSync(cookieFilePath) ? 'mweb' : 'android';
      args.push('--extractor-args', `youtube:player_client=${clientType}`);
      console.log(`[yt-dlp] Using ${clientType.toUpperCase()} client`);

      // Configure PO Token Provider (if available)
      const poProviderUrl = process.env.PO_TOKEN_PROVIDER_URL;
      if (poProviderUrl) {
        args.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${poProviderUrl}`);
        console.log(`[yt-dlp] Using PO Token Provider at: ${poProviderUrl}`);
      }

      // Use curl_cffi impersonation to mimic real browser (latest technique)
      // Try multiple Chrome versions with fallback
      // Common available targets: chrome, chrome120, chrome119, chrome118, chrome117
      // Use 'chrome' as default (most compatible) and let yt-dlp handle version selection
      let impersonateTarget = 'chrome'; // Use generic 'chrome' for best compatibility
      args.push('--impersonate', impersonateTarget);
      console.log(`[yt-dlp] Using curl_cffi with ${impersonateTarget} impersonation`);

      // Set user agent (must match impersonate target)
      // Use a generic Chrome user agent that matches the 'chrome' impersonation target
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      args.push('--user-agent', userAgent);

      // Add headers to mimic real browser requests
      args.push('--add-header', 'Referer:https://www.youtube.com/');
      args.push('--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7');
      args.push('--add-header', 'Accept-Language:en-US,en;q=0.9');
      args.push('--add-header', 'Accept-Encoding:gzip, deflate, br, zstd');
      args.push('--add-header', 'DNT:1');
      args.push('--add-header', 'Connection:keep-alive');
      args.push('--add-header', 'Upgrade-Insecure-Requests:1');
      args.push('--add-header', 'Sec-Fetch-Dest:document');
      args.push('--add-header', 'Sec-Fetch-Mode:navigate');
      args.push('--add-header', 'Sec-Fetch-Site:none');
      args.push('--add-header', 'Sec-Fetch-User:?1');
      args.push('--add-header', 'Sec-Ch-Ua:"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"');
      args.push('--add-header', 'Sec-Ch-Ua-Mobile:?0');
      args.push('--add-header', 'Sec-Ch-Ua-Platform:"Windows"');

      // Add random delays to mimic human behavior (longer delays for better stealth)
      args.push('--sleep-interval', '3');
      args.push('--max-sleep-interval', '8');
      
      // Add retry logic for bot detection
      args.push('--retries', '3');
      args.push('--fragment-retries', '3');

      // Add video URL
      args.push(`https://www.youtube.com/watch?v=${videoId}`);

      console.log('[yt-dlp] Running extraction...');

      const ytdlp = spawn('yt-dlp', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PATH: process.env.PATH }
      });
      
      let output = '';
      let errorOutput = '';

      ytdlp.stdout.on('data', (data) => {
        output += data.toString();
      });

      ytdlp.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ytdlp.on('close', (code) => {
        if (code === 0) {
          try {
            const rawVideoInfo = JSON.parse(output);
            console.log('[yt-dlp] Successfully extracted video info');
            console.log(`[yt-dlp] Formats array length: ${Array.isArray(rawVideoInfo.formats) ? rawVideoInfo.formats.length : 'N/A'}`);
            
            // Parse and enhance format information
            try {
              const parsedVideoInfo = this.formatParser.parse(rawVideoInfo);
              console.log(`[yt-dlp] Parsed ${parsedVideoInfo.metadata.format_count} formats`);
              console.log(`[yt-dlp] Max resolution: ${parsedVideoInfo.metadata.max_resolution?.resolution || 'unknown'}`);
              
              resolve(parsedVideoInfo);
            } catch (parseError) {
              console.error('[yt-dlp] Format parser error:', parseError.message);
              // Fallback: return raw video info if parser fails
              console.warn('[yt-dlp] Returning raw video info as fallback');
              resolve(rawVideoInfo);
            }
          } catch (e) {
            console.error('[yt-dlp] JSON parse error:', e.message);
            console.error('[yt-dlp] Output preview (first 500 chars):', output.substring(0, 500));
            reject(new Error(`Failed to parse yt-dlp output: ${e.message}`));
          }
        } else {
          console.error('[yt-dlp] Failed with code:', code);
          const fullError = errorOutput.length > 0 ? errorOutput : output;
          const errorPreview = fullError.length > 2000 ? fullError.substring(0, 2000) : fullError;
          console.error('[yt-dlp] Error output:', errorPreview);
          
          reject(new Error(`yt-dlp failed: ${fullError.substring(0, 500)}`));
        }
      });

      ytdlp.on('error', (error) => {
        reject(new Error(`Failed to spawn yt-dlp: ${error.message}`));
      });
    });
  }

  /**
   * Check if Deno is available
   */
  async checkDenoAvailable() {
    return new Promise(async (resolve) => {
      try {
        const { execSync } = await import('child_process');
        execSync('which deno', { stdio: 'pipe', timeout: 5000 });
        execSync('deno --version', { stdio: 'pipe', timeout: 5000 });
        resolve(true);
      } catch (error) {
        resolve(false);
      }
    });
  }

  async cleanup() {
    this.initialized = false;
  }
}

export default YouTubeExtractor;

