import type { VercelRequest, VercelResponse } from '@vercel/node'

// Module-level cache (persists across requests in the same Lambda instance)
let cachedInnertube: any = null
let innertubeCacheTime: number = 0
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

/**
 * Get or create Innertube instance with caching
 * Reuses the same instance across requests to avoid bot detection
 */
async function getInnertubeInstance() {
  const now = Date.now()
  
  // Return cached instance if still valid
  if (cachedInnertube && (now - innertubeCacheTime) < CACHE_DURATION) {
    console.log('[Extract] Using cached Innertube instance')
    return cachedInnertube
  }

  console.log('[Extract] Creating new Innertube instance...')
  
  // @ts-ignore - runtime import
  const { Innertube }: any = await import('youtubei.js')
  
  // Create with specific options to avoid bot detection
  const yt = await Innertube.create({
    hl: 'en',
    gl: 'US',
    fetch_player: true, // Explicitly fetch player
  })
  
  cachedInnertube = yt
  innertubeCacheTime = now
  
  console.log('[Extract] New Innertube instance created and cached')
  return yt
}

/**
 * Try multiple clients with retry logic
 */
async function getVideoInfoWithRetry(yt: any, url: string, maxRetries = 3) {
  const clients = ['ANDROID', 'TV', 'WEB', 'IOS']
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    for (const client of clients) {
      try {
        console.log(`[Extract] Attempt ${attempt + 1}/${maxRetries} - Trying ${client} client...`)
        const info = await yt.getBasicInfo(url, client)
        
        if (info && (info.streaming_data || info.videoDetails)) {
          console.log(`[Extract] ✅ ${client} client worked!`)
          return info
        }
      } catch (e: any) {
        console.warn(`[Extract] ${client} failed:`, e.message?.substring(0, 100))
      }
    }
    
    // Wait before retry
    if (attempt < maxRetries - 1) {
      console.log(`[Extract] Waiting before retry ${attempt + 2}/${maxRetries}...`)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  
  throw new Error('All client attempts failed')
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Enable CORS
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

  const { url } = req.query

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL parameter is required' })
  }

  // Validate YouTube URL
  if (!/https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' })
  }

  try {
    console.log('[Extract] Starting extraction for:', url)
    const yt = await getInnertubeInstance()
    
    // Try with retry logic
    const info = await getVideoInfoWithRetry(yt, url)

    if (!info) {
      throw new Error('No info returned from YouTube')
    }

    console.log('[Extract] Got info from YouTube')

    const sd = info?.streaming_data || {}
    const adaptive = sd.adaptive_formats || []
    const formatsMuxed = sd.formats || []

    // Get all video formats (with or without audio)
    const videoFormats = [...adaptive, ...formatsMuxed]
      .filter((format: any) => format.has_video)
      .map((format: any) => ({
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
        hasVideo: !!format.has_video,
      }))

    // Get audio-only formats with language information
    const audioFormats = adaptive
      .filter((format: any) => format.has_audio && !format.has_video)
      .map((format: any) => ({
        format_id: String(format.itag),
        format_note: format.bitrate ? `${Math.round((format.bitrate || 0) / 1000)}kbps` : 'Audio',
        ext: (format.mime_type || '').includes('webm') ? 'webm' : (format.mime_type || '').includes('mp4') ? 'm4a' : 'm4a',
        filesize: format.content_length ? parseInt(format.content_length) : undefined,
        audio_codec: format.codecs,
        url: format.url,
        protocol: format.protocol || undefined,
        language: format.audio_track?.display_name || format.language || undefined,
        audio_track_id: format.audio_track?.id || undefined,
        hasAudio: !!format.has_audio,
        hasVideo: false,
      }))

    // Get unique audio tracks from adaptive formats (if available)
    const audioTracksMap = new Map<string, any>()
    
    // Group audio formats by language/track
    adaptive
      .filter((f: any) => f.mimeType?.includes('audio'))
      .forEach((format: any) => {
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
          audioTracksMap.get(language)!.format_ids.push(format.itag.toString())
        }
      })
    
    // Also check formats for audio tracks
    adaptive
      .filter((f: any) => f.has_audio && !f.has_video)
      .forEach((format: any) => {
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
          if (!audioTracksMap.get(language)!.format_ids.includes(formatId)) {
            audioTracksMap.get(language)!.format_ids.push(formatId)
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
        format_ids: audioFormats.map((f: any) => f.format_id),
      }]
    }

    // Get subtitle/caption tracks
    const subtitleTracks = info?.captions?.tracks
      ?.map((track: any, index: number) => ({
        language: track?.name?.simpleText || track?.name?.runs?.[0]?.text || track?.language_code || 'Unknown',
        language_code: track?.language_code || 'und',
        base_url: track?.base_url,
        format_id: index.toString(),
      })) || []

    console.log('[Extract] Successfully parsed', videoFormats.length + audioFormats.length, 'formats')

    return res.status(200).json({
      id: info?.basic_info?.id || info?.id || '',
      title: info?.basic_info?.title || info?.videoDetails?.title || '',
      thumbnail: (info?.basic_info?.thumbnail?.[(info?.basic_info?.thumbnail?.length || 1) - 1]?.url) || info?.videoDetails?.thumbnail?.url || '',
      duration: info?.basic_info?.duration || info?.videoDetails?.lengthSeconds || 0,
      formats: [...videoFormats, ...audioFormats],
      subtitle_tracks: subtitleTracks,
      audio_tracks: audioTracks,
      webpage_url: url,
      platform: 'youtube',
      description: info?.basic_info?.short_description || info?.videoDetails?.description || undefined,
      uploader: info?.basic_info?.author || info?.videoDetails?.author?.name || undefined,
      view_count: info?.basic_info?.view_count ? Number(info.basic_info.view_count) : info?.videoDetails?.viewCount ? Number(info.videoDetails.viewCount) : undefined,
    })
  } catch (error) {
    console.error('[Extract] Error:')
    if (error instanceof Error) {
      console.error('[Extract] Message:', error.message)
      console.error('[Extract] Stack:', error.stack?.substring(0, 500))
    } else {
      console.error('[Extract] Error:', error)
    }

    return res.status(500).json({
      error: 'Failed to fetch video information',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

