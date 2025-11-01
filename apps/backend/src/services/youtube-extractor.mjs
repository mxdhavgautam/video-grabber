import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class YouTubeExtractor {
  constructor() {
    this.cookiesPath = process.env.COOKIES_FILE || path.join(process.cwd(), 'runtime', 'yt-dlp', 'cookies.txt');
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    console.log('[YouTubeExtractor] Initializing...');
    this.initialized = true;
  }

  async extractWithYtDlp(videoId) {
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
        args.push('--extractor-args', 'youtube:ejs_runtime=deno');
        console.log('[yt-dlp] Using Deno for EJS runtime');
      } else {
        console.warn('[yt-dlp] Deno not available, attempting without EJS runtime');
      }

      // Add cookies if available (critical for bypassing bot detection)
      if (fs.existsSync(this.cookiesPath)) {
        args.push('--cookies', this.cookiesPath);
        console.log('[yt-dlp] Using cookies from:', this.cookiesPath);
      } else {
        console.warn('[yt-dlp] No cookies file found - extraction may fail due to bot detection');
        console.warn('[yt-dlp] To fix: Upload cookies via the UI or place cookies.txt at:', this.cookiesPath);
        console.warn('[yt-dlp] Cookies are essential for bypassing YouTube bot detection');
      }

      // Build extractor args for YouTube client and PO token
      const extractorArgs = [];
      
      // Strategy: Try clients that DON'T require PO tokens first
      // TV client doesn't require PO tokens and works without cookies
      // ANDROID client also has better success rate without auth
      // Only use mweb if we have cookies (mweb needs PO token with cookies)
      if (fs.existsSync(this.cookiesPath)) {
        // If we have cookies, use mweb (but needs PO token)
        extractorArgs.push('youtube:player_client=mweb');
      } else {
        // No cookies: Use TV or ANDROID clients (no PO token required)
        // TV client has best success rate for unauthenticated access
        extractorArgs.push('youtube:player_client=tv');
        console.log('[yt-dlp] Using TV client - no PO token or cookies required');
      }
      
      // Only configure PO Token Provider if using mweb client (which requires it with cookies)
      // TV and ANDROID clients don't need PO tokens - they work without authentication
      if (fs.existsSync(this.cookiesPath)) {
        const poProviderUrl = process.env.PO_TOKEN_PROVIDER_URL || 'http://po-token-provider:4416';
        extractorArgs.push(`youtubepot-bgutilhttp:base_url=${poProviderUrl}`);
        console.log(`[yt-dlp] Using PO Token Provider at: ${poProviderUrl}`);
      } else {
        console.log('[yt-dlp] No cookies - skipping PO token provider (TV/ANDROID clients don\'t need it)');
      }

      if (extractorArgs.length > 0) {
        args.push('--extractor-args', extractorArgs.join(';'));
      }

      // curl_cffi is automatically used by yt-dlp when installed (via [curl_cffi] extra)
      // No command-line option needed - it mimics real browser TLS fingerprints
      console.log('[yt-dlp] curl_cffi will be used automatically for TLS fingerprint impersonation');

      // Add user agent (use latest Chrome version)
      args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

      // Add referer header
      args.push('--add-header', 'Referer:https://www.youtube.com/');
      
      // Add additional headers to mimic real browser
      args.push('--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8');
      args.push('--add-header', 'Accept-Language:en-US,en;q=0.9');
      args.push('--add-header', 'Accept-Encoding:gzip, deflate, br');
      args.push('--add-header', 'DNT:1');
      args.push('--add-header', 'Connection:keep-alive');
      args.push('--add-header', 'Upgrade-Insecure-Requests:1');

      // Add video URL
      args.push(`https://www.youtube.com/watch?v=${videoId}`);

      console.log('[yt-dlp] Running with args:', args.join(' '));

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
            const videoInfo = JSON.parse(output);
            console.log('[yt-dlp] Successfully extracted video info');
            resolve(videoInfo);
          } catch (e) {
            reject(new Error(`Failed to parse yt-dlp output: ${e.message}`));
          }
        } else {
          console.error('[yt-dlp] Failed with code:', code);
          console.error('[yt-dlp] Error output:', errorOutput.substring(0, 500));
          reject(new Error(`yt-dlp failed: ${errorOutput.substring(0, 500)}`));
        }
      });

      ytdlp.on('error', (error) => {
        reject(new Error(`Failed to spawn yt-dlp: ${error.message}`));
      });
    });
  }


  async extract(videoId) {
    try {
      await this.init();

      console.log(`[Extract] Starting extraction for video: ${videoId}`);

      // Use yt-dlp with TV client (works without cookies) or mweb (with cookies + PO token provider)
      const videoInfo = await this.extractWithYtDlp(videoId);
      return videoInfo;

    } catch (error) {
      console.error('[Extract] Fatal error:', error.message);
      throw error;
    }
  }

  parseCookiesTxt(cookiesPath) {
    try {
      const cookieLines = fs.readFileSync(cookiesPath, 'utf-8').split('\n');
      const cookies = cookieLines
        .filter(line => {
          // Filter out comments and empty lines
          const trimmed = line.trim();
          return trimmed && !trimmed.startsWith('#');
        })
        .map(line => {
          const parts = line.split('\t');
          if (parts.length < 7) {
            // Try Netscape format (space-separated)
            const spaceParts = line.trim().split(/\s+/);
            if (spaceParts.length >= 7) {
              const [domain, domainFlag, path, secure, expiration, name, ...valueParts] = spaceParts;
              const value = valueParts.join(' ');
              return {
                name,
                value,
                domain: domain.startsWith('.') ? domain.slice(1) : domain,
                path: path || '/',
                expires: expiration === '0' ? undefined : parseInt(expiration),
                httpOnly: false,
                secure: secure === 'TRUE' || secure === 'true'
              };
            }
            return null;
          }
          
          const [domain, domainFlag, path, secure, expiration, name, ...valueParts] = parts;
          const value = valueParts.join('\t'); // Rejoin in case value contains tabs
          
          return {
            name: name.trim(),
            value: value.trim(),
            domain: domain.startsWith('.') ? domain.slice(1) : domain,
            path: path || '/',
            expires: expiration === '0' || expiration === '' ? undefined : parseInt(expiration),
            httpOnly: false,
            secure: secure === 'TRUE' || secure === 'true'
          };
        })
        .filter(cookie => cookie !== null && cookie.name && cookie.value);

      console.log(`[parseCookiesTxt] Parsed ${cookies.length} cookies from ${cookiesPath}`);
      return cookies;
    } catch (error) {
      console.error('[parseCookiesTxt] Error parsing cookies:', error.message);
      return [];
    }
  }

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

