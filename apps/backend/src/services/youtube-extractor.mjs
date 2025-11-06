/**
 * YouTube Extractor Service (OAuth-based)
 * 
 * Extracts video information using yt-dlp with per-user cookies from OAuth sessions.
 * No browser automation - uses yt-dlp exclusively with Deno runtime support.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import FormatParser from './format-parser.mjs';

class YouTubeExtractor {
  constructor() {
    this.initialized = false;
    this.formatParser = new FormatParser();
  }

  async init() {
    if (this.initialized) return;
    console.log('[YouTubeExtractor] Initializing...');
    this.initialized = true;
  }

  /**
   * Extract video info using yt-dlp with user's cookies
   * @param {string} videoId - YouTube video ID
   * @param {string} cookieFilePath - Path to user's cookie file (Netscape format)
   * @returns {Promise<Object>} - Parsed video information
   */
  async extract(videoId, cookieFilePath = null) {
    try {
      await this.init();
      console.log(`[Extract] Starting extraction for video: ${videoId}`);

      // Use yt-dlp with user's cookies
      const videoInfo = await this.extractWithYtDlp(videoId, cookieFilePath);
      
      console.log('[Extract] ✓ Extraction successful');
      return videoInfo;
    } catch (error) {
      console.error('[Extract] Fatal error:', error.message);
      throw error;
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
      // Try chrome120 or chrome131 for better compatibility
      let impersonateTarget = 'chrome131'; // Latest Chrome version for best compatibility
      args.push('--impersonate', impersonateTarget);
      console.log(`[yt-dlp] Using curl_cffi with ${impersonateTarget} impersonation`);

      // Set user agent (must match impersonate target)
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
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

