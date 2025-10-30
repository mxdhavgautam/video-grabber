import type { VercelRequest, VercelResponse } from '@vercel/node'

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
    // @ts-ignore - runtime import, no types needed
    const { Innertube }: any = await import('youtubei.js')
    const yt = await Innertube.create({ hl: 'en', gl: 'US' })
    let info: any
    try {
      info = await yt.getBasicInfo(url, 'ANDROID')
    } catch (e) {
      info = await yt.getBasicInfo(url, 'TV')
    }

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
      }))

    // Get unique audio tracks from adaptive formats (if available)
    const adaptiveFormats = adaptive
    const audioTracksMap = new Map<string, any>()
    
    // Group audio formats by language/track
    adaptiveFormats
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

    return res.status(200).json({
      id: info?.basic_info?.id || info?.id || '',
      title: info?.basic_info?.title || '',
      thumbnail: (info?.basic_info?.thumbnail?.[(info?.basic_info?.thumbnail?.length || 1) - 1]?.url) || '',
      duration: info?.basic_info?.duration || 0,
      formats: [...videoFormats, ...audioFormats],
      subtitle_tracks: subtitleTracks,
      audio_tracks: audioTracks,
      webpage_url: url,
      platform: 'youtube',
      description: info?.basic_info?.short_description || undefined,
      uploader: info?.basic_info?.author || undefined,
      view_count: info?.basic_info?.view_count ? Number(info.basic_info.view_count) : undefined,
    })
  } catch (error) {
    console.error('Error fetching YouTube info:', error)
    return res.status(500).json({
      error: 'Failed to fetch video information',
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

