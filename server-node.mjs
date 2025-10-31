import { createServer } from 'http'
import { exec, spawn } from 'child_process'
import { promisify as _promisify } from 'util'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { existsSync, writeFileSync, mkdirSync, readFileSync, unlinkSync, statSync, readdirSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { tmpdir } from 'os'
import { URL } from 'url'

const execPromise = _promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = process.env.PORT || 3001
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['*']
const CHROME_PROFILE_DIR = process.env.CHROME_PROFILE_DIR || join(__dirname, 'chrome-profiles')

// Concurrent download limit
let activeDownloads = 0
const MAX_CONCURRENT_DOWNLOADS = 3

// Progress tracking
const downloadProgress = new Map()

// Chrome profile management
const CHROME_PROFILES_BASE = CHROME_PROFILE_DIR
let currentChromeProfile = null
let lastProfileCleanup = Date.now()
const PROFILE_ROTATION_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours

// Cleanup old temp files
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

// Periodic cleanup of temp files every 30 minutes
function startPeriodicCleanup() {
  const CLEANUP_INTERVAL = 30 * 60 * 1000 // 30 minutes
  
  setInterval(() => {
    try {
      const tempDir = tmpdir()
      const files = readdirSync(tempDir)
      const now = Date.now()
      const THIRTY_MINUTES = 30 * 60 * 1000
      let cleaned = 0
      
      files.forEach(file => {
        if (file.startsWith('yt-dlp-')) {
          const filePath = join(tempDir, file)
          try {
            const stats = statSync(filePath)
            // Delete files older than 30 minutes
            if (now - stats.mtime.getTime() > THIRTY_MINUTES) {
              unlinkSync(filePath)
              cleaned++
            }
          } catch (e) {}
        }
      })
      
      if (cleaned > 0) {
        console.log(`🧹 Periodic cleanup: Deleted ${cleaned} temp file(s)`)
      }
    } catch (error) {
      console.warn('⚠️ Periodic cleanup failed:', error.message)
    }
  }, CLEANUP_INTERVAL)
}

cleanupOldTempFiles()

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

// Check tool availability
function checkTools() {
  return new Promise((resolve) => {
    const tools = []
    let checked = 0
    
    exec('which yt-dlp', (error, stdout) => {
      if (!error) {
        tools.push(`✅ yt-dlp: ${stdout.trim()}`)
      } else {
        tools.push(`❌ yt-dlp: NOT FOUND`)
      }
      checked++
      if (checked === 3) logTools()
    })
    
    exec('which ffmpeg', (error, stdout) => {
      if (!error) {
        tools.push(`✅ ffmpeg: ${stdout.trim()}`)
      } else {
        tools.push(`❌ ffmpeg: NOT FOUND`)
      }
      checked++
      if (checked === 3) logTools()
    })
    
    exec('which chromium-browser', (error, stdout) => {
      if (!error) {
        tools.push(`✅ chromium-browser: ${stdout.trim()}`)
      } else {
        tools.push(`❌ chromium-browser: NOT FOUND`)
      }
      checked++
      if (checked === 3) logTools()
    })
    
    function logTools() {
      tools.forEach(tool => console.log(tool))
      resolve(tools.every(t => t.startsWith('✅')))
    }
  })
}

/**
 * Extract video ID from YouTube URL
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
 * Get video info using yt-dlp
 * Includes auto-retry logic
 */
async function getVideoInfo(videoUrl, retryCount = 0, delayMs = 1000) {
  return new Promise(async (resolve, reject) => {
    // Add exponential backoff delay
    if (retryCount > 0) {
      console.log(`⏳ Retry #${retryCount} - Waiting ${delayMs}ms before attempting...`)
      await new Promise(r => setTimeout(r, delayMs))
    }
    
    // Use Chrome profile for better bot bypass
    const chromeProfile = getOrCreateChromeProfile()
    let command = `yt-dlp -j --dump-single-json --cookies-from-browser chromium --browser-executable-path /usr/bin/chromium-browser --chromium-user-data-dir "${chromeProfile}"`
    
    // Add URL
    command += ` "${videoUrl}"`
    
    let stdout = ''
    let stderr = ''
    
    exec(command, { maxBuffer: 10 * 1024 * 1024 }, async (error, out, err) => {
      stdout = out
      stderr = err
      
      // Check for specific errors
      const isBotProtected = stderr && stderr.includes('Sign in to confirm you\'re not a bot')
      const isGeoBlocked = stderr && (stderr.includes('geo-blocked') || stderr.includes('not available in your country'))
      const isAgeRestricted = stderr && stderr.includes('age-restricted')
      const isLoginRequired = stderr && stderr.includes('Login required')
      
      // Log status
      if (error) {
        console.error(`⚠️ Attempt ${retryCount + 1} failed:`, stderr.substring(0, 150))
      }
      
      // Geo-blocked retry
      if (isGeoBlocked && retryCount < 2) {
        console.log(`🌍 Geo-blocked, retrying...`)
        try {
          const result = await getVideoInfo(videoUrl, retryCount + 1, delayMs * 2)
          return resolve(result)
        } catch (retryError) {
          return reject(new Error('GEO_BLOCKED'))
        }
      }
      
      // Bot protection retry
      if (isBotProtected && retryCount < 4) {
        const nextDelay = Math.min(delayMs * (2 ** retryCount), 16000)
        console.log(`🔄 Bot protection detected, retrying with ${nextDelay}ms delay...`)
        try {
          const result = await getVideoInfo(videoUrl, retryCount + 1, nextDelay)
          return resolve(result)
        } catch (retryError) {
          return reject(retryError)
        }
      }
      
      // Final error checks
      if (isBotProtected) {
        return reject(new Error('BOT_PROTECTED'))
      }
      
      if (isAgeRestricted) {
        return reject(new Error('AGE_RESTRICTED'))
      }
      
      if (isLoginRequired) {
        return reject(new Error('LOGIN_REQUIRED'))
      }
      
      if (error && !stdout) {
        return reject(new Error(stderr.substring(0, 300) || error.message))
      }
      
      // Parse output
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
 * Transform formats for API response
 */
function transformFormats(formats) {
  if (!Array.isArray(formats)) return []
  
  return formats
    .filter(f => {
      // Skip formats without video codec
      if (!f.vcodec || f.vcodec === 'none') return false
      
      // Skip AV1 (browser FFmpeg can't handle)
      if (f.vcodec.toLowerCase().includes('av1') || f.vcodec.toLowerCase().includes('av01')) {
        return false
      }
      
      return true
    })
    .map(f => ({
      id: f.format_id,
      label: `${f.height}p${f.fps ? '@' + f.fps + 'fps' : ''} - ${f.ext} (${f.vcodec})`,
      format_id: f.format_id,
      height: f.height || 0,
      fps: f.fps || 0,
      video_codec: f.vcodec,
      ext: f.ext,
      filesize: f.filesize || 0,
    }))
}

/**
 * Download video with auto-retry
 */
async function downloadVideo(videoUrl, formatId, retryCount = 0, delayMs = 1000) {
  return new Promise(async (resolve, reject) => {
    if (retryCount > 0) {
      console.log(`⏳ Download retry #${retryCount} - Waiting ${delayMs}ms...`)
      await new Promise(r => setTimeout(r, delayMs))
    }
    
    // Use Chrome profile
    const chromeProfile = getOrCreateChromeProfile()
    
    // Create temp file path
    const tempFile = join(tmpdir(), `yt-dlp-${formatId}-${Date.now()}-${Math.random().toString(36).substring(7)}`)
    
    // Build yt-dlp command
    const ytdlpArgs = [
      '-f', formatId,
      '--cookies-from-browser', 'chromium',
      '--browser-executable-path', '/usr/bin/chromium-browser',
      '--chromium-user-data-dir', chromeProfile,
      '-o', tempFile,
      '-v',  // Verbose output
      videoUrl
    ]
    
    console.log(`📥 Starting download: ${formatId} from ${videoUrl}`)
    
    const proc = spawn('yt-dlp', ytdlpArgs)
    let stderr = ''
    let responseSent = false
    
    // Track progress
    proc.stderr.on('data', (data) => {
      stderr += data.toString()
      
      // Parse progress (if yt-dlp is streaming to a pipe)
      const progressMatch = stderr.match(/(\d+(?:\.\d+)?)%/)
      if (progressMatch) {
        const progress = parseFloat(progressMatch[1])
        downloadProgress.set(formatId, { progress, timestamp: Date.now() })
      }
    })
    
    // Success
    proc.on('close', (code) => {
      activeDownloads--
      
      if (responseSent) return
      responseSent = true
      
      if (code === 0) {
        try {
          // Verify file exists and has size
          if (!existsSync(tempFile)) {
            throw new Error('Video file not created')
          }
          
          const stats = statSync(tempFile)
          if (stats.size === 0) {
            unlinkSync(tempFile)
            throw new Error('Downloaded file is empty (0 bytes)')
          }
          
          console.log(`✅ Downloaded ${stats.size} bytes to ${tempFile}`)
          
          // Read and send file
          const fileData = readFileSync(tempFile)
          
          // Clean up temp file
          try {
            unlinkSync(tempFile)
          } catch (e) {}
          
          resolve(fileData)
        } catch (error) {
          console.error('❌ Download error:', error.message)
          reject(error)
        }
      } else {
        // Retry logic
        if (code !== 0 && retryCount < 3) {
          console.log(`⚠️ Download failed (code ${code}), retrying...`)
          try {
            downloadVideo(videoUrl, formatId, retryCount + 1, delayMs * 2)
              .then(resolve)
              .catch(reject)
            return
          } catch (e) {
            reject(e)
          }
        }
        
        // Final error
        const errorMsg = stderr.substring(0, 300) || `Process exited with code ${code}`
        console.error('❌ Download failed:', errorMsg)
        reject(new Error(errorMsg))
      }
      
      downloadProgress.delete(formatId)
    })
    
    // Timeout (30 minutes for large files)
    const timeout = setTimeout(() => {
      if (!responseSent) {
        responseSent = true
        proc.kill()
        activeDownloads--
        reject(new Error('Download timeout - took more than 30 minutes'))
      }
    }, 30 * 60 * 1000)
    
    proc.on('error', (error) => {
      activeDownloads--
      if (!responseSent) {
        responseSent = true
        clearTimeout(timeout)
        reject(error)
      }
    })
  })
}

// Create server
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  
  // Debug logging
  console.log(`📍 ${req.method} ${url.pathname}`)
  
  // CORS headers
  const origin = req.headers.origin || '*'
  if (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  // Handle OPTIONS
  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }
  
  // Routes
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }
  
  if (req.method === 'GET' && url.pathname === '/extract') {
    const videoUrl = url.searchParams.get('url')
    
    if (!videoUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Missing url parameter' }))
      return
    }
    
    try {
      console.log(`🔍 Extracting: ${videoUrl}`)
      const videoInfo = await getVideoInfo(videoUrl)
      
      const response = {
        video_id: extractVideoId(videoUrl),
        title: videoInfo.title,
        duration: videoInfo.duration,
        thumbnail: videoInfo.thumbnail,
        formats: transformFormats(videoInfo.formats),
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(response))
    } catch (error) {
      console.error('❌ Extraction error:', error.message)
      
      let statusCode = 500
      let errorMsg = error.message
      
      if (error.message === 'BOT_PROTECTED') {
        statusCode = 429
        errorMsg = 'YouTube bot protection triggered - please try again later'
      } else if (error.message === 'GEO_BLOCKED') {
        statusCode = 403
        errorMsg = 'Video not available in your region'
      } else if (error.message === 'AGE_RESTRICTED') {
        statusCode = 403
        errorMsg = 'Video is age-restricted'
      } else if (error.message === 'LOGIN_REQUIRED') {
        statusCode = 403
        errorMsg = 'Video requires login'
      }
      
      res.writeHead(statusCode, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: errorMsg }))
    }
    return
  }
  
  if (req.method === 'GET' && url.pathname === '/download') {
    const videoUrl = url.searchParams.get('url')
    const formatId = url.searchParams.get('format')
    
    if (!videoUrl || !formatId) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Missing url or format parameter' }))
      return
    }
    
    // Check concurrent downloads
    if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Too many concurrent downloads - please try again' }))
      return
    }
    
    activeDownloads++
    
    try {
      console.log(`📥 Download request: format=${formatId}`)
      const videoData = await downloadVideo(videoUrl, formatId)
      
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': videoData.length,
        'Content-Disposition': `attachment; filename="video-${formatId}.mp4"`,
      })
      res.end(videoData)
    } catch (error) {
      console.error('❌ Download error:', error.message)
      activeDownloads--
      
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: error.message }))
    }
    return
  }
  
  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, async () => {
  console.log(`✅ API server running on http://localhost:${PORT}`)
  console.log('📊 Using yt-dlp backend with server-side FFmpeg processing')
  
  // Check tool availability
  const toolsReady = await checkTools()
  if (!toolsReady) {
    console.error('❌ CRITICAL: Some tools are missing!')
    console.error('   Ensure Docker image has all dependencies installed')
  }
  
  // Verify Chrome profile setup
  try {
    const chromeProfile = getOrCreateChromeProfile()
    console.log(`✅ Chrome profile directory: ${chromeProfile}`)
  } catch (error) {
    console.error('❌ Chrome profile error:', error.message)
  }
  
  // Start periodic cleanup of temp files
  startPeriodicCleanup()
  console.log(`✅ Periodic cleanup task started (every 30 minutes)`)
  
  console.log('Ready to accept requests!')
})

