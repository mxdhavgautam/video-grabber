import { createServer } from 'http'
import { exec, spawn } from 'child_process'
import { promisify as _promisify } from 'util'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { existsSync, writeFileSync, mkdirSync, readFileSync, unlinkSync, statSync, readdirSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { tmpdir } from 'os'

const execPromise = _promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = process.env.PORT || 3001
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*'

// Concurrent download limit - prevent overwhelming free tier
let activeDownloads = 0
const MAX_CONCURRENT_DOWNLOADS = 3

// Progress tracking for active downloads - Map<formatId, {progress, stage, eta}>
const downloadProgress = new Map()

// Path to cookies file (can be provided as environment variable)
const COOKIES_FILE = process.env.COOKIES_FILE || join(__dirname, '.yt-dlp', 'cookies.txt')
const hasCookies = existsSync(COOKIES_FILE)

// Chrome profile directory for cookies persistence
const CHROME_PROFILE_DIR = process.env.CHROME_PROFILE_DIR || join(__dirname, 'chrome-profiles')

// Chrome profile management
const CHROME_PROFILES_BASE = CHROME_PROFILE_DIR
let currentChromeProfile = null
let lastProfileCleanup = Date.now()
const PROFILE_ROTATION_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours

// Flag to enable automatic browser cookie extraction
// On server: always enable chromium cookies extraction since we're running full Chrome
let useBrowserCookies = true

// =====================================================================
// RATE LIMITING & SECURITY
// =====================================================================

// Rate limiter: Track requests per IP
const ipRequestCounts = new Map() // Map<IP, {extract: count, download: count, lastReset: timestamp}>
const blockedIPs = new Set() // Set of IPs temporarily blocked for abuse
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const EXTRACT_RATE_LIMIT = 10 // 10 requests per minute
const DOWNLOAD_RATE_LIMIT = 5 // 5 requests per minute
const ABUSE_THRESHOLD = 100 // Block IPs making >100 requests/min
const BLOCK_DURATION = 15 * 60 * 1000 // Block for 15 minutes

// Request validation constants
const MAX_URL_LENGTH = 2048
const MAX_FORMAT_ID_LENGTH = 50
const REQUEST_TIMEOUT = 30000 // 30 seconds

/**
 * Get client IP address from request
 */
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || 
         req.headers['x-real-ip'] || 
         req.socket?.remoteAddress || 
         'unknown'
}

/**
 * Check if IP is rate limited
 */
function isRateLimited(ip, endpoint) {
  const now = Date.now()
  
  // Check if IP is blocked for abuse
  if (blockedIPs.has(ip)) {
    console.warn(`🚫 Blocked IP attempted request: ${ip}`)
    return { limited: true, reason: 'BLOCKED', retryAfter: 900 }
  }
  
  // Initialize IP tracking
  if (!ipRequestCounts.has(ip)) {
    ipRequestCounts.set(ip, {
      extract: 0,
      download: 0,
      lastReset: now,
    })
  }
  
  const ipData = ipRequestCounts.get(ip)
  
  // Reset if window has passed
  if (now - ipData.lastReset > RATE_LIMIT_WINDOW) {
    ipData.extract = 0
    ipData.download = 0
    ipData.lastReset = now
  }
  
  // Check endpoint-specific limits
  const limit = endpoint === 'extract' ? EXTRACT_RATE_LIMIT : DOWNLOAD_RATE_LIMIT
  const current = ipData[endpoint]
  
  // Detect abuse (too many requests in window)
  const totalRequests = ipData.extract + ipData.download
  if (totalRequests > ABUSE_THRESHOLD) {
    console.error(`🔴 ABUSE DETECTED: IP ${ip} made ${totalRequests} requests in 1 minute`)
    blockedIPs.add(ip)
    setTimeout(() => blockedIPs.delete(ip), BLOCK_DURATION)
    return { limited: true, reason: 'BLOCKED_ABUSE', retryAfter: 900 }
  }
  
  // Increment counter
  ipData[endpoint]++
  
  // Check if over limit
  if (current >= limit) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW - (now - ipData.lastReset)) / 1000)
    console.warn(`⏱️  Rate limit exceeded for ${endpoint} from IP ${ip}`)
    return { limited: true, reason: 'RATE_LIMITED', retryAfter }
  }
  
  return { limited: false }
}

/**
 * Validate URL parameter
 */
