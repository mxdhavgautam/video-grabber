/**
 * Format Parser Service
 * 
 * Analyzes yt-dlp JSON response and extracts format information
 * for high-quality video and audio streams.
 * 
 * yt-dlp JSON structure contains:
 * - formats: Array of available formats
 * - requested_formats: If format was selected (e.g., bestvideo+bestaudio)
 * - format_id: Unique identifier for each format
 * - url: Direct download URL
 * - ext: File extension (mp4, webm, m4a, etc.)
 * - resolution: Resolution string (e.g., "1920x1080")
 * - width, height: Numeric dimensions
 * - fps: Frame rate
 * - vcodec: Video codec (h264, vp9, av1, etc.)
 * - acodec: Audio codec (aac, opus, etc.)
 * - filesize: File size in bytes
 * - quality: Quality indicator (0-10 scale)
 * - format_note: Human-readable note (e.g., "1080p", "720p60", "audio only")
 * - protocol: Protocol (https, m3u8_native, etc.)
 * - has_video: Boolean indicating if format has video
 * - has_audio: Boolean indicating if format has audio
 */

class FormatParser {
  /**
   * Parse yt-dlp JSON response and extract format information
   * @param {Object} ytdlpResponse - Raw JSON from yt-dlp --dump-json
   * @returns {Object} Parsed video info with enhanced format data
   */
  parse(ytdlpResponse) {
    if (!ytdlpResponse || typeof ytdlpResponse !== 'object') {
      throw new Error('Invalid yt-dlp response: expected object');
    }

    // Extract basic video info with safe defaults
    const basicInfo = {
      id: ytdlpResponse.id || ytdlpResponse.display_id || '',
      title: ytdlpResponse.title || ytdlpResponse.fulltitle || 'Unknown',
      description: ytdlpResponse.description || '',
      duration: ytdlpResponse.duration || ytdlpResponse.duration_string ? this.parseDuration(ytdlpResponse.duration_string) : 0,
      view_count: ytdlpResponse.view_count || 0,
      uploader: ytdlpResponse.uploader || ytdlpResponse.channel || '',
      uploader_id: ytdlpResponse.uploader_id || ytdlpResponse.channel_id || '',
      thumbnail: this.extractBestThumbnail(ytdlpResponse),
      webpage_url: ytdlpResponse.webpage_url || ytdlpResponse.url || ytdlpResponse.original_url || '',
      upload_date: ytdlpResponse.upload_date || '',
      channel: ytdlpResponse.channel || ytdlpResponse.uploader || '',
      channel_id: ytdlpResponse.channel_id || ytdlpResponse.uploader_id || '',
    };

    // Parse and categorize formats (handle missing or null formats array)
    const formatsArray = Array.isArray(ytdlpResponse.formats) ? ytdlpResponse.formats : [];
    if (formatsArray.length === 0) {
      console.warn('[FormatParser] No formats array found in response, checking alternative fields...');
      // Some yt-dlp responses might have formats in different structures
      if (ytdlpResponse.requested_formats && Array.isArray(ytdlpResponse.requested_formats)) {
        console.log('[FormatParser] Found requested_formats, using as formats');
        formatsArray.push(...ytdlpResponse.requested_formats);
      }
    }
    const formats = this.parseFormats(formatsArray);
    
    // Identify best quality streams
    const bestStreams = this.identifyBestStreams(formats);
    
    // Extract subtitles/captions
    const subtitles = this.parseSubtitles(ytdlpResponse);

    return {
      ...basicInfo,
      formats: formats.all,
      formats_by_category: {
        video_only: formats.video_only,
        audio_only: formats.audio_only,
        combined: formats.combined,
      },
      best_streams: bestStreams,
      subtitles: subtitles,
      // Additional metadata
      metadata: {
        extractor: ytdlpResponse.extractor || 'youtube',
        extractor_key: ytdlpResponse.extractor_key || 'Youtube',
        format_count: formats.all.length,
        has_hd: formats.all.some(f => f.height >= 720),
        has_4k: formats.all.some(f => f.height >= 2160),
        has_60fps: formats.all.some(f => (f.fps || 0) >= 60),
        max_resolution: this.getMaxResolution(formats.all),
        available_codecs: {
          video: [...new Set(formats.video_only.map(f => f.vcodec).filter(Boolean))],
          audio: [...new Set(formats.audio_only.map(f => f.acodec).filter(Boolean))],
        },
      },
    };
  }

