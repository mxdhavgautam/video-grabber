import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createContext, runInNewContext } from 'vm'
import { Innertube, Platform } from 'youtubei.js'

// Set up JavaScript interpreter for signature deciphering (same as server-node.mjs)
Platform.shim.eval = async (data: any, env: any) => {
  if (!data || !data.output) {
    throw new Error('Invalid player script data: missing output')
  }

  try {
    const originalScriptCode = data.output
    
    const sandbox = {
      __capturedExportedVars: null,
      console: {
        log: (...args: any[]) => console.log('[Player Script]', ...args),
        error: (...args: any[]) => console.error('[Player Script]', ...args),
        warn: (...args: any[]) => console.warn('[Player Script]', ...args),
      },
      window: {},
      document: {},
      self: {},
    }
    
    const wrappedScript = originalScriptCode + '\n__capturedExportedVars = exportedVars;'
    
    runInNewContext(wrappedScript, createContext(sandbox), { timeout: 5000 })
    
    const exportedVars = sandbox.__capturedExportedVars as any
    
    if (!exportedVars || typeof exportedVars !== 'object') {
      throw new Error(`Player script execution failed: exportedVars is ${typeof exportedVars}`)
    }
    
    if (!exportedVars.sigFunction || typeof exportedVars.sigFunction !== 'function') {
      throw new Error('Player script does not export sigFunction')
    }
    
    const result: any = {}
    if (env.sig) {
      result.sig = exportedVars.sigFunction(env.sig)
    }
    if (env.n) {
      result.n = exportedVars.nFunction ? exportedVars.nFunction(env.n) : env.n
    }
    
    return result
  } catch (error: any) {
    console.error('[Interpreter] Execution error:', error.message)
    throw error
  }
}

// Client types to try in order of preference for bypassing restrictions
const CLIENT_TYPES = [
  'TV_EMBEDDED', // Try TV_EMBEDDED first - often less restricted
  'WEB', // Standard web client
  'MWEB', // Mobile web
  'ANDROID', // Android client
  'IOS', // iOS client
]

let ytInstance: any = null
let currentClientType: string = 'TV_EMBEDDED'

async function getYT(clientType?: string) {
  const targetClientType = clientType || currentClientType

  // If we already have a singleton and it's using the requested client, return it
  if (ytInstance && currentClientType === targetClientType) {
    return ytInstance
  }

  // Create new instance with specified client
  console.log(`[Download] Creating Innertube instance with client: ${targetClientType}`)

  // Use more realistic browser-like configuration to avoid bot detection
  const clientConfig: any = {
    hl: 'en',
    gl: 'US',
    client_type: targetClientType,
    // Generate session locally to avoid YouTube API calls that might be restricted
    generate_session_locally: true,
  }

  // Add browser-like user agent and headers based on client type
  if (targetClientType === 'WEB') {
    clientConfig.user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  } else if (targetClientType === 'ANDROID') {
    clientConfig.user_agent = 'com.google.android.youtube/19.09.36 (Linux; U; Android 11; SM-G973F) gzip'
  } else if (targetClientType === 'IOS') {
    clientConfig.user_agent = 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)'
  } else if (targetClientType === 'MWEB') {
    clientConfig.user_agent = 'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
  } else if (targetClientType === 'TV_EMBEDDED') {
    clientConfig.user_agent = 'Mozilla/5.0 (Linux; Android 9; SHIELD Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 CrKey/1.0'
  }

  // Use real YouTube cookies from browser session
  const realCookies = [
    'PREF=f4=4000000&tz=Asia.Calcutta',
    'CONSISTENCY=AKreu9swyBBY9bTTtBL2-slXr37pSEUe4qNzfrKzUGgbAzF2LC2OC62oRQFigBqqZ7Hl9oGJNV310D4GgSME47ldJ8lmO9fzYEljLRpTaYA8Vryd1Ewxy9wxlmu380QdKU04Q0UsZusdVKVUVKYD6xs'
  ].join('; ')

  clientConfig.cookie = realCookies
  clientConfig.visitor_data = 'Cgt1UzEtQ29va2llEgV1UzEt'

  ytInstance = await Innertube.create(clientConfig)

  currentClientType = targetClientType
  return ytInstance
}