function validateURL(url) {
  if (!url) {
    return { valid: false, error: 'URL is required' }
  }
  
  if (url.length > MAX_URL_LENGTH) {
    return { valid: false, error: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters` }
  }
  
  if (!/^https?:\/\//.test(url)) {
    return { valid: false, error: 'URL must start with http:// or https://' }
  }
  
  if (!/https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
    return { valid: false, error: 'Only YouTube URLs are supported' }
  }
  
  return { valid: true }
}

/**
 * Validate format ID parameter
 */
function validateFormatID(formatId) {
  if (!formatId) {
    return { valid: false, error: 'Format ID is required' }
  }
  
  if (formatId.length > MAX_FORMAT_ID_LENGTH) {
    return { valid: false, error: `Format ID exceeds maximum length of ${MAX_FORMAT_ID_LENGTH} characters` }
  }
  
  if (!/^[\w\-]+$/.test(formatId)) {
    return { valid: false, error: 'Format ID contains invalid characters' }
  }
  
  return { valid: true }
}

/**
 * Helper to run FFmpeg command and get output
 */
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args)
    let stderr = ''
    let stdout = ''
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
      // Log FFmpeg progress
      const line = data.toString().trim()
      if (line && (line.includes('frame=') || line.includes('time=') || line.includes('bitrate='))) {
        console.log(`[FFmpeg] ${line}`)
      }
    })
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, success: true })
      } else {
        reject(new Error(`FFmpeg failed with code ${code}: ${stderr.substring(0, 500)}`))
      }
    })
    
    proc.on('error', (error) => {
      reject(new Error(`Failed to run FFmpeg: ${error.message}`))
    })
  })
}

/**
 * Merge video and audio streams with FFmpeg
 * @param {string} videoPath - Path to video file (e.g., format 313 VP9)
 * @param {string} audioPath - Path to audio file (e.g., format 140 AAC)
 * @param {string} outputPath - Path for output MP4
 */
async function mergeVideoAudio(videoPath, audioPath, outputPath) {
  console.log(`🎬 Merging video and audio with FFmpeg...`)
  console.log(`   Video: ${videoPath}`)
  console.log(`   Audio: ${audioPath}`)
  console.log(`   Output: ${outputPath}`)
  
  const args = [
    '-i', videoPath,
    '-i', audioPath,
    '-c:v', 'copy',        // Copy video codec (already VP9 or H.264)
    '-c:a', 'aac',         // Convert audio to AAC for compatibility
    '-b:a', '128k',        // Audio bitrate
    '-movflags', '+faststart', // Enable streaming (moov atom at start)
    '-y',                  // Overwrite output file
    outputPath
  ]
  
  return runFFmpeg(args)
}

/**
 * Convert video format with FFmpeg
 * @param {string} inputPath - Input video file
 * @param {string} outputPath - Output video file  
 * @param {object} options - Conversion options {codec, preset, bitrate}
 */
async function convertVideoFormat(inputPath, outputPath, options = {}) {
  const codec = options.codec || 'libx264'  // H.264 or libx265 for H.265
  const preset = options.preset || 'fast'    // ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow
  const bitrate = options.bitrate || '5000k'
  
  console.log(`🎥 Converting video with codec: ${codec}`)
  
  const args = [
    '-i', inputPath,
    '-c:v', codec,
    '-preset', preset,
    '-b:v', bitrate,
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-y',
    outputPath
  ]
  
  return runFFmpeg(args)
}

/**
 * Get video information with FFmpeg
 */
async function getVideoInfo(filePath) {
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-show_format',
    '-show_streams',
    '-print_format', 'json',
    filePath
  ]
  
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', args)
    let stdout = ''
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    
    proc.on('close', (code) => {
      if (code === 0) {
        try {
          const info = JSON.parse(stdout)
          resolve(info)
        } catch (e) {
          reject(new Error(`Failed to parse ffprobe output: ${e.message}`))
        }
      } else {
        reject(new Error(`ffprobe failed with code ${code}`))
      }
    })
    
    proc.on('error', (error) => {
      reject(new Error(`Failed to run ffprobe: ${error.message}`))
    })
  })
}

// Cleanup orphaned temp files on startup
function cleanupOldTempFiles() {
  try {
    const tempDir = tmpdir()
    const files = readdirSync(tempDir)
    const now = Date.now()
    const ONE_HOUR = 60 * 60 * 1000
    
    files.forEach(file => {
      if (file.startsWith('yt-dlp-')) {
        const filePath = join(tempDir, file)
        try {
          const stats = statSync(filePath)
          // Delete files older than 1 hour
          if (now - stats.mtime.getTime() > ONE_HOUR) {
            unlinkSync(filePath)
            console.log(`🧹 Cleaned up old temp file: ${file}`)
          }
        } catch (e) {}
      }
    })
  } catch (error) {
    console.warn('⚠️ Could not cleanup old temp files:', error.message)
  }
}

// Chrome profile rotation - daily
function getOrCreateChromeProfile() {
  try {
    const now = Date.now()
    
    // Check if we need to rotate profiles (24h rotation)
    if (now - lastProfileCleanup > PROFILE_ROTATION_INTERVAL) {
      console.log('🔄 Chrome profile rotation time - creating fresh profile')
      
      // Delete old profile
      if (currentChromeProfile) {
        try {
          execSync(`rm -rf "${join(CHROME_PROFILES_BASE, currentChromeProfile)}"`)
          console.log(`🗑️  Deleted old Chrome profile: ${currentChromeProfile}`)
        } catch (e) {}
      }
      
      currentChromeProfile = `profile-${Date.now()}`
      lastProfileCleanup = now
    }
    
    // Create profile directory if it doesn't exist
    if (!currentChromeProfile) {
      currentChromeProfile = `profile-${Date.now()}`
    }
    
    const profilePath = join(CHROME_PROFILES_BASE, currentChromeProfile)
    if (!existsSync(profilePath)) {
      mkdirSync(profilePath, { recursive: true })
      console.log(`✅ Created Chrome profile: ${currentChromeProfile}`)
    }
    
    return profilePath
  } catch (error) {
    console.error('❌ Error managing Chrome profile:', error)
    throw error
  }
}

// Clean up on startup
cleanupOldTempFiles()

// Check yt-dlp availability on startup
function checkYtDlpAvailability() {
  return new Promise((resolve) => {
    exec('which yt-dlp', (error, stdout) => {
      if (error) {
        console.warn('⚠️ yt-dlp not found in PATH')
        console.warn('   Try running: pip3 install --upgrade yt-dlp')
        resolve(false)
      } else {
        console.log(`✅ yt-dlp found at: ${stdout.trim()}`)
        exec('yt-dlp --version', (verError, verStdout) => {
          if (!verError) {
            console.log(`✅ yt-dlp version: ${verStdout.trim()}`)
          }
          resolve(true)
        })
      }
    })
  })
}

// Check FFmpeg availability on startup
function checkFFmpegAvailability() {
  return new Promise((resolve) => {
    exec('which ffmpeg', (error, stdout) => {
      if (error) {
        console.warn('⚠️ ffmpeg not found in PATH')
        console.warn('   This tool is required for video processing.')
        resolve(false)
      } else {
        console.log(`✅ ffmpeg found at: ${stdout.trim()}`)
        exec('ffmpeg -version 2>&1 | head -1', (verError, verStdout) => {
          if (!verError) {
            console.log(`✅ ${verStdout.trim()}`)
          }
          resolve(true)
        })
      }
    })
  })
}

// Check ffprobe availability on startup
function checkFFprobeAvailability() {
  return new Promise((resolve) => {
    exec('which ffprobe', (error, stdout) => {
      if (error) {
        console.warn('⚠️ ffprobe not found in PATH')
        console.warn('   This tool is required for video information extraction.')
        resolve(false)
      } else {
        console.log(`✅ ffprobe found at: ${stdout.trim()}`)
        resolve(true)
      }
    })
  })
}

/**
 * Extract video ID from YouTube URL
 * Supports:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 */
function extractVideoId(url) {
  if (!url) return null
  
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
  ]
  
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match && match[1]) {
      return match[1]
    }
  }
  
  return null
}

/**
 * Execute yt-dlp with robust retry logic for bot-protected videos
 * Uses exponential backoff and automatic browser cookie extraction to bypass restrictions
 */
async function getVideoInfo(videoUrl, retryCount = 0, delayMs = 1000) {
  return new Promise(async (resolve, reject) => {
    // Add exponential backoff delay before retry
    if (retryCount > 0) {
      console.log(`⏳ Retry #${retryCount} - Waiting ${delayMs}ms before attempting...`)
      await new Promise(r => setTimeout(r, delayMs))
    }
    
    // Build yt-dlp command - explicitly request JSON output for extraction
    let command = `yt-dlp -j --dump-single-json --quiet --no-warnings`
    
    // Use pre-warmed Chrome profile from environment (set by start.sh)
    // The profile is created and pre-warmed at startup, and yt-dlp can read directly from it
    if (useBrowserCookies && process.env.CHROME_PROFILE_DIR) {
      command += ` --cookies-from-browser "chromium:${process.env.CHROME_PROFILE_DIR}"`
      if (retryCount === 0) {
        console.log(`🔐 Using cookies from pre-warmed Chrome profile`)
      }
    } else if (hasCookies) {
      command += ` --cookies "${COOKIES_FILE}"`
      if (retryCount === 0) {
        console.log(`🔐 Using cookies from: ${COOKIES_FILE}`)
      }
    } else if (retryCount === 0) {
      console.log(`⚠️ No cookies available - attempting with geo-bypass`)
      command += ` --geo-bypass`
    }
    
    // Add URL
    command += ` "${videoUrl}"`
    
    let stdout = ''
    let stderr = ''
    
    exec(command, { maxBuffer: 50 * 1024 * 1024 }, async (error, out, err) => {
      stdout = out
      stderr = err
      
      // Check for bot-protection error
      const isBotProtected = stderr && stderr.includes('Sign in to confirm you\'re not a bot')
      const isGeoBocked = stderr && (stderr.includes('geo-blocked') || stderr.includes('not available in your country'))
      const isAgeRestricted = stderr && stderr.includes('age-restricted')
      const isLoginRequired = stderr && stderr.includes('Login required')
      
      // Log status
      if (error) {
        console.error(`⚠️ Attempt ${retryCount + 1} failed:`, stderr.substring(0, 150))
      }
      
      // Specific error cases
      if (isGeoBocked && retryCount < 2) {
        console.log(`🌍 Geo-blocked, retrying with geo-bypass...`)
        try {
          const result = await getVideoInfo(videoUrl, retryCount + 1, delayMs * 2)
          return resolve(result)
        } catch (retryError) {
          return reject(new Error('GEO_BLOCKED'))
        }
      }
      
      // Retry with exponential backoff if bot-protected and haven't exceeded retries
      if (isBotProtected && retryCount < 4) {
        const nextDelay = Math.min(delayMs * (2 ** retryCount), 16000) // Max 16s wait
        console.log(`🔄 Bot protection detected, retrying with ${nextDelay}ms delay...`)
        try {
          const result = await getVideoInfo(videoUrl, retryCount + 1, nextDelay)
          return resolve(result)
        } catch (retryError) {
          return reject(retryError)
        }
      }
      
      // If still bot-protected after retries, return specific error
      if (isBotProtected) {
        return reject(new Error('BOT_PROTECTED'))
      }
      
      // If age-restricted or login required
      if (isAgeRestricted) {
        return reject(new Error('AGE_RESTRICTED'))
      }
      
      if (isLoginRequired) {
        return reject(new Error('LOGIN_REQUIRED'))
      }
      
      // General error handling
      if (error && !stdout) {
        return reject(new Error(stderr.substring(0, 300) || error.message))
      }
      
      // Try to parse the output - handle trailing non-JSON content
      try {
        let jsonStr = stdout.trim()
        
        // If there's trailing non-JSON content, find the last closing brace
        if (!jsonStr.startsWith('{')) {
          const firstBrace = jsonStr.indexOf('{')
          if (firstBrace !== -1) {
            jsonStr = jsonStr.substring(firstBrace)
          }
        }
        
        // Find the complete JSON object by counting braces
        let braceCount = 0
        let jsonEnd = -1
        for (let i = 0; i < jsonStr.length; i++) {
          if (jsonStr[i] === '{') braceCount++
          else if (jsonStr[i] === '}') {
            braceCount--
            if (braceCount === 0) {
              jsonEnd = i + 1
              break
            }
          }
        }
        
        if (jsonEnd !== -1) {
          jsonStr = jsonStr.substring(0, jsonEnd)
        }
        
        const data = JSON.parse(jsonStr)
        if (retryCount > 0) {
          console.log(`✅ Success after ${retryCount} retry attempt(s)`)
        }
        resolve(data)
      } catch (parseError) {
        console.error(`📝 Raw output preview:`, stdout.substring(0, 200))
        reject(new Error(`Failed to parse yt-dlp output: ${parseError.message}`))
      }
    })
  })
}

