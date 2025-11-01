import BgUtils from 'bgutils-js';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

puppeteer.use(StealthPlugin());

class YouTubeExtractor {
  constructor() {
    this.bgUtils = null;
    this.browser = null;
    this.cookiesPath = process.env.COOKIES_FILE || path.join(process.cwd(), 'runtime', 'yt-dlp', 'cookies.txt');
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;

    console.log('[YouTubeExtractor] Initializing...');
    
    // Initialize BgUtils - try multiple import methods
    try {
      // Try default import
      if (typeof BgUtils === 'function') {
        this.bgUtils = new BgUtils();
        await this.bgUtils.init();
        console.log('[YouTubeExtractor] BgUtils initialized (default import)');
      } else if (BgUtils && typeof BgUtils.default === 'function') {
        // Try default export
        this.bgUtils = new BgUtils.default();
        await this.bgUtils.init();
        console.log('[YouTubeExtractor] BgUtils initialized (default.default)');
      } else if (BgUtils && BgUtils.BgUtils) {
        // Try named export
        this.bgUtils = new BgUtils.BgUtils();
        await this.bgUtils.init();
        console.log('[YouTubeExtractor] BgUtils initialized (named export)');
      } else {
        console.warn('[YouTubeExtractor] BgUtils is not a constructor, skipping');
      }
    } catch (error) {
      console.warn('[YouTubeExtractor] BgUtils initialization failed:', error.message);
    }

    // Launch puppeteer with stealth
    try {
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-web-security',
          '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        ]
      });
      console.log('[YouTubeExtractor] Puppeteer browser launched');
    } catch (error) {
      console.error('[YouTubeExtractor] Failed to launch browser:', error.message);
    }

    this.initialized = true;
  }

  async generatePoToken(videoId) {
    try {
      if (!this.browser) {
        console.warn('[PO Token] Browser not available, skipping PO token generation');
        return null;
      }

      const page = await this.browser.newPage();
      
      // Load YouTube with cookies if available
      if (fs.existsSync(this.cookiesPath)) {
        try {
          const cookies = this.parseCookiesTxt(this.cookiesPath);
          await page.setCookie(...cookies);
          console.log('[PO Token] Loaded cookies from file');
        } catch (error) {
          console.warn('[PO Token] Failed to load cookies:', error.message);
        }
      }

      // Navigate to YouTube video
      await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Extract visitor data
      const visitorData = await page.evaluate(() => {
        try {
          return window.ytInitialData?.responseContext?.visitorData || 
                 window.ytcfg?.get('VISITOR_DATA');
        } catch (e) {
          return null;
        }
      });

      await page.close();

      if (!visitorData) {
        console.warn('[PO Token] Could not extract visitor data');
        return null;
      }

      // Generate PO token using BgUtils
      if (this.bgUtils) {
        try {
          const poToken = await this.bgUtils.generatePoToken({
            visitorData,
            videoId
          });
          console.log('[PO Token] Generated successfully');
          return poToken;
        } catch (error) {
          console.warn('[PO Token] Generation failed:', error.message);
          return null;
        }
      }

      return null;
    } catch (error) {
      console.error('[PO Token] Error:', error.message);
      return null;
    }
  }

  async extractWithYtDlp(videoId, poToken) {
    return new Promise((resolve, reject) => {
      const args = [
        '--dump-json',
        '--no-warnings',
        '--no-check-certificates',
        '--prefer-insecure'
      ];

      // Add Deno runtime for EJS if available
      if (this.isDenoAvailable()) {
        args.push('--extractor-args', 'youtube:ejs_runtime=deno');
      }

      // Add cookies if available
      if (fs.existsSync(this.cookiesPath)) {
        args.push('--cookies', this.cookiesPath);
      }

      // Add PO token if available
      if (poToken) {
        args.push('--extractor-args', `youtube:player_client=mweb;po_token=${poToken}`);
      } else {
        // Use mweb client as fallback
        args.push('--extractor-args', 'youtube:player_client=mweb');
      }

      // Add user agent
      args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Add video URL
      args.push(`https://www.youtube.com/watch?v=${videoId}`);

      console.log('[yt-dlp] Running with args:', args.join(' '));

      const ytdlp = spawn('yt-dlp', args);
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
          console.error('[yt-dlp] Error output:', errorOutput);
          reject(new Error(`yt-dlp failed: ${errorOutput}`));
        }
      });
    });
  }

  async extractWithYouTubeIJS(videoId, poToken) {
    const { Innertube } = await import('youtubei.js');
    
    // Try multiple client types for better success rate
    const clientTypes = ['WEB', 'ANDROID', 'TV_EMBEDDED', 'IOS', 'MWEB'];
    
    for (const clientType of clientTypes) {
      try {
        console.log(`[youtubei.js] Trying client type: ${clientType}`);
        
        const options = {
          client: clientType,
          fetch: async (input, init = {}) => {
            // Use axios for better cookie/header handling
            const axios = (await import('axios')).default;
            try {
              const response = await axios(input, {
                ...init,
                withCredentials: true,
                headers: {
                  ...init.headers,
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                  'Accept-Language': 'en-US,en;q=0.9',
                  'Referer': 'https://www.youtube.com/',
                }
              });
              // Create a simple headers-like object
              const headers = {
                get: (name) => {
                  const key = Object.keys(response.headers).find(k => k.toLowerCase() === name.toLowerCase());
                  return key ? response.headers[key] : null;
                },
                has: (name) => {
                  const key = Object.keys(response.headers).find(k => k.toLowerCase() === name.toLowerCase());
                  return !!key;
                }
              };

              return {
                ok: response.status >= 200 && response.status < 300,
                status: response.status,
                statusText: response.statusText || '',
                headers: headers,
                json: async () => response.data,
                text: async () => typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
                arrayBuffer: async () => Buffer.from(typeof response.data === 'string' ? response.data : JSON.stringify(response.data))
              };
            } catch (error) {
              throw new Error(`Fetch failed: ${error.message}`);
            }
          }
        };
        
        if (poToken) {
          options.po_token = poToken;
        }

        // Load visitor data from cookies if available
        if (fs.existsSync(this.cookiesPath)) {
          try {
            const visitorData = this.extractVisitorDataFromCookies();
            if (visitorData) {
              options.visitor_data = visitorData;
              console.log(`[youtubei.js] Using visitor data for ${clientType}`);
            }
          } catch (error) {
            console.warn('[youtubei.js] Failed to extract visitor data:', error.message);
          }
        }

        const youtube = await Innertube.create(options);
        const info = await youtube.getInfo(videoId);
        
        // Check if we got streaming data
        if (info.streaming_data && 
            (info.streaming_data.formats?.length > 0 || info.streaming_data.adaptive_formats?.length > 0)) {
          console.log(`[youtubei.js] Successfully extracted video info with ${clientType}`);
          return await this.convertYouTubeIJSFormat(info);
        } else {
          console.log(`[youtubei.js] ${clientType} returned empty streaming_data, trying next client...`);
          continue;
        }
      } catch (error) {
        console.warn(`[youtubei.js] ${clientType} failed:`, error.message);
        if (clientType === clientTypes[clientTypes.length - 1]) {
          // Last client type failed, throw error
          throw new Error(`All youtubei.js client types failed. Last error: ${error.message}`);
        }
        continue;
      }
    }
    
    throw new Error('All youtubei.js client types exhausted');
  }

  async extractWithPuppeteer(videoId) {
    if (!this.browser) {
      throw new Error('Browser not available for Puppeteer extraction');
    }

    console.log('[Puppeteer] Starting direct browser extraction...');
    const page = await this.browser.newPage();
    
    try {
      // Set cookies if available
      if (fs.existsSync(this.cookiesPath)) {
        try {
          const cookies = this.parseCookiesTxt(this.cookiesPath);
          await page.setCookie(...cookies);
          console.log('[Puppeteer] Loaded cookies');
        } catch (error) {
          console.warn('[Puppeteer] Failed to load cookies:', error.message);
        }
      }

      // Set viewport and user agent
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

      // Navigate to video page
      await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Wait for player to load
      await page.waitForSelector('#movie_player', { timeout: 10000 });

      // Extract streaming data directly from page
      const streamingData = await page.evaluate(() => {
        try {
          // Method 1: Try ytInitialPlayerResponse
          if (window.ytInitialPlayerResponse) {
            const data = window.ytInitialPlayerResponse;
            if (data.streamingData) {
              return {
                source: 'ytInitialPlayerResponse',
                streamingData: data.streamingData,
                videoDetails: data.videoDetails,
                playerConfig: data.playerConfig
              };
            }
          }

          // Method 2: Try ytInitialData
          if (window.ytInitialData) {
            const data = window.ytInitialData;
            const contents = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
            if (contents) {
              for (const content of contents) {
                if (content.videoPrimaryInfoRenderer) {
                  // Found video info, but need streaming data
                  const playerResponse = window.ytInitialPlayerResponse;
                  if (playerResponse?.streamingData) {
                    return {
                      source: 'ytInitialData + ytInitialPlayerResponse',
                      streamingData: playerResponse.streamingData,
                      videoDetails: playerResponse.videoDetails
                    };
                  }
                }
              }
            }
          }

          // Method 3: Try extracting from player element data
          const playerElement = document.getElementById('movie_player');
          if (playerElement && playerElement.getVideoData) {
            const videoData = playerElement.getVideoData();
            if (videoData) {
              return {
                source: 'playerElement.getVideoData',
                videoData: videoData
              };
            }
          }

          return null;
        } catch (error) {
          console.error('Puppeteer extraction error:', error);
          return { error: error.message };
        }
      });

      await page.close();

      if (!streamingData || streamingData.error) {
        throw new Error(streamingData?.error || 'Failed to extract streaming data from page');
      }

      console.log(`[Puppeteer] Extracted data from: ${streamingData.source}`);

      // Convert streaming data to our format
      if (streamingData.streamingData) {
        return await this.convertPuppeteerStreamingData(streamingData, videoId);
      }

      throw new Error('No streaming data found in page');
    } catch (error) {
      await page.close();
      throw error;
    }
  }

  async convertPuppeteerStreamingData(streamingData, videoId) {
    const formats = [];
    const sd = streamingData.streamingData;
    const vd = streamingData.videoDetails || {};

    // Process formats
    if (sd.formats) {
      formats.push(...sd.formats.map(f => ({
        format_id: f.itag?.toString(),
        url: f.url || f.signatureCipher || f.cipher,
        ext: f.mimeType?.split('/')[1]?.split(';')[0] || 'mp4',
        quality: f.qualityLabel || `${f.height}p`,
        filesize: parseInt(f.contentLength) || null,
        fps: f.fps || null,
        width: f.width || null,
        height: f.height || null,
        vcodec: f.mimeType?.includes('video') ? (f.mimeType?.includes('vp9') ? 'vp9' : f.mimeType?.includes('av01') ? 'av01' : 'avc1') : 'none',
        acodec: f.mimeType?.includes('audio') ? (f.mimeType?.includes('opus') ? 'opus' : 'aac') : 'none',
        format_note: f.qualityLabel || f.quality,
        hasVideo: !!f.width && !!f.height,
        hasAudio: f.mimeType?.includes('audio') || (!f.width && !f.height)
      })));
    }

    // Process adaptive formats
    if (sd.adaptiveFormats) {
      formats.push(...sd.adaptiveFormats.map(f => ({
        format_id: f.itag?.toString(),
        url: f.url || f.signatureCipher || f.cipher,
        ext: f.mimeType?.split('/')[1]?.split(';')[0] || (f.width ? 'mp4' : 'webm'),
        quality: f.qualityLabel || (f.height ? `${f.height}p` : 'audio only'),
        filesize: parseInt(f.contentLength) || null,
        fps: f.fps || null,
        width: f.width || null,
        height: f.height || null,
        vcodec: f.mimeType?.includes('video') ? (f.mimeType?.includes('vp9') ? 'vp9' : f.mimeType?.includes('av01') ? 'av01' : 'avc1') : 'none',
        acodec: f.mimeType?.includes('audio') ? (f.mimeType?.includes('opus') ? 'opus' : 'aac') : 'none',
        abr: f.bitrate ? Math.round(f.bitrate / 1000) : null,
        format_note: f.qualityLabel || f.quality,
        hasVideo: !!f.width && !!f.height,
        hasAudio: f.mimeType?.includes('audio') || (!f.width && !f.height)
      })));
    }

    // Extract audio tracks
    const audio_tracks = [];
    const audioFormats = formats.filter(f => f.hasAudio && !f.hasVideo);
    if (audioFormats.length > 0) {
      audio_tracks.push({
        language: 'English',
        language_code: 'en',
        format_ids: audioFormats.map(f => f.format_id)
      });
    }

    console.log(`[convertPuppeteerStreamingData] Extracted ${formats.length} formats, ${audioFormats.length} audio-only`);

    return {
      id: videoId,
      title: vd.title,
      thumbnail: vd.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      description: vd.shortDescription,
      duration: parseInt(vd.lengthSeconds) || null,
      uploader: vd.author,
      webpage_url: `https://www.youtube.com/watch?v=${videoId}`,
      formats: formats,
      audio_tracks: audio_tracks.length > 0 ? audio_tracks : null,
      subtitle_tracks: null // TODO: Extract captions
    };
  }

  async extract(videoId) {
    try {
      await this.init();

      console.log(`[Extract] Starting extraction for video: ${videoId}`);

      // Step 1: Generate PO token
      console.log('[Extract] [1/4] Generating PO token...');
      const poToken = await this.generatePoToken(videoId);
      
      if (poToken) {
        console.log('[Extract] PO token generated successfully');
      } else {
        console.log('[Extract] Proceeding without PO token');
      }

      // Step 2: Try Puppeteer direct extraction (most reliable for bot detection)
      console.log('[Extract] [2/4] Attempting Puppeteer direct extraction...');
      try {
        const videoInfo = await this.extractWithPuppeteer(videoId);
        if (videoInfo && videoInfo.formats && videoInfo.formats.length > 0) {
          console.log('[Extract] Puppeteer extraction successful!');
          return videoInfo;
        }
      } catch (puppeteerError) {
        console.warn('[Extract] Puppeteer extraction failed:', puppeteerError.message);
      }

      // Step 3: Try yt-dlp with EJS + PO token
      console.log('[Extract] [3/4] Attempting yt-dlp extraction...');
      try {
        const videoInfo = await this.extractWithYtDlp(videoId, poToken);
        return videoInfo;
      } catch (ytdlpError) {
        console.warn('[Extract] yt-dlp failed:', ytdlpError.message);
      }

      // Step 4: Fallback to youtubei.js with multiple client types
      console.log('[Extract] [4/4] Falling back to youtubei.js...');
      try {
        const videoInfo = await this.extractWithYouTubeIJS(videoId, poToken);
        return videoInfo;
      } catch (youtubeijsError) {
        console.error('[Extract] youtubei.js also failed:', youtubeijsError.message);
        throw new Error('All extraction methods failed');
      }

    } catch (error) {
      console.error('[Extract] Fatal error:', error.message);
      throw error;
    }
  }

  parseCookiesTxt(cookiesPath) {
    const cookieLines = fs.readFileSync(cookiesPath, 'utf-8').split('\n');
    return cookieLines
      .filter(line => line && !line.startsWith('#') && line.trim())
      .map(line => {
        const parts = line.split('\t');
        if (parts.length < 7) return null;
        
        const [domain, , path, secure, expiration, name, value] = parts;
        return {
          name,
          value,
          domain: domain.startsWith('.') ? domain.slice(1) : domain,
          path,
          expires: parseInt(expiration),
          httpOnly: false,
          secure: secure === 'TRUE'
        };
      })
      .filter(cookie => cookie !== null);
  }

  extractVisitorDataFromCookies() {
    if (!fs.existsSync(this.cookiesPath)) return null;
    
    const cookieLines = fs.readFileSync(this.cookiesPath, 'utf-8').split('\n');
    for (const line of cookieLines) {
      if (line.includes('VISITOR_INFO1_LIVE')) {
        const parts = line.split('\t');
        if (parts.length >= 7) {
          return parts[6]; // Cookie value
        }
      }
    }
    return null;
  }

  async convertYouTubeIJSFormat(info) {
    // Convert youtubei.js format to yt-dlp-like format
    const formats = [];
    
    // Debug: Log available keys in info object
    console.log('[convertYouTubeIJSFormat] Available keys in info:', Object.keys(info || {}));
    console.log('[convertYouTubeIJSFormat] streaming_data exists:', !!info.streaming_data);
    console.log('[convertYouTubeIJSFormat] streaming_data type:', typeof info.streaming_data);
    console.log('[convertYouTubeIJSFormat] streaming_data value:', info.streaming_data ? JSON.stringify(info.streaming_data).substring(0, 500) : 'null/undefined');
    
    if (info.streaming_data) {
      console.log('[convertYouTubeIJSFormat] streaming_data keys:', Object.keys(info.streaming_data || {}));
      console.log('[convertYouTubeIJSFormat] formats count:', info.streaming_data?.formats?.length || 0);
      console.log('[convertYouTubeIJSFormat] adaptive_formats count:', info.streaming_data?.adaptive_formats?.length || 0);
    } else {
      // Try alternative paths
      console.log('[convertYouTubeIJSFormat] Checking alternative paths...');
      if (info.basic_info) {
        console.log('[convertYouTubeIJSFormat] basic_info keys:', Object.keys(info.basic_info || {}));
      }
      if (info.player_config) {
        console.log('[convertYouTubeIJSFormat] player_config exists');
      }
    }
    
    // Helper to determine if format has video/audio
    const hasVideo = (f) => f.has_video || (f.width && f.height) || f.mime_type?.includes('video');
    const hasAudio = (f) => f.has_audio || f.mime_type?.includes('audio');
    
    // Process regular formats (combined audio+video)
    if (info.streaming_data?.formats) {
      const formatPromises = info.streaming_data.formats.map(async (f) => {
        const url = await f.decipher(info.player);
        return {
          format_id: f.itag?.toString(),
          url: typeof url === 'string' ? url : url?.toString(),
          ext: f.mime_type?.split('/')[1]?.split(';')[0] || 'mp4',
          quality: f.quality_label || `${f.height}p`,
          filesize: parseInt(f.content_length) || null,
          fps: f.fps || null,
          width: f.width || null,
          height: f.height || null,
          vcodec: hasVideo(f) ? (f.mime_type?.includes('avc1') ? 'avc1' : 'h264') : 'none',
          acodec: hasAudio(f) ? (f.mime_type?.includes('opus') ? 'opus' : 'aac') : 'none',
          format_note: f.quality_label || f.quality,
          hasVideo: hasVideo(f),
          hasAudio: hasAudio(f)
        };
      });
      formats.push(...await Promise.all(formatPromises));
    }

    // Process adaptive formats (separate audio/video)
    if (info.streaming_data?.adaptive_formats) {
      const formatPromises = info.streaming_data.adaptive_formats.map(async (f) => {
        const url = await f.decipher(info.player);
        return {
          format_id: f.itag?.toString(),
          url: typeof url === 'string' ? url : url?.toString(),
          ext: f.mime_type?.split('/')[1]?.split(';')[0] || (hasVideo(f) ? 'mp4' : 'webm'),
          quality: f.quality_label || (f.height ? `${f.height}p` : 'audio only'),
          filesize: parseInt(f.content_length) || null,
          fps: f.fps || null,
          width: f.width || null,
          height: f.height || null,
          vcodec: hasVideo(f) ? (f.mime_type?.includes('vp9') ? 'vp9' : f.mime_type?.includes('av01') ? 'av01' : 'avc1') : 'none',
          acodec: hasAudio(f) ? (f.mime_type?.includes('opus') ? 'opus' : 'aac') : 'none',
          abr: f.bitrate ? Math.round(f.bitrate / 1000) : null,
          format_note: f.quality_label || f.quality,
          hasVideo: hasVideo(f),
          hasAudio: hasAudio(f)
        };
      });
      formats.push(...await Promise.all(formatPromises));
    }

    // Extract audio tracks information
    const audio_tracks = [];
    const subtitle_tracks = [];
    
    console.log(`[convertYouTubeIJSFormat] Total formats: ${formats.length}`);
    
    // Group audio formats by language/quality
    const audioFormats = formats.filter(f => f.hasAudio && !f.hasVideo);
    console.log(`[convertYouTubeIJSFormat] Audio-only formats: ${audioFormats.length}`);
    
    // If we have audio formats, create a default audio track
    if (audioFormats.length > 0) {
      const audioFormatIds = audioFormats.map(f => f.format_id);
      audio_tracks.push({
        language: 'English',
        language_code: 'en',
        format_ids: audioFormatIds
      });
      console.log(`[convertYouTubeIJSFormat] Created audio track with ${audioFormatIds.length} format IDs`);
    }
    
    // Extract subtitle tracks if available
    if (info.captions) {
      try {
        const captionTracks = info.captions.caption_tracks || [];
        captionTracks.forEach(track => {
          subtitle_tracks.push({
            language: track.name?.text || track.language_code,
            language_code: track.language_code,
            format_id: track.base_url || `subtitle-${track.language_code}`,
            url: track.base_url
          });
        });
      } catch (error) {
        console.warn('[youtubei.js] Failed to extract subtitles:', error.message);
      }
    }

    return {
      id: info.basic_info?.id,
      title: info.basic_info?.title,
      thumbnail: info.basic_info?.thumbnail?.[0]?.url,
      description: info.basic_info?.short_description,
      duration: info.basic_info?.duration,
      uploader: info.basic_info?.author,
      webpage_url: `https://www.youtube.com/watch?v=${info.basic_info?.id}`,
      formats: formats,
      audio_tracks: audio_tracks.length > 0 ? audio_tracks : null,
      subtitle_tracks: subtitle_tracks.length > 0 ? subtitle_tracks : null
    };
  }

  isDenoAvailable() {
    try {
      const result = spawn('deno', ['--version']);
      return true;
    } catch (error) {
      return false;
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.initialized = false;
  }
}

export default YouTubeExtractor;

