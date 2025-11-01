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
    
    // Initialize BgUtils
    try {
      this.bgUtils = new BgUtils();
      await this.bgUtils.init();
      console.log('[YouTubeExtractor] BgUtils initialized');
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
          '--disable-gpu'
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
    try {
      const { Innertube } = await import('youtubei.js');
      
      const options = {};
      
      if (poToken) {
        options.po_token = poToken;
      }

      // Load visitor data from cookies if available
      if (fs.existsSync(this.cookiesPath)) {
        try {
          const visitorData = this.extractVisitorDataFromCookies();
          if (visitorData) {
            options.visitor_data = visitorData;
          }
        } catch (error) {
          console.warn('[youtubei.js] Failed to extract visitor data:', error.message);
        }
      }

      const youtube = await Innertube.create(options);
      const info = await youtube.getInfo(videoId);
      
      console.log('[youtubei.js] Successfully extracted video info');
      
      // Convert to yt-dlp-like format
      return await this.convertYouTubeIJSFormat(info);
    } catch (error) {
      console.error('[youtubei.js] Extraction failed:', error.message);
      throw error;
    }
  }

  async extract(videoId) {
    try {
      await this.init();

      console.log(`[Extract] Starting extraction for video: ${videoId}`);

      // Step 1: Generate PO token
      console.log('[Extract] [1/3] Generating PO token...');
      const poToken = await this.generatePoToken(videoId);
      
      if (poToken) {
        console.log('[Extract] PO token generated successfully');
      } else {
        console.log('[Extract] Proceeding without PO token');
      }

      // Step 2: Try yt-dlp with EJS + PO token
      console.log('[Extract] [2/3] Attempting yt-dlp extraction...');
      try {
        const videoInfo = await this.extractWithYtDlp(videoId, poToken);
        return videoInfo;
      } catch (ytdlpError) {
        console.warn('[Extract] yt-dlp failed:', ytdlpError.message);
      }

      // Step 3: Fallback to youtubei.js
      console.log('[Extract] [3/3] Falling back to youtubei.js...');
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
    if (info.streaming_data) {
      console.log('[convertYouTubeIJSFormat] streaming_data keys:', Object.keys(info.streaming_data || {}));
      console.log('[convertYouTubeIJSFormat] formats count:', info.streaming_data?.formats?.length || 0);
      console.log('[convertYouTubeIJSFormat] adaptive_formats count:', info.streaming_data?.adaptive_formats?.length || 0);
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

