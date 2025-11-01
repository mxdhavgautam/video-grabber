import { createServer } from 'http'
import { readFileSync, existsSync, statSync, createReadStream } from 'fs'
import { join, extname, dirname } from 'path'
import { fileURLToPath } from 'url'
import { Innertube } from 'youtubei.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = process.env.PORT || 3001
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['*']

// Path to built frontend (dist folder)
const DIST_PATH = join(__dirname, 'dist')
const HAS_FRONTEND = existsSync(DIST_PATH)

if (HAS_FRONTEND) {
  console.log('✅ Frontend build found at', DIST_PATH)
} else {
  console.warn('⚠️ Frontend build not found. Run `npm run build` first.')
}

// Initialize YouTubeI client
let youtube = null
let youtubeReady = false

;(async () => {
  try {
    console.log('🌐 Initializing YouTubeI.js client...')
    youtube = await Innertube.create({
      cache: false,  // Disable cache to avoid cache.get is not a function error
      cookie: process.env.YOUTUBE_COOKIES || undefined,
      // Use node vm2 for evaluating JavaScript (safer than eval)
      // This is needed for deciphering YouTube URLs
      generate_session_data: true
    })
    youtubeReady = true
    console.log('✅ YouTubeI.js initialized successfully')
  } catch (error) {
    console.error('❌ Failed to initialize YouTubeI.js:', error.message)
  }
})()

// Extract video ID from URL
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ]
  
  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }
  
  return null
}

// Get video info using YouTubeI.js
async function getVideoInfo(videoUrl) {
  if (!youtubeReady || !youtube) {
    throw new Error('YouTube client not ready')
  }
  
  const videoId = extractVideoId(videoUrl)
  if (!videoId) {
    throw new Error('Invalid YouTube URL')
  }
  
  console.log(`📥 Fetching video info for: ${videoId}`)
  
  try {
    const info = await youtube.getInfo(videoId)
    
    // Extract formats
    const formats = []
    
    // Combined formats (video + audio)
    for (const format of info.streaming_data?.formats || []) {
      formats.push({
        format_id: `innertube-${format.itag}`,
        url: format.url || format.signatureCipher || '',  // Use direct URL or cipher
        ext: format.mime_type?.includes('mp4') ? 'mp4' : 'webm',
        width: format.width || 0,
        height: format.height || 0,
        fps: format.fps || 0,
        vcodec: format.mime_type?.includes('video') ? 'h264' : 'none',
        acodec: format.mime_type?.includes('audio') ? 'aac' : 'none',
        filesize: format.content_length || 0,
        quality: format.quality_label || `${format.height}p`,
        format_note: format.quality_label || 'unknown',
        tbr: format.bitrate / 1000 || 0
      })
    }
    
    // Adaptive formats (video-only and audio-only)
    for (const format of info.streaming_data?.adaptive_formats || []) {
      const hasVideo = format.mime_type?.includes('video')
      const hasAudio = format.mime_type?.includes('audio')
      
      formats.push({
        format_id: `innertube-adaptive-${format.itag}`,
        url: format.url || format.signatureCipher || '',  // Use direct URL or cipher
        ext: format.mime_type?.includes('mp4') ? 'mp4' : format.mime_type?.includes('webm') ? 'webm' : 'm4a',
        width: format.width || 0,
        height: format.height || 0,
        fps: format.fps || 0,
        vcodec: hasVideo ? (format.mime_type?.includes('avc1') ? 'h264' : 'vp9') : 'none',
        acodec: hasAudio ? 'aac' : 'none',
        filesize: format.content_length || 0,
        quality: format.quality_label || (hasAudio ? `${Math.round(format.bitrate / 1000)}kbps` : 'unknown'),
        format_note: format.quality_label || (hasAudio ? 'audio only' : 'video only'),
        tbr: format.bitrate / 1000 || 0
      })
    }
    
    return {
      id: videoId,
      title: info.basic_info.title || 'Unknown',
      duration: info.basic_info.duration || 0,
      view_count: info.basic_info.view_count || 0,
      uploader: info.basic_info.author || 'Unknown',
      uploader_id: info.basic_info.channel_id || '',
      description: info.basic_info.short_description || '',
      thumbnail: info.basic_info.thumbnail?.[info.basic_info.thumbnail.length - 1]?.url || '',
      formats: formats.sort((a, b) => b.height - a.height || b.tbr - a.tbr)
    }
  } catch (error) {
    console.error('❌ YouTubeI.js extraction failed:', error.message)
    throw new Error(`Failed to extract video info: ${error.message}`)
  }
}

// MIME types
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject'
}

function serveFile(res, filePath) {
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('404 Not Found')
    return
  }
  
  const ext = extname(filePath)
  const contentType = MIME_TYPES[ext] || 'application/octet-stream'
  
  const stat = statSync(filePath)
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000'
  })
  
  createReadStream(filePath).pipe(res)
}

// Create HTTP server
const server = createServer(async (req, res) => {
  const origin = req.headers.origin || req.headers.referer || '*'
  const allowedOrigin = ALLOWED_ORIGINS.includes('*') ? origin : 
    ALLOWED_ORIGINS.find(o => origin.includes(o)) || ALLOWED_ORIGINS[0]
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200)
    res.end()
    return
  }
  
  const url = new URL(req.url, `http://${req.headers.host}`)
  const pathname = url.pathname
  
  console.log(`📍 ${req.method} ${pathname}`)
  
  // API endpoints
  if (pathname === '/api/health' || pathname === '/grabber/api/health' || pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ 
      status: 'ok',
      backend: 'youtubei.js',
      youtubeReady
    }))
    return
  }
  
  if ((pathname === '/api/extract' || pathname === '/grabber/api/extract') && req.method === 'GET') {
    const videoUrl = url.searchParams.get('url')
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress
    
    if (!videoUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Missing video URL' }))
      return
    }
    
    console.log(`📥 Extracting video info from: ${videoUrl} (IP: ${clientIp})`)
    
    try {
      const videoInfo = await getVideoInfo(videoUrl)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(videoInfo))
      console.log(`✅ Successfully extracted: ${videoInfo.title}`)
    } catch (error) {
      console.error(`❌ Extraction failed:`, error.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ 
        error: 'Failed to extract video info',
        details: error.message
      }))
    }
    return
  }
  
  // Serve frontend
  if (HAS_FRONTEND) {
    // Handle /grabber paths
    let filePath
    if (pathname.startsWith('/grabber/')) {
      const subpath = pathname.slice('/grabber'.length) || '/'
      filePath = join(DIST_PATH, subpath === '/' ? 'index.html' : subpath)
    } else {
      filePath = join(DIST_PATH, pathname === '/' ? 'index.html' : pathname)
    }
    
    // If file doesn't exist and not an API route, serve index.html (SPA fallback)
    if (!existsSync(filePath) && !pathname.startsWith('/api')) {
      filePath = join(DIST_PATH, 'index.html')
    }
    
    serveFile(res, filePath)
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Frontend not built. Run `npm run build` first.')
  }
})

server.listen(PORT, () => {
  console.log(`✅ API server running on http://localhost:${PORT}`)
  console.log(`📊 Using YouTubeI.js backend (more bot-detection resistant)`)
  if (HAS_FRONTEND) {
    console.log(`🌐 Frontend available at http://localhost:${PORT}/grabber`)
  }
  console.log('Ready to accept requests!')
})