/**
 * Transform yt-dlp format data to our API format
 */
function transformFormats(ytdlpData) {
  if (!ytdlpData.formats || !Array.isArray(ytdlpData.formats)) {
    return { videoFormats: [], audioFormats: [] }
  }

  const videoFormats = []
  const audioFormats = []
  const audioTracksMap = new Map()

  ytdlpData.formats.forEach(format => {
    // Skip formats without URL (not downloadable)
    if (!format.url && !format.fragment_base_url) {
      return
    }

    const formatObj = {
      format_id: format.format_id || String(format.itag || format.format),
      ext: format.ext || 'unknown',
      format_note: format.format_note || format.height ? `${format.height}p` : 'Unknown',
      filesize: format.filesize || null,
      fps: format.fps || null,
      video_codec: format.vcodec && format.vcodec !== 'none' ? format.vcodec : undefined,
      audio_codec: format.acodec && format.acodec !== 'none' ? format.acodec : undefined,
      url: format.url || format.fragment_base_url || null,
      width: format.width || null,
      height: format.height || null,
      tbr: format.tbr || null, // Total bitrate
      vbr: format.vbr || null, // Video bitrate
      abr: format.abr || null, // Audio bitrate
      asr: format.asr || null, // Audio sample rate
      protocol: format.protocol || null,
      language: format.language || null,
      format: format.format || null,
    }

    // Categorize as video or audio
    const hasVideo = format.vcodec && format.vcodec !== 'none'
    const hasAudio = format.acodec && format.acodec !== 'none'

    if (hasVideo) {
      formatObj.hasVideo = true
      formatObj.hasAudio = hasAudio
      videoFormats.push(formatObj)
    } else if (hasAudio) {
      formatObj.hasAudio = true
      formatObj.hasVideo = false
      audioFormats.push(formatObj)

      // Track unique audio formats by language
      const language = format.language || 'Default'
      if (!audioTracksMap.has(language)) {
        audioTracksMap.set(language, {
          language: language,
          language_code: format.language_code || format.language || 'default',
          format_ids: [],
        })
      }
      audioTracksMap.get(language).format_ids.push(formatObj.format_id)
    }
  })

  const audioTracks = Array.from(audioTracksMap.values()).map((track, index) => ({
    ...track,
    format_id: index.toString(),
  }))

  if (audioTracks.length === 0 && audioFormats.length > 0) {
    audioTracks.push({
      language: 'Default',
      language_code: 'default',
      format_id: '0',
      format_ids: audioFormats.map(f => f.format_id),
    })
  }

  return {
    videoFormats: videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0)), // Sort by height descending
    audioFormats: audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0)), // Sort by bitrate descending
    audioTracks,
  }
}

