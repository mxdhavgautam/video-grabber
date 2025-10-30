import ytdl from '@distube/ytdl-core'

// Simple Bun server for API routes in development
const server = Bun.serve({
  port: 3001,
  async fetch(req) {
    const url = new URL(req.url)
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Extract endpoint
    if (url.pathname === '/api/extract') {
      const videoUrl = url.searchParams.get('url')
      
      if (!videoUrl) {
        return new Response(JSON.stringify({ error: 'URL parameter is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Only support YouTube
      if (!ytdl.validateURL(videoUrl)) {
        return new Response(JSON.stringify({ error: 'Invalid YouTube URL' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      try {
        const info = await ytdl.getInfo(videoUrl)

        const formats = info.formats
          .filter(format => format.hasVideo && format.hasAudio)
          .map(format => ({
            format_id: format.itag.toString(),
            format_note: format.qualityLabel || format.quality,
            ext: format.container || 'mp4',
            resolution: format.qualityLabel || format.quality,
            filesize: format.contentLength ? parseInt(format.contentLength) : undefined,
            fps: format.fps,
            video_codec: format.videoCodec,
            audio_codec: format.audioCodec,
            url: format.url,
            protocol: format.protocol,
            width: format.width,
            height: format.height,
          }))

        const audioFormats = info.formats
          .filter(format => format.hasAudio && !format.hasVideo)
          .map(format => ({
            format_id: format.itag.toString(),
            format_note: format.audioBitrate ? `${format.audioBitrate}kbps` : 'Audio',
            ext: format.container || 'm4a',
            filesize: format.contentLength ? parseInt(format.contentLength) : undefined,
            audio_codec: format.audioCodec,
            url: format.url,
            protocol: format.protocol,
          }))

        const audioTracks = info.player_response?.captions?.playerCaptionsTracklistRenderer?.captionTracks
          ?.map((track: any, index: number) => ({
            language: track.name?.simpleText || track.name?.runs?.[0]?.text || 'Unknown',
            language_code: track.languageCode,
            format_id: index.toString(),
          })) || []

        return new Response(JSON.stringify({
          id: info.videoDetails.videoId,
          title: info.videoDetails.title,
          thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1]?.url || '',
          duration: parseInt(info.videoDetails.lengthSeconds),
          formats: [...formats, ...audioFormats],
          audio_tracks: audioTracks,
          webpage_url: videoUrl,
          platform: 'youtube',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      } catch (error) {
        console.error('Error:', error)
        return new Response(JSON.stringify({
          error: 'Failed to fetch video information',
          message: error instanceof Error ? error.message : 'Unknown error',
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // Download proxy
    if (url.pathname === '/api/download') {
      const videoUrl = url.searchParams.get('url')
      
      if (!videoUrl) {
        return new Response(JSON.stringify({ error: 'URL parameter is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      try {
        const response = await fetch(videoUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        })

        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.statusText}`)
        }

        const buffer = await response.arrayBuffer()
        const contentType = response.headers.get('content-type') || 'video/mp4'

        return new Response(buffer, {
          headers: {
            ...corsHeaders,
            'Content-Type': contentType,
            'Content-Length': buffer.byteLength.toString(),
            'Cache-Control': 'public, max-age=3600',
          },
        })
      } catch (error) {
        return new Response(JSON.stringify({
          error: 'Failed to proxy video',
          message: error instanceof Error ? error.message : 'Unknown error',
        }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response('Not found', { status: 404 })
  },
})

console.log(`✅ API server running on http://localhost:${server.port}`)
console.log('Ready to accept requests!')

