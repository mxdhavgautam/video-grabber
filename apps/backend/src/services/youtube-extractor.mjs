import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import FormatParser from './format-parser.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class YouTubeExtractor {
  constructor(cookieGenerator = null) {
    this.cookiesPath = process.env.COOKIES_FILE || path.join(process.cwd(), 'runtime', 'yt-dlp', 'cookies.txt');
    this.initialized = false;
    this.formatParser = new FormatParser();
    this.cookieGenerator = cookieGenerator; // Reference to cookie generator for refreshing cookies
  }

  async init() {
    if (this.initialized) return;

    console.log('[YouTubeExtractor] Initializing...');
    this.initialized = true;
  }

  async extractWithYtDlp(videoId, clientType = null, skipImpersonate = false, requestAllFormats = false, forceTorProxy = null) {
    return new Promise(async (resolve, reject) => {
      const args = [
        '--dump-json',
        '--no-warnings',
        '--no-check-certificates',
        '--prefer-insecure'
      ];

      // Note: --dump-json returns ALL available formats regardless of client restrictions
      // Mobile clients (android/ios) may still return limited formats due to YouTube's restrictions
      // Desktop clients (mweb/web) with cookies typically return more formats (including high-res)

      // Add Deno runtime for EJS (required for latest yt-dlp with external n/sig solver)
      const denoAvailable = await this.checkDenoAvailable();
      if (denoAvailable) {
        args.push('--extractor-args', 'youtube:ejs_runtime=deno');
        console.log('[yt-dlp] Using Deno for EJS runtime');
      } else {
        console.warn('[yt-dlp] Deno not available, attempting without EJS runtime');
      }

      // Add proxy support (Tor) to bypass datacenter IP detection
      // Tor routes requests through residential exit nodes
      // Enable via USE_TOR_PROXY environment variable (default: false - YouTube blocks Tor exit nodes)
      // forceTorProxy can override the env var setting (used for automatic fallback)
      // WARNING: YouTube often blocks Tor exit nodes, so Tor may not work for YouTube
      const useTorProxy = forceTorProxy !== null ? forceTorProxy : (process.env.USE_TOR_PROXY === 'true');
      if (useTorProxy) {
        // Use socks5h:// format (hostname resolution through proxy) - recommended for Tor
        const torProxyUrl = process.env.TOR_PROXY_URL || 'socks5h://tor-proxy:9050';
        args.push('--proxy', torProxyUrl);
        console.log('[yt-dlp] Using Tor proxy:', torProxyUrl);
        console.log('[yt-dlp] Requests will route through Tor network (residential IPs from exit nodes)');
        console.log('[yt-dlp] ⚠️  Note: YouTube often blocks Tor exit nodes - extraction may fail');
      } else {
        console.log('[yt-dlp] Using direct connection (Tor proxy disabled)');
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
      // When using Tor, delays are especially important to avoid rate limiting
      // Tor exit nodes may have different rate limits
      const sleepInterval = useTorProxy ? '3' : '2';  // Longer delays with Tor
      const maxSleepInterval = useTorProxy ? '8' : '5';  // More variation with Tor
      args.push('--sleep-interval', sleepInterval);
      args.push('--max-sleep-interval', maxSleepInterval);
      console.log(`[yt-dlp] Added random delays (${sleepInterval}-${maxSleepInterval}s) to mimic human behavior`);

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
            const rawVideoInfo = JSON.parse(output);
            console.log('[yt-dlp] Successfully extracted video info');
            console.log(`[yt-dlp] Raw JSON keys: ${Object.keys(rawVideoInfo).join(', ')}`);
            console.log(`[yt-dlp] Formats array length: ${Array.isArray(rawVideoInfo.formats) ? rawVideoInfo.formats.length : 'N/A'}`);
            
            // Parse and enhance format information for high-quality stream access
            try {
              const parsedVideoInfo = this.formatParser.parse(rawVideoInfo);
            console.log(`[yt-dlp] Parsed ${parsedVideoInfo.metadata.format_count} formats`);
            console.log(`[yt-dlp] Max resolution: ${parsedVideoInfo.metadata.max_resolution?.resolution || 'unknown'}`);
            
            // Warn if we only got limited formats (common with mobile clients)
            if (parsedVideoInfo.metadata.format_count < 10) {
              console.warn(`[yt-dlp] WARNING: Only ${parsedVideoInfo.metadata.format_count} formats available - mobile clients may return limited formats`);
              console.warn(`[yt-dlp] This may indicate format restrictions. Max resolution: ${parsedVideoInfo.metadata.max_resolution?.resolution || 'unknown'}`);
            }
            
            if (parsedVideoInfo.best_streams.best_combined) {
              console.log(`[yt-dlp] Best combined format: ${parsedVideoInfo.best_streams.best_combined.format_id} (${parsedVideoInfo.best_streams.best_combined.resolution || 'unknown'})`);
            }
            if (parsedVideoInfo.best_streams.best_video_audio) {
              console.log(`[yt-dlp] Best separate: video=${parsedVideoInfo.best_streams.best_video_audio.video.format_id} (${parsedVideoInfo.best_streams.best_video_audio.video.resolution || 'unknown'}) + audio=${parsedVideoInfo.best_streams.best_video_audio.audio.format_id}`);
            }
              
              resolve(parsedVideoInfo);
            } catch (parseError) {
              console.error('[yt-dlp] Format parser error:', parseError.message);
              console.error('[yt-dlp] Parse error stack:', parseError.stack);
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

      // If we have cookies and cookie generator, refresh cookies right before extraction
      // This ensures cookies are fresh from active browser session (within last few minutes)
      if (fs.existsSync(this.cookiesPath) && this.cookieGenerator && this.cookieGenerator.isRunning) {
        try {
          const cookieStats = fs.statSync(this.cookiesPath);
          const cookieAge = Date.now() - cookieStats.mtimeMs;
          const maxCookieAge = 5 * 60 * 1000; // 5 minutes
          
          if (cookieAge > maxCookieAge) {
            console.log(`[Extract] Cookies are ${Math.round(cookieAge / 1000)}s old, refreshing from browser...`);
            await this.cookieGenerator.exportCookies(true); // Force refresh
            console.log('[Extract] ✓ Cookies refreshed from active browser session');
          } else {
            console.log(`[Extract] Cookies are fresh (${Math.round(cookieAge / 1000)}s old), using existing cookies`);
          }
        } catch (refreshError) {
          console.warn('[Extract] Failed to refresh cookies, using existing:', refreshError.message);
        }
      }

      // Try multiple client strategies if first attempt fails (only when no cookies)
      // ANDROID client with Chrome impersonation has proven most successful
      // Success factors: Chrome TLS fingerprint + Android client + PO token + mobile headers + delays
      // Note: Transient bot detection failures are common - retry logic handles this
      if (!fs.existsSync(this.cookiesPath)) {
        // Strategy 1: ANDROID client with retry (PROVEN SUCCESS - Chrome impersonation + PO token + mobile headers)
        // Why it works: Chrome TLS fingerprint is more trusted, Android client less restrictive,
        // PO token adds legitimacy, mobile headers match authentic Android Chrome behavior
        // Retry logic handles transient bot detection failures
        const androidResult = await this.extractWithRetry(videoId, 'android', 2);
        if (androidResult) {
          console.log('[Extract] ✓ ANDROID client succeeded!');
          return androidResult;
        }
        
        console.warn('[Extract] ANDROID client failed after retries, trying IOS client...');
          
        // Strategy 2: IOS client (Safari impersonation - sometimes works but less reliable)
        const iosResult = await this.extractWithRetry(videoId, 'ios', 2);
        if (iosResult) {
          return iosResult;
        }
        
        console.warn('[Extract] IOS client failed after retries, trying TV client...');
        
        // Strategy 3: TV client (last resort - Edge impersonation)
        const tvResult = await this.extractWithRetry(videoId, 'tv', 2);
        if (tvResult) {
          return tvResult;
        }
        
        console.error('[Extract] All client types failed after retries');
        throw new Error('All extraction attempts failed. YouTube may be rate limiting this IP address. Try again in a few moments.');
      } else {
        // With cookies, try multiple client strategies
        // Strategy 1: MWEB client (best for cookies, but sometimes gets detected)
        try {
          console.log('[Extract] Attempting extraction with MWEB client (cookies available)...');
          const videoInfo = await this.extractWithYtDlp(videoId, 'mweb');
          
          // Report successful extraction (cookies are working)
          if (this.cookieGenerator) {
            this.cookieGenerator.reportSuccessfulExtraction();
          }
          
          console.log('[Extract] ✓ MWEB client succeeded with cookies!');
          return videoInfo;
        } catch (mwebError) {
          // Check if this is a bot detection error
          const errorMsg = mwebError.message || '';
          const isBotDetection = errorMsg.includes('bot') || errorMsg.includes('Sign in') || errorMsg.includes('confirm');
          
          if (isBotDetection) {
            console.warn('[Extract] MWEB client failed with bot detection, trying ANDROID client with cookies...');
            
            // Strategy 2: Fallback to ANDROID client with cookies
            // Android client + cookies sometimes works better than mweb for bot detection
            try {
              const androidVideoInfo = await this.extractWithYtDlp(videoId, 'android');
              
              // Report successful extraction
              if (this.cookieGenerator) {
                this.cookieGenerator.reportSuccessfulExtraction();
              }
              
              console.log('[Extract] ✓ ANDROID client succeeded with cookies (fallback from MWEB)!');
              return androidVideoInfo;
            } catch (androidError) {
              const androidErrorMsg = androidError.message || '';
              const androidBotDetection = androidErrorMsg.includes('bot') || androidErrorMsg.includes('Sign in') || androidErrorMsg.includes('confirm');
              
              console.error('[Extract] Both MWEB and ANDROID clients failed with cookies');
              
              // Strategy 3: Try with Tor proxy as last resort (YouTube may block datacenter IPs)
              // Only try Tor if we're not already using it and bot detection occurred
              const currentTorSetting = process.env.USE_TOR_PROXY === 'true';
              if (androidBotDetection && !currentTorSetting) {
                console.warn('[Extract] Direct connection failed with bot detection, trying with Tor proxy as fallback...');
                console.warn('[Extract] This will route through residential exit nodes (may be slower but less likely blocked)');
                
                try {
                  // Try with Tor - use MWEB client with cookies + Tor (forceTorProxy=true)
                  const torVideoInfo = await this.extractWithYtDlp(videoId, 'mweb', false, false, true);
                  
                  if (this.cookieGenerator) {
                    this.cookieGenerator.reportSuccessfulExtraction();
                  }
                  
                  console.log('[Extract] ✓ Tor proxy fallback succeeded! Consider enabling USE_TOR_PROXY=true for future requests');
                  return torVideoInfo;
                } catch (torError) {
                  console.error('[Extract] Tor proxy fallback also failed:', torError.message.substring(0, 200));
                  console.error('[Extract] This confirms YouTube is blocking Tor exit nodes - cookies + direct connection may work better');
                }
              }
              
              // Report bot detection failure if it's a bot error
              if (this.cookieGenerator) {
                if (androidBotDetection) {
                  this.cookieGenerator.reportBotDetectionFailure();
                }
              }
              
              // Throw the original mweb error (more descriptive)
              throw mwebError;
            }
          } else {
            // Non-bot error, throw immediately
            throw mwebError;
          }
        }
      }

    } catch (error) {
      console.error('[Extract] Fatal error:', error.message);
      
      // Also check for bot detection in final catch
      const errorMsg = error.message || '';
      const isBotDetection = errorMsg.includes('bot') || errorMsg.includes('Sign in') || errorMsg.includes('confirm');
      
      if (isBotDetection && this.cookieGenerator) {
        this.cookieGenerator.reportBotDetectionFailure();
      }
      
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

  /**
   * Extract with automatic retry for transient bot detection failures
   * Handles the common case where first attempt fails but retry succeeds
   * @param {string} videoId - Video ID to extract
   * @param {string} clientType - Client type (android, ios, tv)
   * @param {number} maxRetries - Maximum number of retries (default: 2)
   * @param {number} baseDelay - Base delay between retries in milliseconds (default: 3000)
   * @returns {Promise<Object|null>} Video info or null if all retries failed
   */
  async extractWithRetry(videoId, clientType, maxRetries = 2, baseDelay = 3000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          console.log(`[Extract] Retry attempt ${attempt}/${maxRetries} for ${clientType.toUpperCase()} client...`);
          // Exponential backoff: 3s, 6s, 12s...
          const delay = baseDelay * Math.pow(2, attempt - 2);
          console.log(`[Extract] Waiting ${delay}ms before retry (exponential backoff)...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        const videoInfo = await this.extractWithYtDlp(videoId, clientType);
        if (attempt > 1) {
          console.log(`[Extract] ✓ ${clientType.toUpperCase()} client succeeded on retry ${attempt}!`);
        }
        return videoInfo;
      } catch (error) {
        const errorMsg = error.message || '';
        const isBotDetection = errorMsg.includes('bot') || errorMsg.includes('Sign in');
        
        if (isBotDetection && attempt < maxRetries) {
          console.warn(`[Extract] ${clientType.toUpperCase()} client attempt ${attempt} failed with bot detection, will retry...`);
          console.warn(`[Extract] Error: ${errorMsg.substring(0, 200)}`);
          continue;
        }
        
        // If last attempt or non-bot error, throw
        if (attempt === maxRetries) {
          console.error(`[Extract] ${clientType.toUpperCase()} client failed after ${maxRetries} attempts`);
          throw error;
        }
      }
    }
    
    return null;
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

