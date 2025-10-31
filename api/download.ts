import type { VercelRequest, VercelResponse } from '@vercel/node'
import ytdl from '@distube/ytdl-core'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { videoUrl, itag } = req.query as { videoUrl?: string; itag?: string }

  if (!videoUrl || !itag) {
    return res.status(400).json({
      error: 'Missing parameters',
      required: ['videoUrl', 'itag']
    })
  }

  try {
    console.log(`[Download] Requesting format ${itag} for:`, videoUrl)

    // Get video info
    const info = await ytdl.getInfo(videoUrl)

    // Find the format matching the itag
    const format = info.formats.find((f: any) => f.itag?.toString() === itag)

    if (!format || !format.url) {
      // Try getting just that format directly
      const stream = ytdl(videoUrl, {
        quality: itag,
      })

      res.setHeader('Content-Type', 'video/mp4')
      res.setHeader('Cache-Control', 'public, max-age=3600')
      res.setHeader('Access-Control-Allow-Origin', '*')

      stream.pipe(res)

      stream.on('error', (error: any) => {
        console.error('[Download] Stream error:', error.message)
        if (!res.headersSent) {
          res.status(500).json({
            error: 'Download stream error',
            message: error.message,
          })
        } else {
          res.end()
        }
      })

      return
    }

    // Download the format
    const stream = ytdl(videoUrl, {
      format: format.itag,
    })

    res.setHeader('Content-Type', format.mimeType || 'video/mp4')
    res.setHeader('Cache-Control', 'public, max-age=3600')
    res.setHeader('Access-Control-Allow-Origin', '*')

    stream.pipe(res)

    stream.on('error', (error: any) => {
      console.error('[Download] Stream error:', error.message)
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Download stream error',
          message: error.message,
        })
      } else {
        res.end()
      }
    })
  } catch (error) {
    console.error('[Download] Error:')
    if (error instanceof Error) {
      console.error('[Download] Message:', error.message)
      console.error('[Download] Stack:', error.stack?.substring(0, 500))
    } else {
      console.error('[Download] Error object:', error)
    }

    const errorMessage = error instanceof Error ? error.message : String(error)

    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Download failed',
        message: errorMessage,
      })
    } else {
      res.end()
    }
  }
}
