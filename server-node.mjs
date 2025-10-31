import { createServer } from 'http'
import { exec, spawn } from 'child_process'
import { promisify as _promisify } from 'util'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { existsSync } from 'fs'
import { join } from 'path'

const execPromise = _promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = process.env.PORT || 3001
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*'

// Path to cookies file (can be provided as environment variable)
const COOKIES_FILE = process.env.COOKIES_FILE || join(__dirname, '.yt-dlp', 'cookies.txt')
const hasCookies = existsSync(COOKIES_FILE)

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
 * Uses exponential backoff and server-side mechanisms to bypass restrictions
 */
async function getVideoInfo(videoUrl, retryCount = 0, delayMs = 1000) {
  return new Promise(async (resolve, reject) => {
    // Add exponential backoff delay before retry
    if (retryCount > 0) {
      console.log(`⏳ Retry #${retryCount} - Waiting ${delayMs}ms before attempting...`)
      await new Promise(r => setTimeout(r, delayMs))
    }
    
    // Build yt-dlp command using config file
      // Config file at ~/.yt-dlp/config provides optimal settings
    let command = `yt-dlp -j --config-location ~/.yt-dlp/config`
    
    // Add cookies if available
    if (hasCookies) {
      command += ` --cookies "${COOKIES_FILE}"`
      if (retryCount === 0) {
        console.log(`🔐 Using cookies from: ${COOKIES_FILE}`)
      }
    } else if (retryCount === 0) {
      console.log(`⚠️ No cookies file found at ${COOKIES_FILE}`)
      console.log(`📝 To use cookies, export them from your browser:`)
      console.log(`   1. Use browser extension "Get cookies.txt LOCALLY" (Chrome) or "cookies.txt" (Firefox)`)
      console.log(`   2. Save as: ${COOKIES_FILE}`)
      console.log(`   3. Restart server for changes to take effect`)
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

  // Download proxy
  if (url.pathname === '/download') {
    const videoUrl = url.searchParams.get('url')
    const formatId = url.searchParams.get('format')

    if (!videoUrl || !formatId) {
      res.writeHead(400, { 
        ...corsHeaders,
        'Content-Type': 'application/json' 
      })
      res.end(JSON.stringify({ error: 'url and format parameters are required' }))
      return
    }

    try {
      console.log(`📥 Downloading format ${formatId} from: ${videoUrl}`)

      // First, get the file size using yt-dlp --print-json
      exec(`yt-dlp -f "${formatId}" --print-json -o - "${videoUrl}" 2>/dev/null | head -c 1 > /dev/null && yt-dlp -f "${formatId}" --simulate --dump-json "${videoUrl}" 2>/dev/null`, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        try {
          const videoInfo = JSON.parse(stdout)
          const selectedFormat = videoInfo.formats?.find(f => f.format_id === formatId)
          const fileSize = selectedFormat?.filesize || selectedFormat?.filesize_approx || 0

          // Use spawn to stream the actual video data
          const proc = spawn('yt-dlp', ['-f', formatId, '--no-warnings', '-o', '-', videoUrl])

          let sentBytes = 0
          const headers = {
            ...corsHeaders,
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'public, max-age=3600',
            'X-Format-Id': formatId,
          }
          
          // Add Content-Length if we know the file size
          if (fileSize > 0) {
            headers['Content-Length'] = fileSize.toString()
          }

          res.writeHead(200, headers)

          let totalBytes = 0
          let errorOccurred = false

          // Stream stdout directly to response
          proc.stdout.on('data', (chunk) => {
            totalBytes += chunk.length
            sentBytes += chunk.length
            res.write(chunk)
          })

          proc.stderr.on('data', (chunk) => {
            const message = chunk.toString()
            if (!message.includes('WARNING') && message.trim()) {
              console.warn(`yt-dlp stderr: ${message}`)
            }
          })

          proc.on('close', (code) => {
            if (code === 0) {
              console.log(`✅ Successfully downloaded ${totalBytes} bytes for format ${formatId}`)
              res.end()
            } else if (!errorOccurred) {
              console.error(`❌ yt-dlp exited with code ${code}`)
              if (!res.headersSent) {
                res.writeHead(500, { 
                  ...corsHeaders,
                  'Content-Type': 'application/json' 
                })
              }
              if (!res.writableEnded) {
                res.end(JSON.stringify({
                  error: 'Download failed',
                  message: `yt-dlp process exited with code ${code}`,
                }))
              }
            }
          })

          proc.on('error', (error) => {
            errorOccurred = true
            console.error('❌ Spawn error:', error.message)
            if (!res.headersSent) {
              res.writeHead(500, { 
                ...corsHeaders,
                'Content-Type': 'application/json' 
              })
            }
            if (!res.writableEnded) {
              res.end(JSON.stringify({
                error: 'Download failed',
                message: error.message,
              }))
            }
          })
        } catch (parseError) {
          console.warn('Could not get file size info:', parseError.message)
          
          // Fallback: stream without Content-Length
          const proc = spawn('yt-dlp', ['-f', formatId, '--no-warnings', '-o', '-', videoUrl])

          res.writeHead(200, {
            ...corsHeaders,
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'public, max-age=3600',
            'X-Format-Id': formatId,
          })

          let totalBytes = 0
          let errorOccurred = false

          proc.stdout.on('data', (chunk) => {
            totalBytes += chunk.length
            res.write(chunk)
          })

          proc.stderr.on('data', (chunk) => {
            const message = chunk.toString()
            if (!message.includes('WARNING') && message.trim()) {
              console.warn(`yt-dlp stderr: ${message}`)
            }
          })

          proc.on('close', (code) => {
            if (code === 0) {
              console.log(`✅ Successfully downloaded ${totalBytes} bytes for format ${formatId}`)
              res.end()
            } else if (!errorOccurred) {
              console.error(`❌ yt-dlp exited with code ${code}`)
              if (!res.headersSent) {
                res.writeHead(500, { 
                  ...corsHeaders,
                  'Content-Type': 'application/json' 
                })
              }
              if (!res.writableEnded) {
                res.end(JSON.stringify({
                  error: 'Download failed',
                  message: `yt-dlp process exited with code ${code}`,
                }))
              }
            }
          })

          proc.on('error', (error) => {
            errorOccurred = true
            console.error('❌ Spawn error:', error.message)
            if (!res.headersSent) {
              res.writeHead(500, { 
                ...corsHeaders,
                'Content-Type': 'application/json' 
              })
            }
            if (!res.writableEnded) {
              res.end(JSON.stringify({
                error: 'Download failed',
                message: error.message,
              }))
            }
          })
        }
      })
      return
    } catch (error) {
      console.error('❌ Download error:', error.message)
      if (!res.headersSent) {
        res.writeHead(500, { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        })
      }
      res.end(JSON.stringify({
        error: 'Download failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      }))
    }
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

