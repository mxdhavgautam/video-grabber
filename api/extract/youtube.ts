import type { VercelRequest, VercelResponse } from '@vercel/node'
import ytdl from '@distube/ytdl-core'

// Normalize YouTube URL
function normalizeYouTubeUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl

  try {
    const trimmed = rawUrl.trim()
    const parsed = new URL(trimmed)
    parsed.hash = ''

    const hostname = parsed.hostname.toLowerCase()

    if (hostname === 'youtu.be' || hostname.endsWith('.youtu.be')) {
      parsed.search = ''
      return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`
    }

    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
      parsed.searchParams.delete('si')
      return parsed.toString()
    }

    return trimmed
  } catch (error) {
    console.error('[Extract] Failed to normalize URL:', error)
    return rawUrl
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

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

  const normalizedUrl = normalizeYouTubeUrl(url)

  console.log('[Extract] Normalized URL:', normalizedUrl)

  if (!/https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(normalizedUrl)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' })
  }

  try {
    console.log('[Extract] Fetching info with @distube/ytdl-core...')

    const info = await ytdl.getInfo(normalizedUrl)

    console.log('[Extract] Got info:', {
      videoId: info.videoDetails.videoId,
      title: info.videoDetails.title,
      formatCount: info.formats.length,
    })

    const formats = info.formats.map((format: any) => ({
      format_id: format.itag?.toString() || 'unknown',
      format_note: format.qualityLabel || format.quality || '',
      ext: format.container || 'mp4',
      resolution: format.qualityLabel || '',
      filesize: format.contentLength ? Number(format.contentLength) : undefined,
      fps: format.fps ? Number(format.fps) : undefined,
      video_codec: format.codecs?.split(',')[0]?.trim() || undefined,
      audio_codec: format.codecs?.split(',')[1]?.trim() || undefined,
      url: format.url,
      height: format.height ? Number(format.height) : undefined,
      width: format.width ? Number(format.width) : undefined,
      hasVideo: !!format.hasVideo,
      hasAudio: !!format.hasAudio,
    }))

    console.log('[Extract] Built', formats.length, 'formats')

    return res.status(200).json({
      id: info.videoDetails.videoId,
      title: info.videoDetails.title || '',
      thumbnail: info.videoDetails.thumbnails?.[0]?.url || '',
      duration: info.videoDetails.lengthSeconds ? Number(info.videoDetails.lengthSeconds) : 0,
      formats,
      subtitle_tracks: [],
      audio_tracks: [],
      webpage_url: normalizedUrl,
      platform: 'youtube',
      description: info.videoDetails.description || undefined,
      uploader: info.videoDetails.author?.name || undefined,
      view_count: info.videoDetails.viewCount ? Number(info.videoDetails.viewCount) : undefined,
    })
  } catch (error) {
    console.error('[Extract] Error:')
    if (error instanceof Error) {
      console.error('[Extract] Message:', error.message)
      console.error('[Extract] Stack:', error.stack?.substring(0, 500))
    } else {
      console.error('[Extract] Error object:', error)
    }

    const errorMessage = error instanceof Error ? error.message : String(error)

    return res.status(500).json({
      error: 'Failed to fetch video information',
      message: errorMessage,
    })
  }
}

