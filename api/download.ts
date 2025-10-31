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

// Get YouTube client instance (singleton pattern)
let ytInstance: any = null
async function getYT() {
  if (!ytInstance) {
    ytInstance = await Innertube.create({ 
      hl: 'en',
      gl: 'US'
    })
  }
  return ytInstance
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

      const yt = await getYT()
      console.log(`📥 User requested format ${requestedItag} → Downloading Format 18 (universal source)`)

      const info = await yt.getInfo(videoId, { client: 'ANDROID' } as any)

      if (!info) {
        throw new Error('Failed to get video info')
      }

      // Always download Format 18 (360p combined video+audio)
      const stream = await info.download({ itag: 18 })

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
