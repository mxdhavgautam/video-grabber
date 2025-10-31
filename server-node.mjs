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

// Flag to enable automatic browser cookie extraction
let useBrowserCookies = hasCookies

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

// Clean up on startup
cleanupOldTempFiles()

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
    let command = `yt-dlp -j --dump-single-json`
    
    // Add cookies - prefer browser extraction, fallback to file
    if (useBrowserCookies) {
      command += ` --cookies-from-browser chrome`
      if (retryCount === 0) {
        console.log(`🔐 Using cookies from browser (Chrome)`)
      }
    } else if (hasCookies) {
      command += ` --cookies "${COOKIES_FILE}"`
      if (retryCount === 0) {
        console.log(`🔐 Using cookies from: ${COOKIES_FILE}`)
      }
    } else if (retryCount === 0) {
      console.log(`⚠️ No cookies available - some videos may be blocked by bot detection`)
    }
    
    // Add URL
    command += ` "${videoUrl}"`
    
    let stdout = ''
    let stderr = ''
    
    exec(command, { maxBuffer: 10 * 1024 * 1024 }, async (error, out, err) => {
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
      
      // Try to parse the output
      try {
        const data = JSON.parse(stdout)
        if (retryCount > 0) {
          console.log(`✅ Success after ${retryCount} retry attempt(s)`)
        }
        resolve(data)
      } catch (parseError) {
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

    // CRITICAL: Skip AV1 codecs - browser FFmpeg WASM cannot decode AV1
    // AV1 support in WebAssembly is limited and causes errors like "Error while decoding stream"
    // Only H.264 and VP9 are reliably supported in browser FFmpeg
    if (format.vcodec && (format.vcodec.toLowerCase().includes('av1') || format.vcodec.toLowerCase().includes('av01'))) {
      console.log(`⏭️  Skipping AV1 format ${format.format_id} - not supported by browser FFmpeg`)
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
    const videoUrl = url.searchParams.get('url')

    if (!videoUrl) {
      res.writeHead(400, { 
        ...corsHeaders,
        'Content-Type': 'application/json' 
      })
      res.end(JSON.stringify({ error: 'URL parameter is required' }))
      return
    }

    // Only support YouTube (basic regex validation)
    if (!/https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(videoUrl)) {
      res.writeHead(400, { 
        ...corsHeaders,
        'Content-Type': 'application/json' 
      })
      res.end(JSON.stringify({ error: 'Invalid YouTube URL' }))
      return
    }

    try {
      console.log(`📥 Extracting video info from: ${videoUrl}`)
      
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
    const queryParams = new URL(req.url, `http://${req.headers.host}`).searchParams
    const videoUrl = queryParams.get('url')
    const formatId = queryParams.get('format')

    if (!videoUrl || !formatId) {
      res.writeHead(400, { 
        ...corsHeaders,
        'Content-Type': 'application/json' 
      })
      res.end(JSON.stringify({ error: 'url and format parameters are required' }))
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
      console.log(`📥 Downloading format ${formatId} from: ${videoUrl}`)

      // Build cookie flags - ONLY use file-based cookies, never --cookies-from-browser on server
      let cookieFlags = []
      if (hasCookies) {
        console.log(`🔐 Using cookies from frontend...`)
        cookieFlags = ['--cookies', COOKIES_FILE]
      } else {
        console.log(`🔐 No cookies - trying without...`)
      }

      // Create temporary file path for this download
      const tempDir = tmpdir()
      const tempFileName = `yt-dlp-${Date.now()}-${Math.random().toString(36).substring(7)}.mp4`
      const tempFilePath = join(tempDir, tempFileName)
      
      console.log(`💾 Temp file: ${tempFilePath}`)

      // Build yt-dlp command to save to file instead of stdout
      const ytdlpArgs = ['-f', formatId, '--no-warnings', '-o', tempFilePath, videoUrl, ...cookieFlags]

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

server.listen(PORT, () => {
  console.log(`✅ API server running on http://localhost:${PORT}`)
  console.log('📊 Using yt-dlp backend (supports all YouTube formats)')
  console.log('Ready to accept requests!')
})

