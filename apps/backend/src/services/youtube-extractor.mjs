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

  async extractWithYtDlp(videoId, clientType = null, skipImpersonate = false) {
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
      
      // Use provided client type, or determine based on cookies
      let selectedClient = clientType;
      if (!selectedClient) {
        if (fs.existsSync(this.cookiesPath)) {
          // If we have cookies, use mweb (but needs PO token)
          selectedClient = 'mweb';
        } else {
          // Default to ANDROID for no cookies (PROVEN SUCCESS - Chrome impersonation works best)
          // Android client with Chrome TLS fingerprint has highest success rate
          selectedClient = 'android';
        }
      }
      
      extractorArgs.push(`youtube:player_client=${selectedClient}`);
      console.log(`[yt-dlp] Using ${selectedClient.toUpperCase()} client`);
      
      // Configure PO Token Provider - try it for ALL clients including mobile
      // Some users report PO tokens help even for mobile clients without cookies
      const poProviderUrl = process.env.PO_TOKEN_PROVIDER_URL || 'http://po-token-provider:4416';
      extractorArgs.push(`youtubepot-bgutilhttp:base_url=${poProviderUrl}`);
      console.log(`[yt-dlp] Using PO Token Provider at: ${poProviderUrl} (even for mobile clients)`);

      if (extractorArgs.length > 0) {
        args.push('--extractor-args', extractorArgs.join(';'));
      }

      // Use curl_cffi impersonation to mimic real browser TLS fingerprints
      // This is critical for bypassing YouTube's bot detection
      // curl_cffi must be explicitly enabled with --impersonate flag
      // Match impersonation target to client type for better authenticity
      // Skip if previous attempt failed with impersonate error
      if (!skipImpersonate) {
        // Match impersonation target to client type
        let impersonateTarget;
        if (selectedClient === 'ios') {
          impersonateTarget = 'safari'; // Safari for iOS
        } else if (selectedClient === 'android') {
          impersonateTarget = 'chrome'; // Chrome for Android
        } else {
          impersonateTarget = 'edge'; // Edge for TV/Desktop (sometimes works better)
        }
        args.push('--impersonate', impersonateTarget);
        console.log(`[yt-dlp] Using curl_cffi with ${impersonateTarget} impersonation for ${selectedClient.toUpperCase()} client`);
      } else {
        console.log('[yt-dlp] Skipping --impersonate (previous attempt failed)');
      }

      // Match user agent to client type for better authenticity
      let userAgent;
      if (selectedClient === 'ios') {
        userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
      } else if (selectedClient === 'android') {
        userAgent = 'Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
      } else {
        userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
      }
      args.push('--user-agent', userAgent);

      // Add referer header
      args.push('--add-header', 'Referer:https://www.youtube.com/');
      
      // Add additional headers to mimic real browser
      // Different headers for mobile vs desktop
      if (selectedClient === 'ios' || selectedClient === 'android') {
        // Mobile-specific headers
        args.push('--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
        args.push('--add-header', 'Accept-Language:en-US,en;q=0.9');
        args.push('--add-header', 'Accept-Encoding:gzip, deflate, br');
        args.push('--add-header', 'X-YouTube-Client-Name:2'); // Mobile client indicator
        args.push('--add-header', 'X-YouTube-Client-Version:19.09.3'); // Recent mobile version
      } else {
        // Desktop headers
        args.push('--add-header', 'Accept:text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8');
        args.push('--add-header', 'Accept-Language:en-US,en;q=0.9');
        args.push('--add-header', 'Accept-Encoding:gzip, deflate, br');
        args.push('--add-header', 'DNT:1');
        args.push('--add-header', 'X-YouTube-Client-Name:1'); // Web client indicator
      }
      
      args.push('--add-header', 'Connection:keep-alive');
      args.push('--add-header', 'Upgrade-Insecure-Requests:1');
      
      // Add random delays to mimic human behavior and avoid rate limiting
      // Random delay between 2-5 seconds before making request
      args.push('--sleep-interval', '2');
      args.push('--max-sleep-interval', '5');
      console.log('[yt-dlp] Added random delays (2-5s) to mimic human behavior');

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
          // Log full error for debugging (show more than 500 chars)
          const fullError = errorOutput.length > 0 ? errorOutput : output;
          const errorPreview = fullError.length > 2000 ? fullError.substring(0, 2000) : fullError;
          console.error('[yt-dlp] Error output:', errorPreview);
          
          // Check if it's an impersonate-related error
          if (fullError.includes('impersonate') || fullError.includes('curl_cffi') || fullError.includes('curl-cffi')) {
            console.error('[yt-dlp] curl_cffi/impersonate error detected - curl_cffi may not be properly installed');
            console.error('[yt-dlp] Attempting without --impersonate flag as fallback...');
            // Try again without impersonate flag
            return this.extractWithYtDlp(videoId, clientType, true).then(resolve).catch(reject);
          }
          
          reject(new Error(`yt-dlp failed: ${fullError.substring(0, 500)}`));
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

      // Try multiple client strategies if first attempt fails (only when no cookies)
      // ANDROID client with Chrome impersonation has proven most successful
      // Success factors: Chrome TLS fingerprint + Android client + PO token + mobile headers + delays
      if (!fs.existsSync(this.cookiesPath)) {
        // Strategy 1: ANDROID client (PROVEN SUCCESS - Chrome impersonation + PO token + mobile headers)
        // Why it works: Chrome TLS fingerprint is more trusted, Android client less restrictive,
        // PO token adds legitimacy, mobile headers match authentic Android Chrome behavior
        try {
          console.log('[Extract] [1/3] Trying ANDROID client (most successful configuration)...');
          const videoInfo = await this.extractWithYtDlp(videoId, 'android');
          console.log('[Extract] ✓ ANDROID client succeeded!');
          return videoInfo;
        } catch (androidError) {
          console.warn('[Extract] ANDROID client failed, trying IOS client...');
          console.warn('[Extract] ANDROID error:', androidError.message.substring(0, 200));
          
          // Strategy 2: IOS client (Safari impersonation - sometimes works but less reliable)
          try {
            console.log('[Extract] [2/3] Trying IOS client...');
            const videoInfo = await this.extractWithYtDlp(videoId, 'ios');
            return videoInfo;
          } catch (iosError) {
            console.warn('[Extract] IOS client failed, trying TV client...');
            console.warn('[Extract] IOS error:', iosError.message.substring(0, 200));
            
            // Strategy 3: TV client (last resort - Edge impersonation)
            try {
              console.log('[Extract] [3/3] Trying TV client...');
              const videoInfo = await this.extractWithYtDlp(videoId, 'tv');
              return videoInfo;
            } catch (tvError) {
              console.error('[Extract] All client types failed');
              console.error('[Extract] TV error:', tvError.message.substring(0, 200));
              throw new Error(`All extraction attempts failed. Last error: ${tvError.message.substring(0, 200)}`);
            }
          }
        }
      } else {
        // With cookies, just use mweb (which requires PO token provider)
        const videoInfo = await this.extractWithYtDlp(videoId, 'mweb');
        return videoInfo;
      }

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

