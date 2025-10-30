import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createContext, runInNewContext } from 'vm'
import { Innertube, Platform } from 'youtubei.js'
import ytdl from 'ytdl-core'

function normalizeYouTubeUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl

  try {
    const trimmed = rawUrl.trim()
    const parsed = new URL(trimmed)

    // Remove hash fragments in all cases
    parsed.hash = ''

    const hostname = parsed.hostname.toLowerCase()

    if (hostname === 'youtu.be' || hostname.endsWith('.youtu.be')) {
      // Short links should not include query params like ?si=...
      parsed.search = ''
      return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`
    }

    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
      // Remove the "si" parameter (mobile share URLs) but keep others like "v", "t", etc.
      parsed.searchParams.delete('si')
      // youtubei.js is happy with canonical URL order
      return parsed.toString()
    }

    return trimmed
  } catch (error) {
    console.error('[Extract] Failed to normalize URL, using raw input', error)
    return rawUrl
  }
}

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

// Client types to try in order of preference for bypassing restrictions
const CLIENT_TYPES = [
  'TV_EMBEDDED', // Try TV_EMBEDDED first - often less restricted
  'WEB', // Standard web client
  'MWEB', // Mobile web
  'ANDROID', // Android client
  'IOS', // iOS client
]

let ytSingleton: Innertube | null = null
let currentClientType: string = 'TV_EMBEDDED'

async function getYT(clientType?: string): Promise<Innertube> {
  const targetClientType = clientType || currentClientType

  // If we already have a singleton and it's using the requested client, return it
  if (ytSingleton && currentClientType === targetClientType) {
    return ytSingleton
  }

  // Create new instance with specified client
  console.log(`[Extract] Creating Innertube instance with client: ${targetClientType}`)

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

  ytSingleton = await Innertube.create({
    ...clientConfig,
    cookie: realCookies,
    // Try to generate a visitor data that looks realistic
    visitor_data: 'Cgt1UzEtQ29va2llEgV1UzEt',
  })

  currentClientType = targetClientType
  return ytSingleton
}

// Try to get video info with fallback client strategy
async function getVideoInfoWithFallback(videoId: string): Promise<any> {
  let lastError: any = null

  for (const clientType of CLIENT_TYPES) {
    try {
      console.log(`[Extract] Trying client: ${clientType}`)
      const yt = await getYT(clientType)

      // Try yt.getInfo first, which might be more reliable
      try {
        const info = await yt.getInfo(videoId, {
          client: clientType,
          // Add some parameters that might help with bot detection
          htm: '1', // HTML5
        } as any)

        // Check if the video info was retrieved successfully
        // Need at least title/basic info
        const basicInfo = info.basic_info || info.video_details || info
        const hasTitle = basicInfo?.title && basicInfo.title.trim() !== ''
        const hasValidInfo = info && hasTitle

        if (hasValidInfo) {
          console.log(`[Extract] Successfully got video info with client: ${clientType} using getInfo`)
          console.log(`[Extract] Title: "${basicInfo.title}"`)
          return info
        } else {
          console.log(`[Extract] getInfo returned incomplete data for ${clientType}:`, {
            hasTitle,
            title: basicInfo?.title,
            infoKeys: Object.keys(info || {})
          })
          throw new Error('Incomplete video info received')
        }
      } catch (getInfoError) {
        console.log(`[Extract] getInfo failed for ${clientType}, trying actions.execute:`, getInfoError.message)

        // Fallback to actions.execute
        const playerResponse = await yt.actions.execute('/player', {
          videoId,
          client: clientType
        } as any)

        if (!playerResponse) {
          throw new Error('Player response is empty')
        }

        // Check playability status - the actual data is in playerResponse.data
        const youtubeData = playerResponse.data || playerResponse

        console.log(`[Extract] Player response keys for ${clientType}:`, Object.keys(playerResponse))
        console.log(`[Extract] YouTube data keys:`, Object.keys(youtubeData))

        if (youtubeData.playabilityStatus?.status !== 'OK') {
          const status = youtubeData.playabilityStatus?.status || 'UNKNOWN'
          const reason = youtubeData.playabilityStatus?.reason || 'No specific reason provided.'

          console.log(`[Extract] Playability status for ${clientType}:`, {
            status,
            reason,
            fullPlayabilityStatus: youtubeData.playabilityStatus
          })

          // For any non-OK status, try next client
          console.log(`[Extract] ${clientType} client got ${status}, trying next client...`)
          lastError = new Error(`${status}: ${reason}`)
          continue
        }

        console.log(`[Extract] Successfully got video info with client: ${clientType} using actions.execute`)
        // Format the player response to match expected structure
        const videoDetails = youtubeData?.videoDetails || {}
        const streamingData = youtubeData?.streamingData || {}

        return {
          id: videoDetails.videoId || videoId,
          title: videoDetails.title || '',
          thumbnail: videoDetails.thumbnail?.thumbnails?.[0]?.url || '',
          duration: videoDetails.lengthSeconds ? Number(videoDetails.lengthSeconds) : 0,
          formats: [], // Will be handled by fallback in frontend
          subtitle_tracks: youtubeData?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.map((track: any, index: number) => ({
            language: track?.name?.simpleText || track?.name?.runs?.[0]?.text || track?.languageCode || 'Unknown',
            language_code: track?.languageCode || 'und',
            base_url: track?.baseUrl,
            format_id: index.toString(),
          })) || [],
          audio_tracks: [],
          webpage_url: normalizedUrl,
          platform: 'youtube',
          description: videoDetails.shortDescription || videoDetails.description || undefined,
          uploader: videoDetails.author || undefined,
          view_count: videoDetails.viewCount ? Number(videoDetails.viewCount) : undefined,
          streaming_data: streamingData,
          basic_info: videoDetails,
        }
      }

    } catch (error: any) {
      console.error(`[Extract] Client ${clientType} failed:`, error.message)
      console.error(`[Extract] Error details:`, {
        message: error.message,
        stack: error.stack?.substring(0, 200),
        includesUnknown: error.message.includes('UNKNOWN'),
        includesLoginRequired: error.message.includes('LOGIN_REQUIRED')
      })
      lastError = error

      // Continue to next client for various client-specific errors
      if (error.message.includes('LOGIN_REQUIRED') ||
          error.message.includes('403') ||
          error.message.includes('UNKNOWN') ||
          error.message.includes('fetch') ||
          error.message.includes('Request to') ||
          error.message.includes('status code')) {
        console.log(`[Extract] Retrying with next client due to error: ${error.message}`)
        continue
      }

      // For other errors, fail immediately
      throw error
    }
  }

  // All YouTube.js clients failed - try ytdl-core as last resort
  console.log('[Extract] All YouTube.js clients failed, trying ytdl-core as fallback')
  try {
    // Try with specific options that might bypass bot detection
    const ytdlInfo = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`, {
      requestOptions: {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        }
      }
    })

    if (ytdlInfo && ytdlInfo.videoDetails) {
      console.log('[Extract] Successfully got video info with ytdl-core')

      const videoDetails = ytdlInfo.videoDetails
      const formats = ytdlInfo.formats || []

      return {
        id: videoDetails.videoId || videoId,
        title: videoDetails.title || '',
        thumbnail: videoDetails.thumbnails?.[0]?.url || '',
        duration: videoDetails.lengthSeconds ? Number(videoDetails.lengthSeconds) : 0,
        formats: formats.map((format: any, index: number) => ({
          format_id: format.itag?.toString() || index.toString(),
          format_note: format.qualityLabel || format.quality || '',
          ext: format.container || 'mp4',
          resolution: format.qualityLabel || '',
          filesize: format.contentLength ? Number(format.contentLength) : undefined,
          fps: format.fps ? Number(format.fps) : undefined,
          video_codec: format.codecs?.split(',')[0] || undefined,
          audio_codec: format.codecs?.split(',')[1] || undefined,
          url: format.url,
          hasVideo: !!format.hasVideo,
          hasAudio: !!format.hasAudio,
        })),
        subtitle_tracks: [],
        audio_tracks: [],
        webpage_url: `https://www.youtube.com/watch?v=${videoId}`,
        platform: 'youtube',
        description: videoDetails.description || undefined,
        uploader: videoDetails.author?.name || undefined,
        view_count: videoDetails.viewCount ? Number(videoDetails.viewCount) : undefined,
      }
    }
  } catch (ytdlError: any) {
    console.error('[Extract] ytdl-core also failed:', ytdlError.message)
  }

  // All methods failed
  throw new Error(`All extraction methods failed. Last error: ${lastError?.message || 'Unknown error'}`)
}

