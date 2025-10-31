import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createContext, runInNewContext } from 'vm'
import { Innertube, Platform } from 'youtubei.js'

// Set up JavaScript interpreter for signature deciphering
// This is REQUIRED for formats that need signature deciphering
// The interpreter executes YouTube's player script to transform signatures and n parameters
Platform.shim.eval = async (data, env) => {
  // data: BuildScriptResult object containing:
  //   - output: JavaScript code string (wrapped in IIFE that creates exportedVars)
  //   - exported: Array of exported variable names ['sigFunction', 'nFunction', ...]
  //   - exportedRawValues: Optional raw values like signature timestamp
  // env: Object with keys 'sig' and/or 'n' containing the values to transform
  
  console.log('[Interpreter] Called with env:', Object.keys(env), 'has sig:', !!env.sig, 'has n:', !!env.n)
  
  if (!data || !data.output) {
    throw new Error('Invalid player script data: missing output')
  }
  
  try {
    // The script output structure is:
    // const exportedVars = (function(...) {
    //   // ... code ...
    //   return { sigFunction, nFunction, ... };
    // })({});
    //
    // The issue: vm.createContext() + runInNewContext() with const declarations
    // doesn't always make variables accessible as properties.
    // Solution: Wrap the script to explicitly assign exportedVars to our sandbox.
    const originalScriptCode = data.output
    
    // Create a sandbox with a property to capture exportedVars
    const sandbox = {
      __capturedExportedVars: null,
      // Provide console for debugging if needed
      console: {
        log: (...args) => console.log('[Player Script]', ...args),
        error: (...args) => console.error('[Player Script]', ...args),
        warn: (...args) => console.warn('[Player Script]', ...args),
      },
      // These are provided by the script itself, but we include them for compatibility
      window: {},
      document: {},
      self: {},
    }
    
    // Wrap the script to capture exportedVars explicitly
    // Original: const exportedVars = (function() {...})();
    // Wrapped:  const exportedVars = (function() {...})(); __capturedExportedVars = exportedVars;
    const wrappedScriptCode = originalScriptCode + '\n__capturedExportedVars = exportedVars;'
    
    // Create a context from the sandbox
    const context = createContext(sandbox)
    
    // Execute the wrapped script in the sandboxed context
    runInNewContext(wrappedScriptCode, context, {
      timeout: 5000, // 5 second timeout
      breakOnSigint: false,
    })
    
    // After execution, exportedVars should be captured in our sandbox property
    const exportedVars = context.__capturedExportedVars || context.exportedVars
    
    // If still not found, check all keys in context (for debugging)
    if (!exportedVars) {
      const allKeys = Object.getOwnPropertyNames(context).filter(k => 
        k !== 'console' && k !== 'window' && k !== 'document' && k !== 'self'
      )
      console.error('exportedVars not found. Available keys:', allKeys)
      console.error('Script preview (first 500 chars):', originalScriptCode.substring(0, 500))
      throw new Error(`Player script execution failed: exportedVars is undefined. Available keys: ${allKeys.join(', ')}`)
    }
    
    // Validate exportedVars
    if (exportedVars === null || typeof exportedVars !== 'object' || Array.isArray(exportedVars)) {
      throw new Error(`Player script execution failed: exportedVars is ${exportedVars === null ? 'null' : Array.isArray(exportedVars) ? 'array' : typeof exportedVars}`)
    }
    
    // Build result object with transformed values
    const result = {}
    
    // Transform signature if provided
    if (env.sig && typeof env.sig === 'string') {
      if (!exportedVars.sigFunction || typeof exportedVars.sigFunction !== 'function') {
        throw new Error(`Player script missing sigFunction. Available: ${Object.keys(exportedVars).join(', ')}`)
      }
      result.sig = exportedVars.sigFunction(env.sig)
      if (typeof result.sig !== 'string') {
        throw new Error(`sigFunction returned invalid type: ${typeof result.sig}`)
      }
      console.log('[Interpreter] Successfully transformed signature:', env.sig.substring(0, 10) + '... -> ' + result.sig.substring(0, 10) + '...')
    }
    
    // Transform n parameter if provided
    if (env.n && typeof env.n === 'string') {
      if (!exportedVars.nFunction || typeof exportedVars.nFunction !== 'function') {
        throw new Error(`Player script missing nFunction. Available: ${Object.keys(exportedVars).join(', ')}`)
      }
      result.n = exportedVars.nFunction(env.n)
      if (typeof result.n !== 'string') {
        throw new Error(`nFunction returned invalid type: ${typeof result.n}`)
      }
      console.log('[Interpreter] Successfully transformed n parameter:', env.n.substring(0, 10) + '... -> ' + result.n.substring(0, 10) + '...')
    }
    
    console.log('[Interpreter] Returning result:', Object.keys(result))
    return result
  } catch (error) {
    console.error('JavaScript interpreter error:', error)
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      hasOutput: !!data.output,
      outputLength: data.output?.length,
      exported: data.exported,
      envKeys: Object.keys(env)
    })
    throw error
  }
}