  /**
   * Parse and categorize formats
   * @param {Array} formats - Array of format objects from yt-dlp
   * @returns {Object} Categorized formats
   */
  parseFormats(formats) {
    const all = [];
    const video_only = [];
    const audio_only = [];
    const combined = [];

    for (const format of formats) {
      // Skip invalid formats
      if (!format || typeof format !== 'object') continue;
      
      try {
        const parsed = this.parseFormat(format);
        all.push(parsed);

        if (parsed.hasVideo && !parsed.hasAudio) {
          video_only.push(parsed);
        } else if (parsed.hasAudio && !parsed.hasVideo) {
          audio_only.push(parsed);
        } else if (parsed.hasVideo && parsed.hasAudio) {
          combined.push(parsed);
        }
      } catch (error) {
        // Log but don't fail on individual format parsing errors
        console.warn('[FormatParser] Failed to parse format:', format.format_id || 'unknown', error.message);
        continue;
      }
    }

    // Sort formats by quality (best first)
    const sortByQuality = (a, b) => {
      // Prioritize: resolution > fps > bitrate
      if (b.height !== a.height) return b.height - a.height;
      if ((b.fps || 0) !== (a.fps || 0)) return (b.fps || 0) - (a.fps || 0);
      return (b.tbr || 0) - (a.tbr || 0);
    };

    return {
      all: all.sort(sortByQuality),
      video_only: video_only.sort(sortByQuality),
      audio_only: audio_only.sort((a, b) => (b.tbr || 0) - (a.tbr || 0)),
      combined: combined.sort(sortByQuality),
    };
  }

  /**
   * Parse duration string (HH:MM:SS or MM:SS) to seconds
   */
  parseDuration(durationString) {
    if (!durationString || typeof durationString !== 'string') return 0;
    const parts = durationString.split(':').map(Number).filter(n => !isNaN(n));
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  }

  /**
   * Parse individual format object
   * @param {Object} format - Format object from yt-dlp
   * @returns {Object} Parsed format with standardized fields
   */
  parseFormat(format) {
    if (!format || typeof format !== 'object') {
      throw new Error('Invalid format object');
    }
    
    const hasVideo = format.vcodec && format.vcodec !== 'none' && format.vcodec !== null;
    const hasAudio = format.acodec && format.acodec !== 'none' && format.acodec !== null;
    
    // Extract resolution
    let width = format.width || 0;
    let height = format.height || 0;
    
    // Try to parse from resolution string if dimensions missing
    if (!width && !height && format.resolution) {
      const match = format.resolution.match(/(\d+)x(\d+)/);
      if (match) {
        width = parseInt(match[1], 10);
        height = parseInt(match[2], 10);
      }
    }

    // Calculate quality score (0-10)
    const quality = this.calculateQuality(format, width, height);

    return {
      format_id: format.format_id || '',
      format_note: format.format_note || this.inferFormatNote(format, height),
      ext: format.ext || 'unknown',
      protocol: format.protocol || 'unknown',
      url: format.url || '',
      
      // Video properties
      hasVideo: hasVideo,
      hasAudio: hasAudio,
      width: width,
      height: height,
      resolution: format.resolution || (width && height ? `${width}x${height}` : ''),
      fps: format.fps || 0,
      
      // Codecs
      vcodec: format.vcodec || (hasVideo ? 'unknown' : 'none'),
      acodec: format.acodec || (hasAudio ? 'unknown' : 'none'),
      video_codec: format.vcodec || (hasVideo ? 'unknown' : 'none'),
      audio_codec: format.acodec || (hasAudio ? 'unknown' : 'none'),
      
      // File size
      filesize: format.filesize || format.filesize_approx || 0,
      filesize_approx: format.filesize_approx || format.filesize || 0,
      
      // Bitrate
      tbr: format.tbr || format.abr || format.vbr || 0, // Total bitrate, audio bitrate, or video bitrate
      abr: format.abr || 0, // Audio bitrate
      vbr: format.vbr || 0, // Video bitrate
      
      // Quality score
      quality: quality,
      
      // Additional metadata
      language: format.language || null,
      asr: format.asr || 0, // Audio sample rate
      filesize_approx: format.filesize_approx || format.filesize || 0,
      
      // Format classification
      is_hd: height >= 720,
      is_full_hd: height >= 1080,
      is_4k: height >= 2160,
      is_60fps: (format.fps || 0) >= 60,
      is_adaptive: format.format_note?.includes('DASH') || format.protocol === 'm3u8_native',
    };
  }

