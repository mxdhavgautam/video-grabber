import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createContext, runInNewContext } from 'vm'
import { Innertube, Platform } from 'youtubei.js'

// Set up JavaScript interpreter for signature deciphering (same as api/download.ts)
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

  // Extract video ID - handle youtu.be URLs with query parameters
  // Pattern: youtube.com/watch?v=VIDEO_ID or youtu.be/VIDEO_ID or youtube.com/embed/VIDEO_ID
  const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/)
  const videoId = videoIdMatch ? videoIdMatch[1] : null
  
  if (!videoId) {
    return res.status(400).json({ error: 'Could not extract video ID from URL' })
  }

  console.log(`[Extract] Extracted video ID: ${videoId} from URL: ${url}`)

  try {
    const yt = await Innertube.create({ hl: 'en', gl: 'US' } as any)
    let info: any
    let lastError: any = null
    
    // Try multiple client types to find one that works
    const clients = ['ANDROID', 'IOS', 'WEB', 'TV_EMBEDDED'] as const
    
    for (const client of clients) {
      try {
        console.log(`[Extract] Trying client: ${client}`)
        info = await yt.getInfo(videoId, { client } as any)
        
        // If we got info, check if it has useful data
        if (info) {
          console.log(`[Extract] Got info from ${client} client, checking data...`)
          // Check if we have any of the expected data structures
          if (info.streaming_data || info.basic_info || info.video_details || info.adaptive_formats || info.formats) {
            console.log(`[Extract] Successfully retrieved info using ${client} client`)
            break
          } else {
            console.warn(`[Extract] Client ${client} returned info but missing expected fields, trying next client`)
            info = null
          }
        }
      } catch (e: any) {
        console.error(`[Extract] Client ${client} failed:`, e.message)
        lastError = e
        info = null
        continue
      }
    }
    
    // If all clients failed, try without specifying client
    if (!info) {
      console.log('[Extract] Trying default client (no client specified)')
      try {
        info = await yt.getInfo(videoId)
        if (info && !info.streaming_data && !info.basic_info && !info.video_details && !info.adaptive_formats && !info.formats) {
          console.warn('[Extract] Default client returned info but missing expected fields')
          info = null
        }
      } catch (e: any) {
        console.error('[Extract] Default client also failed:', e.message)
        lastError = e
      }
    }

    if (!info) {
      throw new Error(`Failed to get video info: ${lastError?.message || 'All clients failed'}`)
    }

    console.log(`[Extract] Successfully retrieved info for video ID: ${videoId}`)

    // Handle different response structures from youtubei.js
    // Some clients return streaming_data directly, others nest it differently
    let streamingData = info.streaming_data
    let basicInfo = info.basic_info || info.video_details
    let adaptiveFormats: any[] = []
    let formatsMuxed: any[] = []
    
    // Try to get streaming data from various possible locations
    if (streamingData) {
      adaptiveFormats = streamingData.adaptive_formats || []
      formatsMuxed = streamingData.formats || []
    } else if (info.playability_status?.status === 'OK') {
      // Sometimes streaming_data is nested differently
      streamingData = info.video_details?.streaming_data || info.streaming_data
      if (streamingData) {
        adaptiveFormats = streamingData.adaptive_formats || []
        formatsMuxed = streamingData.formats || []
      }
    }
    
    // If still no formats, try to get from info directly
    if (adaptiveFormats.length === 0 && formatsMuxed.length === 0) {
      adaptiveFormats = info.adaptive_formats || []
      formatsMuxed = info.formats || []
    }

    console.log(`[Extract] Found ${adaptiveFormats.length} adaptive formats, ${formatsMuxed.length} muxed formats`)

    const sd = streamingData || {}
    const adaptive = adaptiveFormats
    const formats = formatsMuxed

    // Get all video formats (with or without audio)
    const videoFormats = [...adaptive, ...formats]
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
        video_codec: undefined, // Explicitly set to undefined for audio-only
        vcodec: undefined, // Explicitly set to undefined for audio-only
        hasVideo: false, // Explicitly mark as audio-only
        hasAudio: true,
        url: format.url,
        protocol: format.protocol || undefined,
        language: format.audio_track?.display_name || format.language || undefined,
        audio_track_id: format.audio_track?.id || undefined,
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

    return res.status(200).json({
      id: basicInfo?.id || info?.id || videoId || '',
      title: basicInfo?.title || info?.title || '',
      thumbnail: (basicInfo?.thumbnail?.[(basicInfo?.thumbnail?.length || 1) - 1]?.url) || info?.thumbnail?.[0]?.url || '',
      duration: basicInfo?.duration || info?.duration || 0,
      formats: [...videoFormats, ...audioFormats],
      subtitle_tracks: subtitleTracks,
      audio_tracks: audioTracks,
      webpage_url: url,
      platform: 'youtube',
      description: basicInfo?.short_description || basicInfo?.description || info?.description || undefined,
      uploader: basicInfo?.author || basicInfo?.channel?.name || info?.channel?.name || undefined,
      view_count: basicInfo?.view_count ? Number(basicInfo.view_count) : (info?.view_count ? Number(info.view_count) : undefined),
    })
  } catch (error) {
    console.error('Error fetching YouTube info:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorStack = error instanceof Error ? error.stack : undefined
    console.error('Error details:', { errorMessage, errorStack })
    return res.status(500).json({
      error: 'Failed to fetch video information',
      message: errorMessage,
      stack: errorStack,
    })
  }
}

