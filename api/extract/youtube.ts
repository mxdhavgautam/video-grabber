import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Extract video info directly from YouTube page HTML
 * This bypasses Innertube and goes straight to the source
 */
async function extractFromPageHTML(url: string) {
  console.log('[Extract] Attempting direct HTML extraction...')
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
  
  const html = await response.text()
  
  // Extract initialData from the page
  const initialDataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/)
  if (!initialDataMatch) {
    throw new Error('Could not find ytInitialData in page')
  }
  
  const initialData = JSON.parse(initialDataMatch[1])
  
  // Extract video details from initialData
  const videoDetails = initialData?.contents?.twoColumnWatchNextResults?.result?.results?.results?.contents?.[0]?.videoPrimaryInfoRenderer
  
  if (!videoDetails) {
    throw new Error('Could not extract video details from initialData')
  }
  
  return { initialData, videoDetails }
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
    console.log('[Extract] Attempting extraction for:', url)
    
    // Try direct HTML extraction first
    let pageData
    try {
      pageData = await extractFromPageHTML(url)
      console.log('[Extract] ✅ Direct HTML extraction successful')
    } catch (htmlError: any) {
      console.warn('[Extract] HTML extraction failed:', htmlError.message)
      // Fall back to Innertube
      throw htmlError
    }

    // If we got here, we have page data
    // For now, return a minimal response to test if this approach works
    return res.status(200).json({
      id: 'extracted-from-html',
      title: 'Successfully extracted from HTML (TEST)',
      thumbnail: '',
      duration: 0,
      formats: [],
      subtitle_tracks: [],
      audio_tracks: [],
      webpage_url: url,
      platform: 'youtube',
    })
  } catch (error) {
    console.error('[Extract] Error:')
    if (error instanceof Error) {
      console.error('[Extract] Message:', error.message)
    } else {
      console.error('[Extract] Error:', error)
    }

    // Fall back to old Innertube method with caching
    try {
      console.log('[Extract] Falling back to Innertube...')
      const { Innertube }: any = await import('youtubei.js')
      const yt = await Innertube.create({ hl: 'en', gl: 'US' })
      
      const info = await yt.getBasicInfo(url, 'ANDROID').catch((e: any) => 
        yt.getBasicInfo(url, 'TV')
      )

      if (!info) {
        throw new Error('Innertube also failed')
      }

      const sd = info?.streaming_data || {}
      const adaptive = sd.adaptive_formats || []
      const formatsMuxed = sd.formats || []

      const videoFormats = [...adaptive, ...formatsMuxed]
        .filter((format: any) => format.has_video)
        .map((format: any) => ({
          format_id: String(format.itag),
          format_note: format.quality_label || format.quality || undefined,
          ext: (format.mime_type || '').includes('webm') ? 'webm' : 'mp4',
          resolution: format.quality_label || format.quality || undefined,
          filesize: format.content_length ? parseInt(format.content_length) : undefined,
          fps: format.fps,
          video_codec: format.codecs,
          audio_codec: format.audio_codec || undefined,
          url: format.url,
          width: format.width,
          height: format.height,
          hasAudio: !!format.has_audio,
          hasVideo: !!format.has_video,
        }))

      const audioFormats = adaptive
        .filter((format: any) => format.has_audio && !format.has_video)
        .map((format: any) => ({
          format_id: String(format.itag),
          format_note: format.bitrate ? `${Math.round((format.bitrate || 0) / 1000)}kbps` : 'Audio',
          ext: (format.mime_type || '').includes('webm') ? 'webm' : 'm4a',
          filesize: format.content_length ? parseInt(format.content_length) : undefined,
          audio_codec: format.codecs,
          url: format.url,
          language: format.audio_track?.display_name || format.language || undefined,
          hasAudio: !!format.has_audio,
          hasVideo: false,
        }))

      return res.status(200).json({
        id: info?.basic_info?.id || '',
        title: info?.basic_info?.title || '',
        thumbnail: (info?.basic_info?.thumbnail?.[(info?.basic_info?.thumbnail?.length || 1) - 1]?.url) || '',
        duration: info?.basic_info?.duration || 0,
        formats: [...videoFormats, ...audioFormats],
        subtitle_tracks: [],
        audio_tracks: [],
        webpage_url: url,
        platform: 'youtube',
      })
    } catch (fallbackError: any) {
      console.error('[Extract] Both methods failed')
      return res.status(500).json({
        error: 'Failed to fetch video information',
        message: 'Could not extract video using any method',
      })
    }
  }
}