  /**
   * Calculate quality score (0-10) based on format properties
   */
  calculateQuality(format, width, height) {
    let score = 0;

    // Resolution score (0-5 points)
    if (height >= 2160) score += 5; // 4K
    else if (height >= 1440) score += 4; // 1440p
    else if (height >= 1080) score += 3.5; // 1080p
    else if (height >= 720) score += 2.5; // 720p
    else if (height >= 480) score += 1.5; // 480p
    else if (height > 0) score += 0.5; // Other

    // Frame rate bonus (0-1.5 points)
    const fps = format.fps || 0;
    if (fps >= 60) score += 1.5;
    else if (fps >= 30) score += 1;
    else if (fps >= 24) score += 0.5;

    // Codec quality (0-2 points)
    const vcodec = (format.vcodec || '').toLowerCase();
    if (vcodec.includes('av1')) score += 2; // AV1 is best
    else if (vcodec.includes('vp9')) score += 1.5; // VP9 is very good
    else if (vcodec.includes('h264') || vcodec.includes('avc')) score += 1; // H.264 is good

    // Audio quality (0-1.5 points)
    const acodec = (format.acodec || '').toLowerCase();
    const abr = format.abr || 0;
    if (abr >= 192) score += 1.5;
    else if (abr >= 128) score += 1;
    else if (abr >= 64) score += 0.5;

    return Math.min(10, Math.round(score * 10) / 10);
  }

  /**
   * Infer format note from format properties
   */
  inferFormatNote(format, height) {
    if (format.format_note) return format.format_note;
    
    const fps = format.fps || 0;
    const fpsStr = fps >= 60 ? '60' : fps >= 30 ? '30' : '';
    
    if (height >= 2160) return `4K${fpsStr ? ` ${fpsStr}fps` : ''}`;
    if (height >= 1440) return `1440p${fpsStr ? ` ${fpsStr}fps` : ''}`;
    if (height >= 1080) return `1080p${fpsStr ? ` ${fpsStr}fps` : ''}`;
    if (height >= 720) return `720p${fpsStr ? ` ${fpsStr}fps` : ''}`;
    if (height >= 480) return `480p`;
    if (height >= 360) return `360p`;
    if (height >= 240) return `240p`;
    if (format.acodec && format.acodec !== 'none') return 'audio only';
    return 'unknown';
  }

  /**
   * Identify best quality streams for different use cases
   * @param {Object} formats - Categorized formats
   * @returns {Object} Best streams for various scenarios
   */
  identifyBestStreams(formats) {
    return {
      // Best combined (video + audio in one)
      best_combined: this.findBestCombined(formats.combined),
      
      // Best video + audio combination (separate streams)
      best_video_audio: this.findBestVideoAudioCombo(formats.video_only, formats.audio_only),
      
      // Best video only
      best_video: this.findBestVideo(formats.video_only),
      
      // Best audio only
      best_audio: this.findBestAudio(formats.audio_only),
      
      // Quality-specific options
      quality_presets: {
        '4k': this.findByResolution(formats.video_only, 2160),
        '1440p': this.findByResolution(formats.video_only, 1440),
        '1080p': this.findByResolution(formats.video_only, 1080),
        '720p': this.findByResolution(formats.video_only, 720),
        '480p': this.findByResolution(formats.video_only, 480),
      },
      
      // Frame rate options
      fps_options: {
        '60fps': formats.video_only.filter(f => (f.fps || 0) >= 60),
        '30fps': formats.video_only.filter(f => (f.fps || 0) >= 30 && (f.fps || 0) < 60),
      },
    };
  }

  /**
   * Find best combined format (video + audio)
   */
  findBestCombined(combined) {
    if (combined.length === 0) return null;
    return combined[0]; // Already sorted by quality
  }

  /**
   * Find best video + audio combo (separate streams)
   */
  findBestVideoAudioCombo(videoOnly, audioOnly) {
    if (videoOnly.length === 0 || audioOnly.length === 0) return null;
    
    const bestVideo = videoOnly[0];
    const bestAudio = audioOnly[0];
    
    return {
      video: bestVideo,
      audio: bestAudio,
      combined_size: (bestVideo.filesize || 0) + (bestAudio.filesize || 0),
      // Format string for yt-dlp: "bestVideoFormatId+bestAudioFormatId"
      format_string: `${bestVideo.format_id}+${bestAudio.format_id}`,
    };
  }