// Try to get video info with fallback client strategy
async function getVideoInfoWithFallback(videoId: string): Promise<any> {
  let lastError: any = null

  for (const clientType of CLIENT_TYPES) {
    try {
      console.log(`[Download] Trying client: ${clientType}`)
      const yt = await getYT(clientType)

      const info = await yt.getInfo(videoId, { client: clientType } as any)

      if (!info) {
        throw new Error('Failed to get video info')
      }

      // Check if we got valid streaming data
      const streamingData = info.streaming_data || info.streamingData
      if (!streamingData || (!streamingData.formats && !streamingData.adaptive_formats)) {
        throw new Error('No streaming data available')
      }

      console.log(`[Download] Successfully got video info with client: ${clientType}`)
      return info

    } catch (error: any) {
      console.error(`[Download] Client ${clientType} failed:`, error.message)
      lastError = error

      // Continue to next client for various client-specific errors
      if (error.message.includes('LOGIN_REQUIRED') ||
          error.message.includes('403') ||
          error.message.includes('UNKNOWN') ||
          error.message.includes('No streaming data') ||
          error.message.includes('Request to') ||
          error.message.includes('status code')) {
        console.log(`[Download] Retrying with next client due to error: ${error.message}`)
        continue
      }

      // For other errors, fail immediately
      throw error
    }
  }

  // All clients failed
  throw new Error(`All clients failed. Last error: ${lastError?.message || 'Unknown error'}`)
}

// Extract video ID from YouTube URL
function extractVideoId(url: string): string | null {
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

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method === 'OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.status(200).end()
    return
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { videoUrl, itag, url: directUrl } = req.query as { [key: string]: string }

  // SOLE STRATEGY: Always download Format 18 (360p combined video+audio)
  // Frontend will handle all processing via FFmpeg.wasm
  if (videoUrl && itag) {
    try {
      const requestedItag = parseInt(itag, 10)
      const videoId = extractVideoId(videoUrl)
      
      if (!videoId) {
        return res.status(400).json({ error: 'Could not extract video ID from URL' })
      }

      console.log(`📥 User requested format ${requestedItag} → Downloading Format 18 (universal source)`)

      const info = await getVideoInfoWithFallback(videoId)

      if (!info) {
        throw new Error('getVideoInfoWithFallback returned null')
      }

      console.log(`[Download] Info object keys:`, Object.keys(info))
      console.log(`[Download] Info has download method:`, typeof info.download)

      // Always download Format 18 (360p combined video+audio)
      const stream = await info.download({ itag: 18 })

      if (!stream) {
        throw new Error('info.download() returned null or undefined')
      }

      console.log('✅ Format 18 stream obtained successfully')

      // Set headers for streaming
      res.setHeader('Content-Type', 'video/mp4')
        res.setHeader('Cache-Control', 'public, max-age=3600')
      res.setHeader('Accept-Ranges', 'bytes')
      res.setHeader('X-Source-Format', '18')
      res.setHeader('X-Requested-Format', requestedItag.toString())
      res.setHeader('Access-Control-Allow-Origin', '*')

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
      } catch (streamError: any) {
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
    } catch (error: any) {
      console.error('❌ Format 18 download failed:', error.message)
      return res.status(500).json({
        error: 'Format 18 download failed',
        message: error.message
      })
    }
  }

  // Fallback: Direct URL proxy (for backwards compatibility)
  if (directUrl && typeof directUrl === 'string') {
  try {
      const response = await fetch(directUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.youtube.com/',
        'Origin': 'https://www.youtube.com',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
      const contentType = response.headers.get('content-type') || 'video/mp4'
    
    res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Length', buffer.byteLength.toString())
    res.setHeader('Cache-Control', 'public, max-age=3600')
      res.setHeader('Access-Control-Allow-Origin', '*')

    return res.status(200).send(Buffer.from(buffer))
    } catch (error: any) {
    console.error('Error proxying video:', error)
    return res.status(500).json({
      error: 'Failed to proxy video',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

  return res.status(400).json({ error: 'Only videoUrl+itag mode is supported' })
}