function determineExtension(mimeType: string): string {
  if (!mimeType) return 'mp4'
  if (mimeType.includes('webm')) return 'webm'
  if (mimeType.includes('3gpp')) return '3gp'
  if (mimeType.includes('mp4')) return 'mp4'
  return 'mp4'
}

function parseCodecs(mimeType: string, fallback?: string) {
  const result = { video: undefined as string | undefined, audio: undefined as string | undefined }
  const target = mimeType || ''
  const match = target.match(/codecs="([^"]+)"/)
  const codecString = match?.[1] || fallback || ''

  if (!codecString) {
    return result
  }

  const parts = codecString.split(',').map((part) => part.trim())

  if (parts.length === 1) {
    if (parts[0].startsWith('mp4a') || parts[0].startsWith('opus') || parts[0].startsWith('vorbis')) {
      result.audio = parts[0]
    } else {
      result.video = parts[0]
    }
  } else {
    result.video = parts[0]
    result.audio = parts[1]
  }

  return result
}

function normalizeFormat(format: any) {
  const mimeType = format.mimeType || format.mime_type || ''
  const codecs = parseCodecs(mimeType, format.codecs)
  const hasVideo = format.hasVideo ?? format.has_video ?? typeof (format.height ?? format.heightPixels) === 'number'
  const hasAudio = format.hasAudio ?? format.has_audio ?? Boolean(format.audioQuality || format.audioChannels)
  const width = format.width ?? format.widthPixels
  const height = format.height ?? format.heightPixels
  const resolution = format.qualityLabel || format.quality || (height ? `${height}p` : undefined)
  const contentLength = format.contentLength || format.content_length || format.clen
  const fps = format.fps ?? format.frameRate
  const languageCode = format.audioTrack?.languageCode || format.language || format.languageCode || 'default'
  const language = format.audioTrack?.displayName || format.language || (languageCode === 'default' ? 'Default' : languageCode)

  return {
    format_id: String(format.itag),
    format_note: resolution,
    ext: determineExtension(mimeType),
    resolution,
    filesize: contentLength ? Number(contentLength) : undefined,
    fps: fps ? Number(fps) : undefined,
    video_codec: codecs.video,
    audio_codec: codecs.audio,
    url: format.url,
    protocol: format.protocol || undefined,
    width: width ? Number(width) : undefined,
    height: height ? Number(height) : undefined,
    hasVideo,
    hasAudio,
    language: language || undefined,
    audio_track_id: format.audioTrack?.id || format.audio_track?.id || undefined,
  }
}

