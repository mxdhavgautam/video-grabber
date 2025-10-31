import type { VercelRequest, VercelResponse } from '@vercel/node'
import { IncomingMessage } from 'http'
import https from 'https'
import http from 'http'

/**
 * Minimal stream proxy - just forwards bytes from a URL
 * Used by client-side yt-dlp extraction to bypass CORS
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { url } = req.query as { url?: string }

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL parameter is required' })
  }

  // Validate URL is from YouTube CDN
  try {
    const parsedUrl = new URL(url)
    const hostname = parsedUrl.hostname.toLowerCase()

    // Only allow YouTube streaming URLs
    if (!hostname.includes('googlevideo.com') && !hostname.includes('youtube.com')) {
      return res.status(403).json({ error: 'Only YouTube URLs allowed' })
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' })
  }

  try {
    console.log('[Stream] Proxying:', url.substring(0, 100) + '...')

    // Determine protocol
    const protocol = url.startsWith('https') ? https : http

    // Pass through Range header if present for resumable downloads
    const headers: any = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }

    if (req.headers.range) {
      headers['Range'] = req.headers.range
    }

    return new Promise((resolve) => {
      const proxyReq = protocol.get(url, { headers }, (proxyRes: IncomingMessage) => {
        console.log('[Stream] Got response:', proxyRes.statusCode)

        // Forward status code and headers
        res.status(proxyRes.statusCode || 200)

        // Forward important headers
        if (proxyRes.headers['content-type']) {
          res.setHeader('Content-Type', proxyRes.headers['content-type'])
        }
        if (proxyRes.headers['content-length']) {
          res.setHeader('Content-Length', proxyRes.headers['content-length'])
        }
        if (proxyRes.headers['content-range']) {
          res.setHeader('Content-Range', proxyRes.headers['content-range'])
        }

        // Always set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*')

        // Pipe the stream directly
        proxyRes.pipe(res)

        proxyRes.on('error', (error: Error) => {
          console.error('[Stream] Proxy response error:', error.message)
          if (!res.headersSent) {
            res.status(502).json({ error: 'Stream error', message: error.message })
          }
          resolve(undefined)
        })

        proxyRes.on('end', () => {
          console.log('[Stream] Stream ended')
          resolve(undefined)
        })
      })

      proxyReq.on('error', (error: Error) => {
        console.error('[Stream] Proxy request error:', error.message)
        if (!res.headersSent) {
          res.status(502).json({ error: 'Failed to connect', message: error.message })
        }
        resolve(undefined)
      })

      // Set timeout
      proxyReq.setTimeout(300000) // 5 minutes
    })
  } catch (error) {
    console.error('[Stream] Error:')
    if (error instanceof Error) {
      console.error('[Stream] Message:', error.message)
    }

    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Stream proxy failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