// Lazily initialize YouTube InnerTube client (deciphers formats reliably)
let ytClient
async function getYT() {
  if (!ytClient) {
    try {
    ytClient = await Innertube.create({ hl: 'en', gl: 'US' })
      console.log('YouTube client initialized successfully with JavaScript interpreter')
    } catch (e) {
      console.error('Failed to initialize YouTube client:', e)
      throw e
    }
  }
  return ytClient
}

// Extract video ID from YouTube URL
function extractVideoId(url) {
  if (!url) return null
  
  // Match patterns:
  // https://www.youtube.com/watch?v=VIDEO_ID
  // https://youtube.com/watch?v=VIDEO_ID
  // https://youtu.be/VIDEO_ID
  // https://www.youtube.com/embed/VIDEO_ID
  // https://youtube.com/watch?v=VIDEO_ID&list=...
  
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

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = process.env.PORT || 3001
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*'

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
  if (url.pathname === '/api/extract') {
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
      // Extract video ID from URL
      const videoId = extractVideoId(videoUrl)
      if (!videoId) {
        res.writeHead(400, { 
          ...corsHeaders,
          'Content-Type': 'application/json' 
        })
        res.end(JSON.stringify({ error: 'Could not extract video ID from URL' }))
        return
      }

      const yt = await getYT()
      let info
      try {
        // Try getInfo without options first (default client)
        info = await yt.getInfo(videoId)
      } catch (e) {
        console.log('Default getInfo failed, trying with client options:', e.message)
        try {
          // Try with client option
          info = await yt.getInfo(videoId, { client: 'ANDROID' })
        } catch (e2) {
          console.log('ANDROID client failed, trying TV:', e2.message)
          try {
            info = await yt.getInfo(videoId, { client: 'TV' })
          } catch (e3) {
            console.log('TV client failed, trying WEB:', e3.message)
            info = await yt.getInfo(videoId, { client: 'WEB' })
          }
        }
      }
      
      if (!info) {
        throw new Error('Failed to get video info from any client')
      }
      
      console.log('Successfully fetched video info:', {
        title: info?.basic_info?.title || 'N/A',
        hasStreamingData: !!info?.streaming_data,
        adaptiveFormats: info?.streaming_data?.adaptive_formats?.length || 0
      })

      // Access streaming data from VideoInfo object
      // VideoInfo has streaming_data property that contains formats
      const sd = info?.streaming_data || {}
      const adaptive = sd?.adaptive_formats || []
      const formatsMuxed = sd?.formats || []
      
      // Debug: log if no formats found
      if (adaptive.length === 0 && formatsMuxed.length === 0) {
        console.log('No formats found in streaming_data, checking info structure:', {
          hasStreamingData: !!info?.streaming_data,
          infoKeys: Object.keys(info || {}),
          streamingDataKeys: info?.streaming_data ? Object.keys(info.streaming_data) : []
        })
      }

      // Get all video formats (with or without audio)
      const videoFormats = [...adaptive, ...formatsMuxed]
        .filter(format => format.has_video)
        .map(format => ({
          format_id: String(format.itag),
          format_note: format.quality_label || format.quality || undefined,
          ext: (format.mime_type || '').includes('webm') ? 'webm' : (format.mime_type || '').includes('mp4') ? 'mp4' : 'mp4',
          resolution: format.quality_label || format.quality || undefined,
          filesize: format.content_length ? parseInt(format.content_length) : undefined,
          fps: format.fps,
          video_codec: format.codecs,
          audio_codec: format.audio_codec || undefined,
          url: format.url,
          protocol: format.protocol || undefined,
          width: format.width,
          height: format.height,
          hasAudio: !!format.has_audio,
          hasVideo: true, // All formats here have video
        }))

      // Get audio-only formats with language information
      const audioFormats = [...adaptive]
        .filter(format => format.has_audio && !format.has_video)
        .map(format => ({
          format_id: String(format.itag),
          format_note: format.bitrate ? `${Math.round((format.bitrate || 0) / 1000)}kbps` : 'Audio',
          ext: (format.mime_type || '').includes('webm') ? 'webm' : (format.mime_type || '').includes('mp4') ? 'm4a' : 'm4a',
          filesize: format.content_length ? parseInt(format.content_length) : undefined,
          audio_codec: format.codecs,
          video_codec: undefined, // Explicitly set to undefined for audio-only formats
          url: format.url,
          protocol: format.protocol || undefined,
          language: format.audio_track?.display_name || format.language || undefined,
          audio_track_id: format.audio_track?.id || undefined,
          hasAudio: true,
          hasVideo: false, // Explicitly mark as audio-only
        }))

      // Get unique audio tracks from adaptive formats (if available)
      const adaptiveFormats = adaptive
      const audioTracksMap = new Map()
      
      // Group audio formats by language/track
      adaptiveFormats
        .filter(f => f.mimeType?.includes('audio'))
        .forEach(format => {
          const language = format.language || 'default'
          const trackId = format.audioTrack?.id || format.itag?.toString()
          
          if (!audioTracksMap.has(language)) {
            audioTracksMap.set(language, {
              language: language === 'default' ? 'Default' : language,
              language_code: format.language || 'default',
              format_ids: [],
              track_id: trackId,
            })
          }
          
          if (format.itag) {
            audioTracksMap.get(language).format_ids.push(format.itag.toString())
          }
        })
      
      // Also check formats for audio tracks
      adaptive
        .filter(f => f.has_audio && !f.has_video)
        .forEach(format => {
          const language = format.audio_track?.display_name || format.language || 'default'
          const trackId = format.audio_track?.id || String(format.itag)
          
          if (!audioTracksMap.has(language)) {
            audioTracksMap.set(language, {
              language: language === 'default' ? 'Default' : language,
              language_code: format.language || 'default',
              format_ids: [],
              track_id: trackId,
            })
          }
          
          if (format.itag) {
            const formatId = format.itag.toString()
            if (!audioTracksMap.get(language).format_ids.includes(formatId)) {
              audioTracksMap.get(language).format_ids.push(formatId)
            }
          }
        })

      let audioTracks = Array.from(audioTracksMap.values()).map((track, index) => ({
        ...track,
        format_id: index.toString(),
      }))

      // If no audio tracks detected, create a default one
      if (audioTracks.length === 0) {
        audioTracks = [{
          language: 'Default',
          language_code: 'default',
          format_id: '0',
          format_ids: audioFormats.map(f => f.format_id),
        }]
      }

      // Get subtitle/caption tracks
      const subtitleTracks = info?.captions?.tracks
        ?.map((track, index) => ({
          language: track?.name?.simpleText || track?.name?.runs?.[0]?.text || track?.language_code || 'Unknown',
          language_code: track?.language_code || 'und',
          base_url: track?.base_url,
          format_id: index.toString(),
        })) || []

      // Debug: log format counts
      console.log('Format counts:', {
        videoFormats: videoFormats.length,
        audioFormats: audioFormats.length,
        totalFormats: videoFormats.length + audioFormats.length
      })

      res.writeHead(200, { 
        ...corsHeaders,
        'Content-Type': 'application/json' 
      })
      res.end(JSON.stringify({
        id: info?.basic_info?.id || info?.id || '',
        title: info?.basic_info?.title || '',
        thumbnail: (info?.basic_info?.thumbnail?.[info?.basic_info?.thumbnail?.length - 1]?.url) || '',
        duration: info?.basic_info?.duration || 0,
        formats: [...videoFormats, ...audioFormats], // Combine video and audio formats
        subtitle_tracks: subtitleTracks,
        audio_tracks: audioTracks,
        webpage_url: videoUrl,
        platform: 'youtube',
        description: info?.basic_info?.short_description || undefined,
        uploader: info?.basic_info?.author || undefined,
        view_count: info?.basic_info?.view_count ? Number(info.basic_info.view_count) : undefined,
      }))
    } catch (error) {
      console.error('Error:', error)
      res.writeHead(500, { 
        ...corsHeaders,
        'Content-Type': 'application/json' 
      })
      res.end(JSON.stringify({
        error: 'Failed to fetch video information',
        message: error instanceof Error ? error.message : 'Unknown error',
      }))
    }
    return
  }

  // Download proxy
  if (url.pathname === '/api/download') {
    // Support two modes:
    // 1) Direct proxy via `url` (googlevideo URL)
    // 2) youtubei streaming resolve via `videoUrl` (watch URL) + `itag`
    let directUrl = url.searchParams.get('url')
    const pageVideoUrl = url.searchParams.get('videoUrl')
    const itagParam = url.searchParams.get('itag')
    
    // Extract video ID early if we have pageVideoUrl
    let videoId = null
    if (pageVideoUrl) {
      videoId = extractVideoId(pageVideoUrl)
      if (!videoId) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Could not extract video ID from URL' }))
        return
      }
    }

    if (!directUrl && pageVideoUrl && itagParam) {
      try {
        const requestedItag = parseInt(itagParam, 10)
        
        const yt = await getYT()
        
        // SOLE STRATEGY: Always download Format 18 (360p combined video+audio)
        // Frontend will handle all processing via FFmpeg.wasm
        console.log(`📥 User requested format ${requestedItag} → Downloading Format 18 (universal source)`)
        
        try {
          const info = await yt.getInfo(videoId, { client: 'ANDROID' })
          
          if (!info) {
            throw new Error('Failed to get video info')
          }
          
          // Always download Format 18 (360p H.264 + AAC)
          const stream = await info.download({ itag: 18 })
          
          console.log('✅ Format 18 stream obtained successfully')
          
          // Set headers for streaming
          const responseHeaders = {
        ...corsHeaders,
            'Content-Type': 'video/mp4',
        'Cache-Control': 'public, max-age=3600',
            'Accept-Ranges': 'bytes',
            'X-Source-Format': '18',
            'X-Requested-Format': requestedItag.toString(),
          }
          
          res.writeHead(200, responseHeaders)

          // Stream to client
          const reader = stream.getReader()
          let bytesStreamed = 0
          
          try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        if (value) {
          res.write(Buffer.from(value))
                bytesStreamed += value.length
        }
      }

            console.log(`✅ Streamed ${bytesStreamed} bytes (Format 18)`)
            res.end()
            return
          } catch (streamError) {
            // If we streamed significant data, consider it success
            if (bytesStreamed > 1000 && res.headersSent) {
              console.log(`✅ Stream completed: ${bytesStreamed} bytes (ignoring post-stream metadata error)`)
      res.end()
              return
            }
            throw streamError
          } finally {
            try { reader.releaseLock() } catch (e) {}
          }
    } catch (error) {
          console.error('❌ Format 18 download failed:', error.message)
          res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ 
            error: 'Format 18 download failed', 
            message: error.message 
          }))
          return
        }
      } catch (err) {
        console.error('❌ Fatal error downloading Format 18:', err)
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ 
          error: 'Format 18 download failed', 
          message: err.message 
        }))
        return
      }
    }

    // Not using videoUrl+itag mode - not supported anymore
    res.writeHead(400, { 
        ...corsHeaders,
        'Content-Type': 'application/json' 
      })
    res.end(JSON.stringify({ error: 'Only videoUrl+itag mode is supported' }))
    return
  }

  res.writeHead(404)
  res.end('Not found')
})
server.listen(PORT, () => {
  console.log(`✅ API server running on http://localhost:${PORT}`)
  console.log('Ready to accept requests!')
})