function isAudioOnlyFormat(format: any) {
  const hasVideo = format.hasVideo ?? format.has_video ?? typeof (format.height ?? format.heightPixels) === 'number'
  const hasAudio = format.hasAudio ?? format.has_audio ?? Boolean(format.audioQuality || format.audioChannels)
  return hasAudio && !hasVideo
}

function buildVideoFormats(adaptiveFormats: any[], muxedFormats: any[]) {
  const normalizedAdaptive = adaptiveFormats.map(normalizeFormat)
  const normalizedMuxed = muxedFormats.map(normalizeFormat)
  return [...normalizedAdaptive.filter((format) => format.hasVideo), ...normalizedMuxed.filter((format) => format.hasVideo)]
}

function buildAudioFormats(adaptiveFormats: any[]) {
  return adaptiveFormats.map(normalizeFormat).filter((format) => format.hasAudio && !format.hasVideo)
}

function buildAudioTracks(adaptiveFormats: any[], normalizedAudioFormats: any[]) {
  const audioTracksMap = new Map<string, { language: string; language_code: string; format_ids: string[]; track_id?: string }>()

  adaptiveFormats.forEach((format: any) => {
    if (!isAudioOnlyFormat(format)) return

    const languageCode = format.audioTrack?.languageCode || format.language || 'default'
    const languageName = format.audioTrack?.displayName || format.language || (languageCode === 'default' ? 'Default' : languageCode)
    const trackId = format.audioTrack?.id || String(format.itag)

    if (!audioTracksMap.has(languageCode)) {
      audioTracksMap.set(languageCode, {
        language: languageName,
        language_code: languageCode,
        format_ids: [],
        track_id: trackId,
      })
    }

    audioTracksMap.get(languageCode)!.format_ids.push(String(format.itag))
  })

  if (!audioTracksMap.size) {
    return [
      {
        language: 'Default',
        language_code: 'default',
        format_id: '0',
        format_ids: normalizedAudioFormats.map((format) => format.format_id),
      },
    ]
  }

  return Array.from(audioTracksMap.values()).map((track, index) => ({
    ...track,
    format_id: index.toString(),
  }))
}