  /**
   * Find best video-only stream
   */
  findBestVideo(videoOnly) {
    if (videoOnly.length === 0) return null;
    return videoOnly[0]; // Already sorted by quality
  }

  /**
   * Find best audio-only stream
   */
  findBestAudio(audioOnly) {
    if (audioOnly.length === 0) return null;
    // Sort by bitrate (audio quality)
    return audioOnly.sort((a, b) => (b.tbr || 0) - (a.tbr || 0))[0];
  }

  /**
   * Find video format by target resolution
   */
  findByResolution(videoOnly, targetHeight) {
    // Find exact match first
    let match = videoOnly.find(f => f.height === targetHeight);
    if (match) return match;
    
    // Find closest match (prefer higher resolution)
    const candidates = videoOnly.filter(f => f.height >= targetHeight * 0.9 && f.height <= targetHeight * 1.1);
    if (candidates.length > 0) {
      return candidates.sort((a, b) => {
        // Prefer closer to target, then higher resolution
        const diffA = Math.abs(a.height - targetHeight);
        const diffB = Math.abs(b.height - targetHeight);
        if (diffA !== diffB) return diffA - diffB;
        return b.height - a.height;
      })[0];
    }
    
    // Fallback: find closest overall
    return videoOnly.reduce((best, current) => {
      const bestDiff = Math.abs((best.height || 0) - targetHeight);
      const currentDiff = Math.abs((current.height || 0) - targetHeight);
      return currentDiff < bestDiff ? current : best;
    }, videoOnly[0]);
  }

  /**
   * Get maximum resolution available
   */
  getMaxResolution(formats) {
    const videoFormats = formats.filter(f => f.hasVideo && f.height > 0);
    if (videoFormats.length === 0) return null;
    
    const max = videoFormats.reduce((max, f) => f.height > (max?.height || 0) ? f : max, null);
    return max ? {
      width: max.width,
      height: max.height,
      resolution: max.resolution,
      format_id: max.format_id,
      fps: max.fps,
    } : null;
  }

  /**
   * Extract best thumbnail URL
   */
  extractBestThumbnail(response) {
    // Try thumbnail field first
    if (response.thumbnail) return response.thumbnail;
    
    // Try thumbnails array (prefer highest resolution)
    if (Array.isArray(response.thumbnails) && response.thumbnails.length > 0) {
      // Sort by width/height (largest first)
      const sorted = response.thumbnails
        .filter(t => t.url)
        .sort((a, b) => {
          const aSize = (a.width || 0) * (a.height || 0);
          const bSize = (b.width || 0) * (b.height || 0);
          return bSize - aSize;
        });
      return sorted[0]?.url || '';
    }
    
    return '';
  }

  /**
   * Parse subtitles/captions
   */
  parseSubtitles(response) {
    const subtitles = [];
    
    // Check automatic_captions (auto-generated)
    if (response.automatic_captions) {
      for (const [lang, subs] of Object.entries(response.automatic_captions)) {
        for (const sub of subs) {
          subtitles.push({
            language: lang,
            language_code: lang,
            format_id: sub.ext || 'unknown',
            url: sub.url || '',
            auto_generated: true,
            format_note: sub.name || sub.ext || 'unknown',
          });
        }
      }
    }
    
    // Check subtitles (manual captions)
    if (response.subtitles) {
      for (const [lang, subs] of Object.entries(response.subtitles)) {
        for (const sub of subs) {
          subtitles.push({
            language: lang,
            language_code: lang,
            format_id: sub.ext || 'unknown',
            url: sub.url || '',
            auto_generated: false,
            format_note: sub.name || sub.ext || 'unknown',
          });
        }
      }
    }
    
    return subtitles;
  }

  /**
   * Generate format selection string for yt-dlp
   * @param {Object} options - Selection options
   * @returns {String} Format string for yt-dlp
   */
  generateFormatString(options) {
    const { videoFormatId, audioFormatId, quality, resolution } = options;
    
    if (videoFormatId && audioFormatId) {
      return `${videoFormatId}+${audioFormatId}`;
    }
    
    if (quality === 'best') {
      return 'bestvideo+bestaudio/best';
    }
    
    if (resolution) {
      return `bestvideo[height<=${resolution}]+bestaudio/best[height<=${resolution}]`;
    }
    
    return 'bestvideo+bestaudio/best';
  }
}

export default FormatParser;

