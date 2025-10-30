import type { VercelRequest, VercelResponse } from '@vercel/node'
import ytdl from 'ytdl-core'

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { url, videoUrl, itag } = req.query as { [key: string]: string }

  // ytdl streaming path
  if (videoUrl && itag) {
    try {
      const itagNum = parseInt(itag, 10)
      const stream = ytdl(videoUrl, { quality: itagNum })
      stream.on('response', ytRes => {
        const contentType = ytRes.headers['content-type'] || 'application/octet-stream'
        const contentLength = ytRes.headers['content-length']
        res.setHeader('Content-Type', contentType)
        if (contentLength) res.setHeader('Content-Length', contentLength)
        res.setHeader('Cache-Control', 'public, max-age=3600')
      })
      stream.on('error', err => {
        console.error('ytdl stream error:', err)
        res.status(500).json({ error: 'Failed to stream video', message: err.message })
      })
      stream.pipe(res)
      return
    } catch (error) {
      console.error('Error proxying video via ytdl:', error)
      return res.status(500).json({
        error: 'Failed to proxy video via ytdl',
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL parameter is required' })
  }

  // Proxy the video download to bypass CORS
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.youtube.com/',
        'Origin': 'https://www.youtube.com',
      },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      console.error('Download failed:', response.status, response.statusText, errorText.substring(0, 200))
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`)
    }

    // Stream the response
    const buffer = await response.arrayBuffer()
    
    // Set appropriate headers
    const contentType = response.headers.get('content-type') || 'video/mp4'
    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', buffer.byteLength)
    res.setHeader('Cache-Control', 'public, max-age=3600')

    return res.status(200).send(Buffer.from(buffer))
  } catch (error) {
    console.error('Error proxying video:', error)
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack')
    return res.status(500).json({
      error: 'Failed to proxy video',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