function buildSubtitleTracks(playerResponse: any) {
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []

  return tracks.map((track: any, index: number) => {
    const name = track?.name?.simpleText || track?.name?.runs?.[0]?.text || track?.languageCode || 'Unknown'
    return {
      language: name,
      language_code: track?.languageCode || 'und',
      base_url: track?.baseUrl,
      format_id: index.toString(),
    }
  })
}

function extractHighestThumbnail(thumbnails?: Array<{ url: string }>) {
  if (!thumbnails || !thumbnails.length) return undefined
  return thumbnails[thumbnails.length - 1]?.url || thumbnails[0]?.url
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

  const normalizedUrl = normalizeYouTubeUrl(url)

  console.log('[Extract] Normalized URL:', normalizedUrl)

  // Validate YouTube URL
  if (!/https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(normalizedUrl)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' })
  }

  // Extract video ID - handle youtu.be URLs with query parameters
  // Pattern: youtube.com/watch?v=VIDEO_ID or youtu.be/VIDEO_ID or youtube.com/embed/VIDEO_ID
  const videoIdMatch = normalizedUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/)
  const videoId = videoIdMatch ? videoIdMatch[1] : null
  
  if (!videoId) {
    return res.status(400).json({ error: 'Could not extract video ID from URL' })
  }

  console.log(`[Extract] Extracted video ID: ${videoId} from URL: ${normalizedUrl}`)

  try {
    // Use the fallback strategy to get video info
    const playerResponse = await getVideoInfoWithFallback(videoId)

    // Extract streaming data from the response
    const streamingData = playerResponse?.streamingData || playerResponse?.streaming_data || {}
    const adaptiveFormats = streamingData.adaptiveFormats || streamingData.adaptive_formats || []
    const muxedFormats = streamingData.formats || []

    console.log('[Extract] Format counts', {
      videoFormats: adaptiveFormats.length + muxedFormats.length,
      audioFormats: adaptiveFormats.filter((format: any) => isAudioOnlyFormat(format)).length,
      adaptiveCount: adaptiveFormats.length,
      muxedCount: muxedFormats.length,
      hasStreamingData: !!streamingData,
      streamingDataKeys: Object.keys(streamingData)
    })

    // Don't fail if no formats - some videos might not have formats in the initial response
    // The frontend can handle download via the download endpoint
    if (!adaptiveFormats.length && !muxedFormats.length) {
      console.log('[Extract] No formats found in response, but continuing with basic video info')
    }

    const videoFormats = buildVideoFormats(adaptiveFormats, muxedFormats)
    const audioFormats = buildAudioFormats(adaptiveFormats)
    const audioTracks = buildAudioTracks(adaptiveFormats, audioFormats)
    const subtitleTracks = buildSubtitleTracks(playerResponse)

    const videoDetails = playerResponse?.videoDetails || {}

    return res.status(200).json({
      id: videoDetails.videoId || videoId,
      title: videoDetails.title || '',
      thumbnail: extractHighestThumbnail(videoDetails?.thumbnail?.thumbnails) || '',
      duration: videoDetails.lengthSeconds ? Number(videoDetails.lengthSeconds) : 0,
      formats: [...videoFormats, ...audioFormats],
      subtitle_tracks: subtitleTracks,
      audio_tracks: audioTracks,
      webpage_url: normalizedUrl,
      platform: 'youtube',
      description: videoDetails.shortDescription || undefined,
      uploader: videoDetails.author || undefined,
      view_count: videoDetails.viewCount ? Number(videoDetails.viewCount) : undefined,
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