/**
 * Get subtitle tracks from yt-dlp data
 */
function getSubtitleTracks(ytdlpData) {
  if (!ytdlpData.subtitles || typeof ytdlpData.subtitles !== 'object') {
    return []
  }

  const tracks = []
  let index = 0

  for (const [langCode, subs] of Object.entries(ytdlpData.subtitles)) {
    if (Array.isArray(subs) && subs.length > 0) {
      tracks.push({
        language: langCode,
        language_code: langCode,
        format_id: index.toString(),
        url: subs[0].url || null,
      })
      index++
    }
  }

  return tracks
}

const server = createServer(async (req, res) => {
  // Determine allowed origin(s)
  let corsOrigin = '*'
  if (ALLOWED_ORIGINS !== '*') {
    const origins = ALLOWED_ORIGINS.split(',').map(o => o.trim())
    const requestOrigin = req.headers.origin || '*'
    if (origins.includes(requestOrigin) || ALLOWED_ORIGINS === '*') {
      corsOrigin = requestOrigin
    } else if (origins.includes('*')) {
      corsOrigin = '*'
    }
  }

  // CORS headers with dynamic origin
  const corsHeaders = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders)
    res.end()
    return
  }

  const url = new URL(req.url || '', `http://${req.headers.host}`)
  console.log(`📍 ${req.method} ${url.pathname}`)

  // Extract endpoint
  if (url.pathname === '/extract') {
    const clientIP = getClientIP(req)
    
    // Check rate limit
    const rateLimitCheck = isRateLimited(clientIP, 'extract')
    if (rateLimitCheck.limited) {
      console.warn(`⏱️  Rate limit: ${rateLimitCheck.reason} from ${clientIP}`)
      res.writeHead(429, { 
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': rateLimitCheck.retryAfter
      })
      res.end(JSON.stringify({ 
        error: 'Too many requests. Please wait before trying again.',
        reason: rateLimitCheck.reason,
        retryAfter: rateLimitCheck.retryAfter
      }))
      return
    }
    
    const videoUrl = url.searchParams.get('url')

    // Validate URL parameter
    const urlValidation = validateURL(videoUrl)
    if (!urlValidation.valid) {
      res.writeHead(400, { 
        ...corsHeaders,
        'Content-Type': 'application/json' 
      })
      res.end(JSON.stringify({ error: urlValidation.error }))
      return
    }

    try {
      console.log(`📥 Extracting video info from: ${videoUrl} (IP: ${clientIP})`)
      
      // Use yt-dlp to get video info
      const ytdlpData = await getVideoInfo(videoUrl)

      if (!ytdlpData) {
        throw new Error('Failed to get video information from yt-dlp')
      }

      // Extract video ID for consistency
      const videoId = extractVideoId(videoUrl)

      // Transform formats
      const { videoFormats, audioFormats, audioTracks } = transformFormats(ytdlpData)
      const subtitleTracks = getSubtitleTracks(ytdlpData)

      console.log(`✅ Successfully extracted video: ${ytdlpData.title || 'Unknown'}`)
      console.log(`  - Video formats: ${videoFormats.length}`)
      console.log(`  - Audio formats: ${audioFormats.length}`)
      console.log(`  - Subtitle tracks: ${subtitleTracks.length}`)

      // Check if no formats are available
      if (videoFormats.length === 0 && audioFormats.length === 0) {
        console.warn('⚠️ No formats available for this video')
        const errorMessage = 'This video is not available for download (no compatible formats found). Please try another video.'
        
        res.writeHead(400, { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        })
        res.end(JSON.stringify({
          error: errorMessage,
          details: {
            videoId: videoId,
            url: videoUrl,
          }
        }))
        return
      }

      res.writeHead(200, { 
        ...corsHeaders,
        'Content-Type': 'application/json' 
      })
      res.end(JSON.stringify({
        id: ytdlpData.id || videoId || '',
        title: ytdlpData.title || 'Unknown',
        thumbnail: ytdlpData.thumbnail || null,
        duration: ytdlpData.duration || 0,
        formats: [...videoFormats, ...audioFormats],
        subtitle_tracks: subtitleTracks,
        audio_tracks: audioTracks,
        webpage_url: videoUrl,
        platform: 'youtube',
        description: ytdlpData.description || null,
        uploader: ytdlpData.uploader || ytdlpData.channel || null,
        view_count: ytdlpData.view_count || null,
      }))
    } catch (error) {
      console.error('❌ Error:', error.message)
      
      // Check for specific errors and return appropriate messages
      let errorMessage = 'Failed to fetch video information'
      let statusCode = 500
      
      if (error.message === 'BOT_PROTECTED') {
        console.warn('⚠️ Video is protected by YouTube bot detection')
        errorMessage = '🤖 YouTube is blocking this request. Try again in a few seconds, or try a different video.'
        statusCode = 400
      } else if (error.message === 'GEO_BLOCKED') {
        console.warn('⚠️ Video is geo-blocked')
        errorMessage = '🌍 This video is not available in your region.'
        statusCode = 400
      } else if (error.message === 'AGE_RESTRICTED') {
        console.warn('⚠️ Video is age-restricted')
        errorMessage = '18+ Age restriction detected. YouTube requires manual verification for this content.'
        statusCode = 400
      } else if (error.message === 'LOGIN_REQUIRED') {
        console.warn('⚠️ Video requires login')
        errorMessage = '🔒 This video requires YouTube account login. Please log in to YouTube and try again.'
        statusCode = 400
      } else if (error.message.includes('Requested format is not available')) {
        console.warn('⚠️ No compatible formats found')
        errorMessage = 'This video is unavailable for download (no compatible formats found). This usually means the video is age-restricted, region-blocked, or has special restrictions.'
        statusCode = 400
      } else {
        errorMessage = error instanceof Error ? error.message : 'Failed to fetch video information'
      }
      
      res.writeHead(statusCode, { 
        ...corsHeaders,
        'Content-Type': 'application/json' 
      })
      res.end(JSON.stringify({
        error: errorMessage,
      }))
    }
    return
  }

  // Download format endpoint - stream video directly
  if (url.pathname === '/download' && req.method === 'GET') {
    const clientIP = getClientIP(req)
    
    // Check rate limit
    const rateLimitCheck = isRateLimited(clientIP, 'download')
    if (rateLimitCheck.limited) {
      console.warn(`⏱️  Rate limit: ${rateLimitCheck.reason} from ${clientIP}`)
      res.writeHead(429, { 
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': rateLimitCheck.retryAfter
      })
      res.end(JSON.stringify({ 
        error: 'Too many download requests. Please wait before trying again.',
        reason: rateLimitCheck.reason,
        retryAfter: rateLimitCheck.retryAfter
      }))
      return
    }
    
    const queryParams = new URL(req.url, `http://${req.headers.host}`).searchParams
    const videoUrl = queryParams.get('url')
    const formatId = queryParams.get('format')

    // Validate parameters
    const urlValidation = validateURL(videoUrl)
    if (!urlValidation.valid) {
      res.writeHead(400, { 
        ...corsHeaders,
        'Content-Type': 'application/json' 
      })
      res.end(JSON.stringify({ error: urlValidation.error }))
      return
    }
    
    const formatValidation = validateFormatID(formatId)
    if (!formatValidation.valid) {
      res.writeHead(400, { 
        ...corsHeaders,
        'Content-Type': 'application/json' 
      })
      res.end(JSON.stringify({ error: formatValidation.error }))
      return
    }

    // Check concurrent download limit
    if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
      console.warn(`⚠️ Download queue full (${activeDownloads}/${MAX_CONCURRENT_DOWNLOADS})`)
      res.writeHead(429, { 
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': '10'
      })
      res.end(JSON.stringify({ 
        error: 'Too many downloads in progress. Please wait a moment and try again.',
        activeDownloads,
        maxConcurrent: MAX_CONCURRENT_DOWNLOADS
      }))
      return
    }

    activeDownloads++
    console.log(`📊 Active downloads: ${activeDownloads}/${MAX_CONCURRENT_DOWNLOADS}`)

    try {
      console.log(`📥 Downloading format ${formatId} from: ${videoUrl} (IP: ${clientIP})`)

      // Prepare cookie flags for yt-dlp
      let cookieFlags = []
      if (useBrowserCookies && process.env.CHROME_PROFILE_DIR) {
        // Use --cookies-from-browser to let yt-dlp read directly from Chromium's SQLite database
        cookieFlags = ['--cookies-from-browser', `chromium:${process.env.CHROME_PROFILE_DIR}`]
        console.log(`🔐 Using cookies from pre-warmed Chrome profile: ${process.env.CHROME_PROFILE_DIR}`)
      } else if (hasCookies) {
        console.log(`🔐 Using cookies from frontend...`)
        cookieFlags = ['--cookies', COOKIES_FILE]
      } else {
        console.log(`🌍 No cookies - using geo-bypass...`)
        cookieFlags = ['--geo-bypass']
      }

      // Create temporary file path for this download
      const tempDir = tmpdir()
      const tempFileName = `yt-dlp-${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`
      const tempFilePath = join(tempDir, tempFileName)
      
      console.log(`💾 Temp file: ${tempFilePath}`)

      // Build yt-dlp command to save to file instead of stdout
      const ytdlpArgs = ['-f', formatId, '--no-warnings', '-o', tempFilePath, videoUrl, ...cookieFlags]
      
      // Add PO Token support for YouTube bot detection bypass
      // This uses the mweb client which requires PO Token for GVS (video streaming)
      ytdlpArgs.push('--extractor-args')
      ytdlpArgs.push('youtube:player-client=mweb')

      const proc = spawn('yt-dlp', ytdlpArgs)
      let stderrOutput = ''
      const startTime = Date.now()
      const TIMEOUT_MS = 1200000 // 20 minutes
      let responseSent = false

      proc.stderr.on('data', (chunk) => {
        const message = chunk.toString().trim()
        stderrOutput += message + '\n'
        // Log all yt-dlp output for visibility
        if (message) {
          console.log(`[yt-dlp] ${message}`)
          
          // Parse progress from yt-dlp: "[download]  45.5% of ~150.00MiB at 2.34MiB/s ETA 01:05"
          if (message.includes('[download]')) {
            const progressMatch = message.match(/(\d+(?:\.\d+)?)%/)
            const etaMatch = message.match(/ETA\s+(\d+:\d+)/)
            if (progressMatch) {
              const percentage = Math.min(100, parseFloat(progressMatch[1]))
              downloadProgress.set(formatId, {
                progress: percentage,
                stage: 'Downloading',
                eta: etaMatch ? etaMatch[1] : 'Unknown',
                message: message.substring(0, 100)
              })
            }
          }
        }
      })

      proc.on('close', (code) => {
        clearTimeout(timeoutHandle)
        activeDownloads--
        downloadProgress.delete(formatId)
        console.log(`📊 Active downloads after close: ${activeDownloads}/${MAX_CONCURRENT_DOWNLOADS}`)
        
        if (responseSent) return
        
        if (code === 0) {
          console.log(`✅ yt-dlp completed`)
          
          // Validate file exists and has content
          if (!existsSync(tempFilePath)) {
            console.error(`❌ Temp file not found: ${tempFilePath}`)
            responseSent = true
            res.writeHead(500, { 
              ...corsHeaders,
              'Content-Type': 'application/json' 
            })
            res.end(JSON.stringify({ error: 'Video file not created' }))
            return
          }

          const fileStats = statSync(tempFilePath)
          const fileSize = fileStats.size
          
          console.log(`📊 Downloaded file size: ${(fileSize / 1024 / 1024).toFixed(2)}MB`)

          if (fileSize < 5000) {
            console.error(`❌ Downloaded file too small: ${fileSize} bytes`)
            try { unlinkSync(tempFilePath) } catch (e) {}
            responseSent = true
            res.writeHead(500, { 
              ...corsHeaders,
              'Content-Type': 'application/json' 
            })
            res.end(JSON.stringify({ error: 'Downloaded file too small - may be incomplete' }))
            return
          }

          // Read and send the complete file
          try {
            const fileData = readFileSync(tempFilePath)
            
            responseSent = true
            res.writeHead(200, {
              ...corsHeaders,
              'Content-Type': 'application/octet-stream',
              'Content-Length': fileSize,
              'Cache-Control': 'public, max-age=3600',
              'X-Format-Id': formatId,
            })
            
            res.end(fileData)
            
            console.log(`✅ Successfully sent ${(fileSize / 1024 / 1024).toFixed(2)}MB to client`)
            
            // Clean up temp file after successful send
            setImmediate(() => {
              try { 
                unlinkSync(tempFilePath)
                console.log(`🧹 Cleaned up temp file`)
              } catch (e) {}
            })
          } catch (error) {
            console.error(`❌ Error reading/sending file: ${error.message}`)
            responseSent = true
            res.writeHead(500, { 
              ...corsHeaders,
              'Content-Type': 'application/json' 
            })
            res.end(JSON.stringify({ error: 'Error sending file' }))
            try { unlinkSync(tempFilePath) } catch (e) {}
          }
        } else {
          console.error(`❌ yt-dlp exited with code ${code}`)
          console.error(`stderr: ${stderrOutput.substring(0, 500)}`)
          responseSent = true
          res.writeHead(500, { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          })
          res.end(JSON.stringify({ error: 'yt-dlp failed to download video' }))
          try { unlinkSync(tempFilePath) } catch (e) {}
        }
      })

      proc.on('error', (error) => {
        if (responseSent) return
        clearTimeout(timeoutHandle)
        activeDownloads--
        downloadProgress.delete(formatId)
        console.error('❌ Spawn error:', error.message)
        responseSent = true
        res.writeHead(500, { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        })
        res.end(JSON.stringify({ error: 'Failed to start download process' }))
        try { unlinkSync(tempFilePath) } catch (e) {}
      })

      // Set process timeout - 20 minutes for large 4K videos
      const timeoutHandle = setTimeout(() => {
        if (responseSent) return
        console.error(`❌ Download timeout (20 minutes)`)
        proc.kill('SIGTERM')
        activeDownloads--
        downloadProgress.delete(formatId)
        responseSent = true
        res.writeHead(500, { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        })
        res.end(JSON.stringify({ error: 'Download timeout - video took too long' }))
        try { unlinkSync(tempFilePath) } catch (e) {}
      }, TIMEOUT_MS)

    } catch (error) {
      console.error('❌ Download error:', error.message)
      res.writeHead(500, { 
        ...corsHeaders,
        'Content-Type': 'application/json' 
      })
      res.end(JSON.stringify({
        error: 'Download failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }))
    }
    return
  }

  // Progress streaming endpoint - Server-Sent Events for real-time download status
  if (url.pathname === '/api/progress' && req.method === 'GET') {
    const formatId = url.searchParams.get('format')
    
    if (!formatId) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'format parameter is required' }))
      return
    }

    // Set SSE headers
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    // Send initial message
    res.write('data: ' + JSON.stringify({ progress: 0, stage: 'Waiting...', eta: 'Unknown' }) + '\n\n')

    // Poll for progress updates
    const pollInterval = setInterval(() => {
      const progress = downloadProgress.get(formatId)
      if (progress) {
        res.write('data: ' + JSON.stringify(progress) + '\n\n')
      }
    }, 500) // Update every 500ms

    // Stop polling when client disconnects
    req.on('close', () => {
      clearInterval(pollInterval)
      downloadProgress.delete(formatId)
      res.end()
    })
    return
  }

  // Cookies upload endpoint - receive cookies from browser and save to file
  if (url.pathname === '/api/cookies' && req.method === 'POST') {
    let body = ''
    
    req.on('data', chunk => {
      body += chunk.toString()
    })
    
    req.on('end', async () => {
      try {
        const data = JSON.parse(body)
        const { cookies } = data
        
        if (!cookies || typeof cookies !== 'string') {
          res.writeHead(400, { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          })
          res.end(JSON.stringify({
            error: 'Invalid cookies format',
            message: 'Cookies must be a string in Netscape cookies.txt format'
          }))
          return
        }
        
        // Ensure .yt-dlp directory exists
        const cookieDir = dirname(COOKIES_FILE)
        if (!existsSync(cookieDir)) {
          mkdirSync(cookieDir, { recursive: true })
        }
        
        // Write cookies to file
        writeFileSync(COOKIES_FILE, cookies, 'utf-8')
        
        console.log(`🔐 Cookies saved from browser: ${COOKIES_FILE}`)
        console.log(`📊 Cookie count: ${cookies.split('\n').filter(l => l.trim() && !l.startsWith('#')).length}`)
        
        res.writeHead(200, { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        })
        res.end(JSON.stringify({
          status: 'success',
          message: 'Cookies saved successfully',
          path: COOKIES_FILE
        }))
      } catch (error) {
        console.error('❌ Error saving cookies:', error.message)
        res.writeHead(500, { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        })
        res.end(JSON.stringify({
          error: 'Failed to save cookies',
          message: error instanceof Error ? error.message : 'Unknown error'
        }))
      }
    })
    return
  }

  // Enable browser cookies endpoint - receive cookies from frontend
  if (url.pathname === '/api/enable-cookies' && req.method === 'POST') {
    let body = ''
    
    req.on('data', chunk => {
      body += chunk.toString()
    })
    
    req.on('end', async () => {
      try {
        const data = JSON.parse(body)
        const { cookies } = data
        
        if (!cookies || typeof cookies !== 'string') {
          // If no cookies provided, just enable the flag for browser-based extraction
          useBrowserCookies = true
          res.writeHead(200, { 
            ...corsHeaders,
            'Content-Type': 'application/json' 
          })
          res.end(JSON.stringify({
            status: 'success',
            message: 'Browser cookies enabled.'
          }))
          return
        }
        
        // Cookies were sent from frontend - save to file
        const cookieDir = dirname(COOKIES_FILE)
        if (!existsSync(cookieDir)) {
          mkdirSync(cookieDir, { recursive: true })
        }
        
        // Write cookies to file
        writeFileSync(COOKIES_FILE, cookies, 'utf-8')
        useBrowserCookies = false  // Use file-based cookies since we have them
        
        console.log(`🔐 Cookies received from frontend and saved.`)
        console.log(`📊 Cookie count: ${cookies.split('\n').filter(l => l.trim() && !l.startsWith('#')).length}`)
        
        res.writeHead(200, { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        })
        res.end(JSON.stringify({
          status: 'success',
          message: 'Cookies received and saved. Downloads will now bypass bot detection.'
        }))
      } catch (error) {
        console.error('❌ Error handling cookies:', error.message)
        res.writeHead(500, { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        })
        res.end(JSON.stringify({
          error: 'Failed to save cookies',
          message: error instanceof Error ? error.message : 'Unknown error'
        }))
      }
    })
    return
  }

  // Health check endpoint
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, async () => {
  console.log(`✅ API server running on http://localhost:${PORT}`)
  console.log('📊 Using yt-dlp backend (supports all YouTube formats)')
  
  // Check yt-dlp availability
  const ytDlpAvailable = await checkYtDlpAvailability()
  if (!ytDlpAvailable) {
    console.error('❌ CRITICAL: yt-dlp is not available!')
    console.error('   Video extraction will fail.')
    console.error('   Render deployment: Check build command in render.yaml')
    console.error('   Local deployment: Run: pip3 install --upgrade yt-dlp')
  }
  
  // Check FFmpeg availability
  const ffmpegAvailable = await checkFFmpegAvailability()
  if (!ffmpegAvailable) {
    console.error('❌ CRITICAL: ffmpeg is not available!')
    console.error('   Video processing will fail.')
    console.error('   Render deployment: Check build command in render.yaml')
    console.error('   Local deployment: Run: brew install ffmpeg')
  }

  // Check ffprobe availability
  const ffprobeAvailable = await checkFFprobeAvailability()
  if (!ffprobeAvailable) {
    console.error('❌ CRITICAL: ffprobe is not available!')
    console.error('   Video information extraction will fail.')
    console.error('   Render deployment: Check build command in render.yaml')
    console.error('   Local deployment: Run: brew install ffprobe')
  }
  
  console.log('Ready to accept requests!')
})

