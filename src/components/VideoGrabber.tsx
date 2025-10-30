import { useState, useMemo, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/components/ui/use-toast'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Download, Video, Music, Link2, Info } from 'lucide-react'
import { extractVideoInfo, detectPlatform } from '@/lib/video-extractor'
import { extractAudioFromVideo } from '@/lib/ffmpeg'
import { downloadBlob, formatFileSize, formatDuration, formatViewCount, type VideoInfo, type VideoFormat } from '@/lib/types'

// Detect API base URL based on current path
function getApiBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_API_URL
  if (envUrl) return envUrl
  
  if (typeof window !== 'undefined') {
    const pathname = window.location.pathname
    if (pathname.startsWith('/grabber')) {
      return '/grabber/api'
    }
  }
  return '/api'
}

// Helper function to fetch through proxy (bypasses CORS)
async function fetchThroughProxy(url: string, onProgress?: (progress: number) => void): Promise<Blob> {
  const proxyUrl = `${getApiBaseUrl()}/download?url=${encodeURIComponent(url)}`
  const response = await fetch(proxyUrl)
  
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.statusText}`)
  }

  const contentLength = response.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const chunks: BlobPart[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    if (value) {
      chunks.push(value)
      received += value.length
    }

    if (onProgress && total > 0) {
      onProgress((received / total) * 100)
    }
  }

  return new Blob(chunks)
}

// Helper to stream via server - server uses youtubei.js HTTP client to avoid 403 errors
async function fetchYTDLStream(videoPageUrl: string, itag: string, onProgress?: (progress: number) => void): Promise<Blob> {
  const proxyUrl = `${getApiBaseUrl()}/download?videoUrl=${encodeURIComponent(videoPageUrl)}&itag=${encodeURIComponent(itag)}`
  const response = await fetch(proxyUrl)
  
  if (!response.ok) {
    const errText = await response.text().catch(() => '')
    // Check if response is JSON error
    try {
      const errorJson = JSON.parse(errText)
      throw new Error(errorJson.error || `Failed to download: ${response.status} ${response.statusText}`)
    } catch {
      throw new Error(`Failed to download: ${response.status} ${response.statusText} ${errText ? `- ${errText.substring(0, 200)}` : ''}`)
  }
  }

  // Check if response is actually video data (not JSON error)
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const errorText = await response.text()
    try {
      const errorJson = JSON.parse(errorText)
      throw new Error(errorJson.error || 'Server returned error response')
    } catch {
      throw new Error(`Server returned error: ${errorText.substring(0, 200)}`)
    }
  }

  // Server streams the video through proxy (uses youtubei.js HTTP client to avoid 403)
  const contentLength = response.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const chunks: BlobPart[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.length
    }
    if (onProgress && total > 0) {
      onProgress((received / total) * 100)
    }
  }

  const blob = new Blob(chunks)
  
  // Validate blob size - if it's suspiciously small, it might be an error
  if (blob.size < 1000 && blob.size > 0) {
    // Try to read as text to see if it's an error message
    const text = await blob.text()
    if (text.trim().startsWith('{') || text.trim().startsWith('<')) {
      throw new Error(`Server returned error response: ${text.substring(0, 200)}`)
    }
  }

  return blob
}

// Attempt ytdl streaming first, then fall back to direct signed URL via proxy
async function downloadFormatWithFallback(
  videoPageUrl: string,
  format: VideoFormat,
  onProgress?: (p: number) => void
): Promise<Blob> {
  // Prefer ytdl streaming if we have an itag
  if (format.format_id) {
    try {
      return await fetchYTDLStream(videoPageUrl, format.format_id, onProgress)
    } catch (err) {
      // Continue to fallback
      console.warn('ytdl stream failed, falling back to direct url if present', err)
    }
  }

  if (format.url) {
    return await fetchThroughProxy(format.url, onProgress)
  }

  throw new Error('No available source for selected format')
}

interface QualityOption {
  key: string
  height: number
  fps: number
  formats: VideoFormat[]
}

export function VideoGrabber() {
  const [url, setUrl] = useState('')
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [selectedVideoQuality, setSelectedVideoQuality] = useState<string>('')
  const [selectedVideoFileType, setSelectedVideoFileType] = useState<string>('mp4')
  const [selectedAudioFormat, setSelectedAudioFormat] = useState<string>('mp3')
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState<string>('none')
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<string>('default')
  const [selectedAudioSource, setSelectedAudioSource] = useState<string>('')
  const [selectedVideoOnlyQuality, setSelectedVideoOnlyQuality] = useState<string>('')
  const [selectedVideoOnlyFileType, setSelectedVideoOnlyFileType] = useState<string>('mp4')
  const [formatType, setFormatType] = useState<'video' | 'audio' | 'video-only'>('video')
  const { toast } = useToast()

  // Suppress browser extension errors that clutter the console
  useEffect(() => {
    const originalError = console.error
    const originalWarn = console.warn
    
    const errorHandler = (event: ErrorEvent) => {
      const errorMessage = event.message || ''
      const errorSource = event.filename || ''
      
      // Suppress common browser extension errors
      if (
        errorSource.includes('content_script.js') ||
        errorMessage.includes("Cannot read properties of undefined (reading 'control')") ||
        errorMessage.includes('shouldOfferCompletionListForField') ||
        errorMessage.includes('elementWasFocused') ||
        errorMessage.includes('processInputEvent')
      ) {
        event.preventDefault()
        event.stopPropagation()
        return false
      }
    }

    // Override console.error to filter extension errors
    console.error = (...args: any[]) => {
      const message = args.join(' ')
      if (
        message.includes('content_script.js') ||
        message.includes("Cannot read properties of undefined (reading 'control')") ||
        message.includes('shouldOfferCompletionListForField')
      ) {
        return // Suppress these errors
      }
      originalError.apply(console, args)
    }

    // Override console.warn similarly
    console.warn = (...args: any[]) => {
      const message = args.join(' ')
      if (
        message.includes('content_script.js') ||
        message.includes("Cannot read properties of undefined (reading 'control')")
      ) {
        return // Suppress these warnings
      }
      originalWarn.apply(console, args)
    }

    const rejectionHandler = (event: PromiseRejectionEvent) => {
      const reason = event.reason?.toString() || ''
      if (
        reason.includes('content_script.js') ||
        reason.includes("Cannot read properties of undefined (reading 'control')") ||
        reason.includes('shouldOfferCompletionListForField')
      ) {
        event.preventDefault()
        return false
      }
    }

    window.addEventListener('error', errorHandler, true)
    window.addEventListener('unhandledrejection', rejectionHandler, true)

    return () => {
      console.error = originalError
      console.warn = originalWarn
      window.removeEventListener('error', errorHandler, true)
      window.removeEventListener('unhandledrejection', rejectionHandler, true)
    }
  }, [])

  // Get distinct quality options (resolution + fps combinations)
  // Limited to 720p max due to YouTube Format 18 source limitation
  const qualityOptions = useMemo(() => {
    if (!videoInfo) return []

    const videoFormats = videoInfo.formats.filter(f => 
      f.format_id && 
      f.format_id.trim() !== '' &&
      // Include formats that have video properties (height/width) or has_video flag
      ((f.height && f.width) || f.hasVideo === true || (f.video_codec && f.video_codec !== 'none'))
    )

    // Group by resolution + fps
    const qualityMap = new Map<string, QualityOption>()
    
    videoFormats.forEach(format => {
      const height = typeof format.height === 'number' ? format.height : 0
      const fps = format.fps || 30
      
      // Filter out resolutions above 720p (due to Format 18 limitation)
      // We download 360p source and FFmpeg can upscale to max 720p
      if (height > 720) return
      
      const key = `${height}p@${fps}fps`
      
      if (!qualityMap.has(key)) {
        qualityMap.set(key, {
          key,
          height,
          fps,
          formats: []
        })
      }
      qualityMap.get(key)!.formats.push(format)
    })

    // Sort by height (highest first), then fps
    return Array.from(qualityMap.values()).sort((a, b) => {
      if (a.height !== b.height) return b.height - a.height
      return b.fps - a.fps
    })
  }, [videoInfo])

  // Get distinct audio quality options (grouped by bitrate only, largest size per bitrate)
  const audioQualityOptions = useMemo(() => {
    if (!videoInfo) return []

    // Audio-only formats: hasVideo === false or no video_codec
    // Note: f.url is optional - backend will resolve URLs via /api/download endpoint
    const audioFormats = videoInfo.formats.filter(f => 
      f.format_id && // Must have format_id for backend resolution
      f.audio_codec && 
      (f.hasVideo === false || (!f.video_codec && !f.vcodec && !f.hasVideo))
    )

    // Create a map of format_id to language from audio tracks
    const formatIdToLanguage = new Map<string, string>()
    videoInfo.audio_tracks?.forEach(track => {
      track.format_ids?.forEach(formatId => {
        formatIdToLanguage.set(formatId, track.language)
      })
    })

    // Group by bitrate only, always pick the largest size
    const qualityMap = new Map<number, VideoFormat>()
    
    audioFormats.forEach(format => {
      const bitrate = parseInt(format.format_note?.match(/(\d+)kbps/)?.[1] || '0') || 0
      const filesize = format.filesize || 0
      
      if (!qualityMap.has(bitrate)) {
        qualityMap.set(bitrate, format)
      } else {
        // If this format has a larger size for the same bitrate, use it instead
        const existing = qualityMap.get(bitrate)!
        const existingSize = existing.filesize || 0
        if (filesize > existingSize) {
          qualityMap.set(bitrate, format)
        }
      }
    })

    // Convert to array and sort by bitrate (highest first)
    return Array.from(qualityMap.entries())
      .map(([bitrate, format]) => {
        // Get language from format or from audio tracks mapping
        const language = format.language || formatIdToLanguage.get(format.format_id)
        return {
          key: `${bitrate}kbps-${format.format_id}`,
          formats: [format],
          bitrate,
          filesize: format.filesize || 0,
          language,
        }
      })
      .sort((a, b) => b.bitrate - a.bitrate)
  }, [videoInfo])

  const subtitleTracks = videoInfo?.subtitle_tracks || []
  const audioTracks = videoInfo?.audio_tracks || []

  // Get Format 18 (our universal source format) properties
  const format18 = useMemo(() => {
    if (!videoInfo) return null
    return videoInfo.formats.find(f => f.format_id === '18') || null
  }, [videoInfo])

  // Set defaults when videoInfo changes
  // Default to Format 18's actual specs (height, fps, format) dynamically
  useEffect(() => {
    if (videoInfo && format18 && qualityOptions.length > 0 && !selectedVideoQuality) {
      // Use Format 18's actual height and fps
      const format18Height = format18.height || 360
      const format18Fps = format18.fps || 25
      
      // Find the quality option that matches Format 18's specs
      const format18Quality = qualityOptions.find(q => 
        q.height === format18Height && q.fps === format18Fps
      )
      
      // Fall back to closest match if exact match not found
      const defaultQuality = format18Quality || qualityOptions.find(q => q.height === format18Height) || qualityOptions[qualityOptions.length - 1]
      setSelectedVideoQuality(defaultQuality.key)
    }
    
    if (videoInfo && format18 && qualityOptions.length > 0 && !selectedVideoOnlyQuality) {
      // Use Format 18's actual height and fps
      const format18Height = format18.height || 360
      const format18Fps = format18.fps || 25
      
      // Find the quality option that matches Format 18's specs
      const format18Quality = qualityOptions.find(q => 
        q.height === format18Height && q.fps === format18Fps
      )
      
      // Fall back to closest match if exact match not found
      const defaultQuality = format18Quality || qualityOptions.find(q => q.height === format18Height) || qualityOptions[qualityOptions.length - 1]
      setSelectedVideoOnlyQuality(defaultQuality.key)
    }
    
    if (videoInfo && format18 && !selectedVideoFileType) {
      // Use Format 18's native file format (usually 'mp4')
      const format18Ext = format18.ext || 'mp4'
      setSelectedVideoFileType(format18Ext === 'm4a' ? 'mp4' : format18Ext) // m4a -> mp4 for video
    }
    
    if (videoInfo && format18 && !selectedVideoOnlyFileType) {
      // Use Format 18's native file format (usually 'mp4')
      const format18Ext = format18.ext || 'mp4'
      setSelectedVideoOnlyFileType(format18Ext === 'm4a' ? 'mp4' : format18Ext) // m4a -> mp4 for video
    }
    
    if (videoInfo && format18 && audioQualityOptions.length > 0 && !selectedAudioSource) {
      // Find audio quality that matches Format 18's audio specs
      // Format 18 has AAC audio, typically 128kbps
      const format18AudioBitrate = parseInt(format18.format_note?.match(/(\d+)kbps/)?.[1] || '0') || 
                                   (format18.audio_codec ? 128 : 0) // Default to 128kbps for Format 18
      
      // Find matching audio quality or use highest available
      const matchingAudio = audioQualityOptions.find(q => q.bitrate === format18AudioBitrate)
      const defaultAudio = matchingAudio || audioQualityOptions[0]
      setSelectedAudioSource(defaultAudio.key)
    }
    
    if (videoInfo && format18 && !selectedAudioFormat) {
      // Format 18 is MP4 container with AAC audio, so M4A is the native audio format
      setSelectedAudioFormat('m4a')
    }
  }, [videoInfo, format18, qualityOptions, audioQualityOptions, selectedVideoQuality, selectedVideoOnlyQuality, selectedAudioSource, selectedVideoFileType, selectedVideoOnlyFileType, selectedAudioFormat])

  const handleExtract = async () => {
    if (!url.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a valid URL',
        variant: 'destructive',
      })
      return
    }

    const platform = detectPlatform(url)
    if (!platform || platform !== 'youtube') {
      toast({
        title: 'Unsupported Platform',
        description: 'Please enter a valid YouTube URL (youtube.com or youtu.be)',
        variant: 'destructive',
      })
      return
    }

    setLoading(true)
    setVideoInfo(null)
    setSelectedVideoQuality('')
    setSelectedVideoOnlyQuality('')
    setSelectedAudioSource('')
    setSelectedSubtitleTrack('none')
    setSelectedAudioTrack('default')

    try {
      const info = await extractVideoInfo(url)
      if (!info) {
        throw new Error('Failed to extract video information')
      }

      setVideoInfo(info)
      
      // No success toast - extraction happens automatically
    } catch (error) {
      console.error('Error extracting video info:', error)
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to extract video information',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    if (formatType === 'video') {
      if (!videoInfo || !selectedVideoQuality) {
        toast({
          title: 'Error',
          description: 'Please select a video quality',
          variant: 'destructive',
        })
        return
      }

      setDownloading(true)
      setDownloadProgress(0)

      try {
        const qualityOption = qualityOptions.find(q => q.key === selectedVideoQuality)
        if (!qualityOption || qualityOption.formats.length === 0) {
          throw new Error('Selected quality not available')
        }

        // OPTIMIZATION: If user wants exactly Format 18 specs (height, fps, format), skip FFmpeg entirely
        // This is our source format, so no processing needed - just download directly
        const format18Height = format18?.height || 360
        const format18Fps = format18?.fps || 25
        const format18Ext = format18?.ext || 'mp4'
        const videoFileExt = format18Ext === 'm4a' ? 'mp4' : format18Ext
        
        const isFormat18Request = format18 && 
                                   qualityOption.height === format18Height && 
                                   qualityOption.fps === format18Fps && 
                                   selectedVideoFileType === videoFileExt
        
        if (isFormat18Request) {
          console.log('🚀 Optimization: Downloading Format 18 directly (no FFmpeg processing)')
          
          // Format 18 already found via useMemo - use it directly
          if (format18) {
            // Download Format 18 directly without any processing
            setDownloadProgress(10)
            const videoBlob = await downloadFormatWithFallback(
              videoInfo.webpage_url,
              format18,
              (progress) => setDownloadProgress(10 + progress * 0.85)
            )
            
            setDownloadProgress(95)
            
            // Create filename from video title
            const videoTitle = videoInfo.title || 'video'
            const filename = `${videoTitle}.${videoFileExt}`
            console.log('Downloading Format 18 directly:', { filename, blobSize: videoBlob.size })
            
            downloadBlob(videoBlob, filename)
            
            toast({
              title: 'Success',
              description: 'Video downloaded successfully (Format 18 - no processing)',
            })
            
            setDownloading(false)
            setDownloadProgress(0)
            return
          }
        }

        // Get best format from this quality option
        // CRITICAL: Prefer formats that match output format to avoid slow transcoding
        // If output is MP4, prefer MP4 formats (H.264) over WebM (VP9)
        // VP9->H.264 transcoding is extremely slow in browser WebAssembly
        let videoFormat = qualityOption.formats[0]
        
        // If output format is MP4, prefer MP4 formats (faster, no transcoding needed)
        if (selectedVideoFileType === 'mp4' || selectedVideoFileType === 'mov') {
          const mp4Format = qualityOption.formats.find(f => 
            (f.ext === 'mp4' || !f.ext || f.ext === 'mov') && 
            (!f.video_codec?.includes('vp9') && !f.video_codec?.includes('VP9'))
          )
          if (mp4Format) {
            videoFormat = mp4Format
            console.log('Selected MP4 format to avoid transcoding:', mp4Format.format_id)
          } else {
            console.warn('No MP4 format found for this quality, transcoding may be slow:', {
              availableFormats: qualityOption.formats.map(f => ({
                id: f.format_id,
                ext: f.ext,
                codec: f.video_codec
              }))
            })
          }
        } else if (selectedVideoFileType === 'webm') {
          // If output is WebM, prefer WebM formats
          const webmFormat = qualityOption.formats.find(f => f.ext === 'webm')
          if (webmFormat) {
            videoFormat = webmFormat
            console.log('Selected WebM format to avoid transcoding:', webmFormat.format_id)
          }
        }
        
        if (!videoFormat.format_id) {
          throw new Error('Video format not available')
        }

        toast({
          title: 'Processing',
          description: 'Downloading and processing video...',
        })

        // Get audio formats based on selected audio track
        // Audio-only formats either have hasVideo === false or no video_codec
        // Note: f.url is optional - backend will resolve URLs via /api/download endpoint
        let audioOnlyFormats = videoInfo.formats.filter(f => 
          f.format_id && // Must have format_id for backend resolution
          f.audio_codec && 
          (f.hasVideo === false || (!f.video_codec && !f.vcodec && !f.hasVideo))
        )

        // Filter by selected audio track if specified
        if (selectedAudioTrack && selectedAudioTrack !== 'default' && audioTracks.length > 0) {
          const audioTrack = audioTracks[parseInt(selectedAudioTrack)]
          if (audioTrack?.format_ids && audioTrack.format_ids.length > 0) {
            audioOnlyFormats = audioOnlyFormats.filter(f => 
              audioTrack.format_ids!.includes(f.format_id)
            )
          }
        }

        // Download video and audio in parallel for better performance
        setDownloadProgress(10)
        
        let videoData: Uint8Array
        let audioData: Uint8Array
        let audioExt = 'm4a'

        if (audioOnlyFormats.length > 0) {
          // Use best audio quality from separate stream
            const bestAudio = audioOnlyFormats.sort((a, b) => {
            const bitrateA = parseInt(a.format_note?.match(/(\d+)kbps/)?.[1] || '0') || 0
            const bitrateB = parseInt(b.format_note?.match(/(\d+)kbps/)?.[1] || '0') || 0
            return bitrateB - bitrateA
          })[0]

          // Download video and audio in parallel
          const [videoBlob, audioBlob] = await Promise.all([
            downloadFormatWithFallback(
              videoInfo.webpage_url,
              videoFormat,
              (progress) => setDownloadProgress(10 + progress * 0.3)
            ),
            downloadFormatWithFallback(
            videoInfo.webpage_url,
            bestAudio,
              (progress) => setDownloadProgress(10 + progress * 0.3)
          )
          ])
          
          const [videoDataArray, audioDataArray] = await Promise.all([
            videoBlob.arrayBuffer(),
            audioBlob.arrayBuffer()
          ])
          
          videoData = new Uint8Array(videoDataArray)
          audioData = new Uint8Array(audioDataArray)
          audioExt = bestAudio.ext || 'm4a'
          setDownloadProgress(70)
        } else {
          // No separate audio stream available - use video format with audio or extract from lower quality
          // Find a video format that has audio (prefer lower quality for faster processing)
          // Note: f.url is optional - backend will resolve URLs via /api/download endpoint
          const videoWithAudio = videoInfo.formats
            .filter(f => 
              f.format_id && // Must have format_id for backend resolution
              f.hasAudio === true && 
              (f.video_codec || f.height || f.hasVideo === true) &&
              f.audio_codec // Must have audio codec
            )
            .sort((a, b) => {
              // Prefer lower quality for faster processing
              const heightA = a.height || 0
              const heightB = b.height || 0
              return heightA - heightB
            })[0]

          console.log('Looking for video with audio:', {
            totalFormats: videoInfo.formats.length,
            formatsWithAudio: videoInfo.formats.filter(f => f.hasAudio === true).length,
            found: !!videoWithAudio,
            videoWithAudioFormatId: videoWithAudio?.format_id,
            videoWithAudioHasAudio: videoWithAudio?.hasAudio,
            videoWithAudioAudioCodec: videoWithAudio?.audio_codec
          })

          if (videoWithAudio) {
            // Download the video format with audio
            const videoWithAudioBlob = await downloadFormatWithFallback(
              videoInfo.webpage_url,
              videoWithAudio,
              (progress) => setDownloadProgress(10 + progress * 0.6)
            )
            
            setDownloadProgress(70)
            
            // Ensure blob is fully loaded before processing
            if (videoWithAudioBlob.size === 0) {
              throw new Error('Downloaded video blob is empty')
            }
            
            const videoWithAudioData = new Uint8Array(await videoWithAudioBlob.arrayBuffer())
            
            // Validate data before processing
            if (!videoWithAudioData || videoWithAudioData.length === 0) {
              throw new Error('Downloaded video data is empty or invalid')
            }
            
            console.log('Video data ready for audio extraction:', {
              size: videoWithAudioData.length,
              format: videoWithAudio.ext || 'mp4'
            })
            
            // Extract audio from this format
            const { extractAudioFromVideo } = await import('@/lib/ffmpeg')
            audioData = await extractAudioFromVideo(
              videoWithAudioData,
              videoWithAudio.ext || 'mp4',
              'm4a',
              '192k',
              (progress: number) => setDownloadProgress(70 + progress * 0.05)
            )
            audioExt = 'm4a'
            
            // Download the selected video format (without audio)
            const videoBlob = await downloadFormatWithFallback(
              videoInfo.webpage_url,
              videoFormat,
              (progress) => setDownloadProgress(75 + progress * 0.05)
            )
            
            if (videoBlob.size === 0) {
              throw new Error('Downloaded video-only blob is empty')
            }
            
            videoData = new Uint8Array(await videoBlob.arrayBuffer())
            setDownloadProgress(80)
          } else {
            // Final fallback: Try to find ANY format with audio (including the selected format)
            // Check if selected format has audio
            let formatWithAudio = null
            
            if (videoFormat.hasAudio || videoFormat.audio_codec) {
              formatWithAudio = videoFormat
            } else {
              // Find any format with audio
              formatWithAudio = videoInfo.formats.find(f => 
                f.format_id &&
                (f.hasAudio === true || f.audio_codec) &&
                (f.video_codec || f.height || f.hasVideo !== false)
              )
            }
            
            if (formatWithAudio) {
              console.log('Using format with audio for extraction:', {
                formatId: formatWithAudio.format_id,
                hasAudio: formatWithAudio.hasAudio,
                audioCodec: formatWithAudio.audio_codec
              })
              
              // Download the format with audio
              const videoBlob = await downloadFormatWithFallback(
                videoInfo.webpage_url,
                formatWithAudio,
                (progress) => setDownloadProgress(10 + progress * 0.4)
              )
              
              setDownloadProgress(50)
              
              // Ensure blob is fully loaded before processing
              if (videoBlob.size === 0) {
                throw new Error('Downloaded video blob is empty')
              }
              
              videoData = new Uint8Array(await videoBlob.arrayBuffer())
              
              // Validate data before processing
              if (!videoData || videoData.length === 0) {
                throw new Error('Downloaded video data is empty or invalid')
              }
              
              console.log('Video data ready for audio extraction:', {
                size: videoData.length,
                format: formatWithAudio.ext || 'mp4'
              })
              
              // Extract audio from video
              setDownloadProgress(60)
          const { extractAudioFromVideo } = await import('@/lib/ffmpeg')
          audioData = await extractAudioFromVideo(
            videoData,
                formatWithAudio.ext || 'mp4',
            'm4a',
                '192k',
                (progress: number) => setDownloadProgress(60 + progress * 0.1)
          )
          audioExt = 'm4a'
              setDownloadProgress(70)
              
              // If we downloaded a different format, download the selected video format
              if (formatWithAudio.format_id !== videoFormat.format_id) {
                const videoOnlyBlob = await downloadFormatWithFallback(
                  videoInfo.webpage_url,
                  videoFormat,
                  (progress) => setDownloadProgress(75 + progress * 0.05)
                )
                
                if (videoOnlyBlob.size === 0) {
                  throw new Error('Downloaded video-only blob is empty')
                }
                
                videoData = new Uint8Array(await videoOnlyBlob.arrayBuffer())
                setDownloadProgress(80)
              }
        } else {
              throw new Error('No audio stream available - could not find any format with audio')
            }
          }
        }

        // Merge video and audio
        setDownloadProgress(80)
        const { mergeVideoAndAudio, burnSubtitlesIntoVideo } = await import('@/lib/ffmpeg')
        
        let finalData: Uint8Array

        // First merge video and audio, with optional upscaling to selected resolution
        // We download 360p (Format 18) and upscale to user's selection (up to 720p)
        const targetHeight = qualityOption.height > 0 ? qualityOption.height : undefined
        
        finalData = await mergeVideoAndAudio(
          videoData,
          videoFormat.ext || 'mp4',
          audioData,
          audioExt,
          selectedVideoFileType,
          (progress: number) => setDownloadProgress(80 + progress * 0.1),
          targetHeight // Upscale from 360p source to selected resolution
        )

        // Burn subtitles if selected
        if (selectedSubtitleTrack && selectedSubtitleTrack !== 'none') {
          setDownloadProgress(90)
          const subtitleTrack = subtitleTracks[parseInt(selectedSubtitleTrack)]
          if (subtitleTrack?.base_url) {
            // Download subtitle file through proxy
            const subtitleUrl = `${subtitleTrack.base_url}&fmt=vtt`
            try {
              const subtitleBlob = await fetchThroughProxy(subtitleUrl)
              const subtitleText = await subtitleBlob.text()
              finalData = await burnSubtitlesIntoVideo(
                finalData,
                selectedVideoFileType,
                subtitleText,
                selectedVideoFileType,
                (progress: number) => setDownloadProgress(90 + progress * 0.1)
              )
            } catch (error) {
              console.warn('Failed to download subtitles, continuing without them:', error)
            }
          }
        }

        setDownloadProgress(95)
        // Ensure we use a regular ArrayBuffer (not SharedArrayBuffer)
        const buffer = finalData.buffer instanceof ArrayBuffer 
          ? finalData.buffer 
          : new ArrayBuffer(finalData.byteLength)
        if (!(finalData.buffer instanceof ArrayBuffer)) {
          const view = new Uint8Array(buffer)
          view.set(finalData)
        }
        const finalBlob = new Blob([buffer], { type: `video/${selectedVideoFileType}` })
        
        // Create filename from video title with proper extension
        const videoTitle = videoInfo.title || 'video'
        const filename = `${videoTitle}.${selectedVideoFileType}`
        console.log('Downloading file:', { filename, title: videoInfo.title, fileType: selectedVideoFileType, blobSize: finalBlob.size })
        
        downloadBlob(finalBlob, filename)

        toast({
          title: 'Success',
          description: 'Video downloaded successfully',
        })
      } catch (error) {
        console.error('Error downloading video:', error)
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to download video',
          variant: 'destructive',
        })
      } finally {
        setDownloading(false)
        setDownloadProgress(0)
      }
    } else if (formatType === 'video-only') {
      // Video-only tab - download video without audio
      if (!videoInfo || !selectedVideoOnlyQuality) {
        toast({
          title: 'Error',
          description: 'Please select a video quality',
          variant: 'destructive',
        })
        return
      }

      setDownloading(true)
      setDownloadProgress(0)

      try {
        const qualityOption = qualityOptions.find(q => q.key === selectedVideoOnlyQuality)
        if (!qualityOption || qualityOption.formats.length === 0) {
          throw new Error('Selected quality not available')
        }

        // OPTIMIZATION: If user wants Format 18 specs (height, fps, format) for video-only
        // Download Format 18 and strip audio with copy codec (very fast)
        const format18Height = format18?.height || 360
        const format18Fps = format18?.fps || 25
        const format18Ext = format18?.ext || 'mp4'
        const videoFileExt = format18Ext === 'm4a' ? 'mp4' : format18Ext
        
        const isFormat18VideoOnly = format18 && 
                                     qualityOption.height === format18Height && 
                                     qualityOption.fps === format18Fps && 
                                     selectedVideoOnlyFileType === videoFileExt
        
        if (isFormat18VideoOnly) {
          console.log('🚀 Optimization: Using Format 18 with fast audio strip (copy codec)')
          
          // Format 18 already found via useMemo
          if (format18) {
            // Download Format 18
            setDownloadProgress(10)
            const videoBlob = await downloadFormatWithFallback(
              videoInfo.webpage_url,
              format18,
              (progress) => setDownloadProgress(10 + progress * 0.5)
            )
            
            setDownloadProgress(60)
            const videoData = new Uint8Array(await videoBlob.arrayBuffer())
            
            // Strip audio using copy codec (no re-encoding, very fast)
            const { extractVideoOnly } = await import('@/lib/ffmpeg')
            const videoOnlyData = await extractVideoOnly(
              videoData,
              videoFileExt,
              (progress: number) => setDownloadProgress(60 + progress * 0.35)
            )
            
            setDownloadProgress(95)
            // Ensure we use a regular ArrayBuffer (not SharedArrayBuffer)
            const buffer = videoOnlyData.buffer instanceof ArrayBuffer 
              ? videoOnlyData.buffer 
              : new ArrayBuffer(videoOnlyData.byteLength)
            if (!(videoOnlyData.buffer instanceof ArrayBuffer)) {
              const view = new Uint8Array(buffer)
              view.set(videoOnlyData)
            }
            const finalBlob = new Blob([buffer], { type: `video/${videoFileExt}` })
            
            // Create filename from video title
            const videoTitle = videoInfo.title || 'video'
            const filename = `${videoTitle}.${videoFileExt}`
            console.log('Downloading Format 18 video-only (fast):', { filename, blobSize: finalBlob.size })
            
            downloadBlob(finalBlob, filename)
            
            toast({
              title: 'Success',
              description: 'Video downloaded successfully (Format 18 - fast processing)',
            })
            
            setDownloading(false)
            setDownloadProgress(0)
            return
          }
        }

        // Get best format from this quality option (prefer video-only if available)
        const videoFormat = qualityOption.formats.find(f => f.hasAudio === false || (!f.hasAudio && !f.audio_codec)) || qualityOption.formats[0]
        if (!videoFormat.format_id) {
          throw new Error('Video format not available')
        }

        toast({
          title: 'Processing',
          description: 'Downloading video...',
        })

        // Download video stream via ytdl streaming
        setDownloadProgress(10)
        let videoBlob = await downloadFormatWithFallback(
          videoInfo.webpage_url,
          videoFormat,
          (progress) => setDownloadProgress(10 + progress * 0.4)
        )

        setDownloadProgress(50)
        let videoData = new Uint8Array(await videoBlob.arrayBuffer() as ArrayBuffer)

        // Check if upscaling or format conversion is needed
        const targetHeight = qualityOption.height
        const needsUpscale = targetHeight && targetHeight > 360 // We download 360p source
        const needsFormatConversion = selectedVideoOnlyFileType !== (videoFormat.ext || 'mp4')
        
        if (needsUpscale || needsFormatConversion) {
          setDownloadProgress(60)
          const { convertVideoToResolution } = await import('@/lib/ffmpeg')
          
          // Upscale and/or convert format in one pass
          const processedData = await convertVideoToResolution(
            videoData,
            videoFormat.ext || 'mp4',
            targetHeight || 360, // Upscale to selected resolution (or keep 360p)
            selectedVideoOnlyFileType,
            (progress: number) => setDownloadProgress(60 + progress * 0.3)
          )
          videoData = new Uint8Array(processedData)
        }

        setDownloadProgress(95)
        // Ensure we use a regular ArrayBuffer (not SharedArrayBuffer)
        const buffer = videoData.buffer instanceof ArrayBuffer 
          ? videoData.buffer 
          : new ArrayBuffer(videoData.byteLength)
        if (!(videoData.buffer instanceof ArrayBuffer)) {
          const view = new Uint8Array(buffer)
          view.set(videoData)
        }
        const finalBlob = new Blob([buffer], { type: `video/${selectedVideoOnlyFileType}` })
        
        // Create filename from video title with proper extension
        const videoTitle = videoInfo.title || 'video'
        const filename = `${videoTitle}.${selectedVideoOnlyFileType}`
        console.log('Downloading video-only file:', { filename, title: videoInfo.title, fileType: selectedVideoOnlyFileType, blobSize: finalBlob.size })
        
        downloadBlob(finalBlob, filename)

        toast({
          title: 'Success',
          description: 'Video downloaded successfully',
        })
      } catch (error) {
        console.error('Error downloading video:', error)
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to download video',
          variant: 'destructive',
        })
      } finally {
        setDownloading(false)
        setDownloadProgress(0)
      }
    } else {
      // Audio tab
      if (!videoInfo || !selectedAudioSource) {
        toast({
          title: 'Error',
          description: 'Please select an audio source',
          variant: 'destructive',
        })
        return
      }

      setDownloading(true)
      setDownloadProgress(0)

      try {
        // Find the selected audio quality option
        const qualityOption = audioQualityOptions.find(q => q.key === selectedAudioSource)
        if (!qualityOption || qualityOption.formats.length === 0) {
          throw new Error('Selected audio quality not available')
        }

        // Get best format from this quality option
        const format = qualityOption.formats[0]
            if (!format || !format.format_id) {
              throw new Error('Audio format not available')
            }

        toast({
          title: 'Processing',
          description: 'Extracting audio...',
        })

            // Download audio stream via ytdl streaming
        setDownloadProgress(10)
            const audioBlob = await downloadFormatWithFallback(
              videoInfo.webpage_url,
              format,
              (progress) => setDownloadProgress(10 + progress * 0.5)
            )

        setDownloadProgress(60)
        const audioData = new Uint8Array(await audioBlob.arrayBuffer())

        // Convert audio format (skip conversion if already in desired format)
        if (format.ext === selectedAudioFormat || (!format.ext && selectedAudioFormat === 'm4a')) {
          // Already in desired format, just download
          setDownloadProgress(95)
          const finalBlob = new Blob([audioData], { type: `audio/${selectedAudioFormat}` })
          
          // Create filename from video title with proper extension
          const videoTitle = videoInfo.title || 'audio'
          const filename = `${videoTitle}.${selectedAudioFormat}`
          console.log('Downloading audio file:', { filename, title: videoInfo.title, fileType: selectedAudioFormat, blobSize: finalBlob.size })
          
          downloadBlob(finalBlob, filename)
          
          toast({
            title: 'Success',
            description: 'Audio downloaded successfully',
          })
        } else {
        // Convert audio format
          setDownloadProgress(60)
        const finalAudioData = await extractAudioFromVideo(
          audioData,
          format.ext || 'm4a',
          selectedAudioFormat,
          '192k',
            (progress: number) => setDownloadProgress(60 + progress * 0.35)
        )

        setDownloadProgress(95)
        // Ensure we use a regular ArrayBuffer (not SharedArrayBuffer)
        const buffer = finalAudioData.buffer instanceof ArrayBuffer 
          ? finalAudioData.buffer 
          : new ArrayBuffer(finalAudioData.byteLength)
        if (!(finalAudioData.buffer instanceof ArrayBuffer)) {
          const view = new Uint8Array(buffer)
          view.set(finalAudioData)
        }
        const finalBlob = new Blob([buffer], { type: `audio/${selectedAudioFormat}` })
          
          // Create filename from video title with proper extension
          const videoTitle = videoInfo.title || 'audio'
          const filename = `${videoTitle}.${selectedAudioFormat}`
          console.log('Downloading converted audio file:', { filename, title: videoInfo.title, fileType: selectedAudioFormat, blobSize: finalBlob.size })
          
        downloadBlob(finalBlob, filename)

        toast({
          title: 'Success',
          description: 'Audio extracted and downloaded successfully',
        })
        }
      } catch (error) {
        console.error('Error downloading audio:', error)
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to download audio',
          variant: 'destructive',
        })
      } finally {
        setDownloading(false)
        setDownloadProgress(0)
      }
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Enter Video URL</CardTitle>
          <CardDescription>
            Paste a link from YouTube
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1" data-form-type="other" data-lpignore="true" data-1p-ignore="true" data-bwignore="true">
              <Input
                type="url"
                placeholder="https://..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleExtract()
                  }
                }}
                className="w-full"
                autoComplete="new-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                name="video-url-input"
                id="video-url-input"
                role="textbox"
                aria-label="Video URL input"
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                data-dashlane-ignore="true"
                data-kwignore="true"
                data-nordpass-ignore="true"
                data-apple-keychain="ignore"
                data-credential-hint="false"
                tabIndex={0}
              />
            </div>
            <Button
              onClick={handleExtract}
              disabled={loading || !url.trim()}
              className="w-full sm:w-auto"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Extracting...
                </>
              ) : (
                <>
                  <Link2 className="mr-2 h-4 w-4" />
                  Extract
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {videoInfo && (
        <Card>
          <CardHeader>
            <div className="flex items-start gap-4 flex-col sm:flex-row">
              {videoInfo.thumbnail && (
                <img
                  src={videoInfo.thumbnail}
                  alt={videoInfo.title}
                  className="w-full sm:w-32 h-auto sm:h-20 object-cover rounded-md"
                />
              )}
              <div className="flex-1 w-full">
                <CardTitle className="line-clamp-2 leading-normal pb-1 min-h-[3rem]">{videoInfo.title}</CardTitle>
                <CardDescription>
                  <span className="block">
                    {videoInfo.duration > 0 && formatDuration(videoInfo.duration)}
                    {videoInfo.uploader && ` • ${videoInfo.uploader}`}
                    {videoInfo.view_count && ` • ${formatViewCount(videoInfo.view_count)}`}
                  </span>
                  {videoInfo.description && (
                    <span className="block text-xs text-muted-foreground line-clamp-2 mt-1">
                      {videoInfo.description.length > 150 
                        ? `${videoInfo.description.substring(0, 150)}...` 
                        : videoInfo.description}
                    </span>
                  )}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* YouTube Format 18 Limitation Notice */}
            <Alert className="mb-4 border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <AlertDescription className="text-sm text-blue-800 dark:text-blue-300">
                <strong>Quality Note:</strong> Due to YouTube's recent restrictions, we download Format 18 source and upscale to your selected resolution using FFmpeg. Max quality: 720p. Audio quality unaffected. Upscaling processes at 1x speed (real-time), so a 3 min 15s video takes ~3 min 15s to upscale to 720p.
              </AlertDescription>
            </Alert>
            
            <Tabs value={formatType} onValueChange={(v) => setFormatType(v as 'video' | 'audio' | 'video-only')}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="video">
                  <Video className="mr-1 h-4 w-4" />
                  <Music className="mr-2 h-4 w-4" />
                  Combined
                </TabsTrigger>
                <TabsTrigger value="video-only">
                  <Video className="mr-2 h-4 w-4" />
                  Video Only
                </TabsTrigger>
                <TabsTrigger value="audio">
                  <Music className="mr-2 h-4 w-4" />
                  Audio Only
                </TabsTrigger>
              </TabsList>

              <TabsContent value="video" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Video Quality</Label>
                  <Select
                    value={selectedVideoQuality}
                    onValueChange={setSelectedVideoQuality}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select quality" />
                    </SelectTrigger>
                    <SelectContent>
                      {qualityOptions.length === 0 ? (
                        <SelectItem value="no-formats" disabled>
                          No formats available
                        </SelectItem>
                      ) : (
                        qualityOptions.map((option) => (
                          <SelectItem key={option.key} value={option.key}>
                            {option.height}p @ {option.fps}fps
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>File Type</Label>
                  <Select
                    value={selectedVideoFileType}
                    onValueChange={setSelectedVideoFileType}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mp4">MP4</SelectItem>
                      <SelectItem value="mov">MOV</SelectItem>
                      <SelectItem value="webm">WebM</SelectItem>
                      <SelectItem value="avi">AVI</SelectItem>
                      <SelectItem value="mkv">MKV</SelectItem>
                      <SelectItem value="flv">FLV</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Audio Track</Label>
                  <Select
                    value={selectedAudioTrack}
                    onValueChange={setSelectedAudioTrack}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Default track" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default Track (Recommended)</SelectItem>
                      {audioTracks.map((track, index) => (
                        <SelectItem key={track.format_id || `track-${index}`} value={index.toString()}>
                          {track.language} ({track.language_code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {subtitleTracks.length > 0 && (
                  <div className="space-y-2">
                    <Label>Subtitle Track (Optional)</Label>
                    <Select
                      value={selectedSubtitleTrack}
                      onValueChange={setSelectedSubtitleTrack}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="No subtitles" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Subtitles</SelectItem>
                        {subtitleTracks.map((track, index) => (
                          <SelectItem key={track.format_id || `track-${index}`} value={index.toString()}>
                            {track.language} ({track.language_code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="video-only" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Video Quality</Label>
                  <Select
                    value={selectedVideoOnlyQuality}
                    onValueChange={setSelectedVideoOnlyQuality}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select quality" />
                    </SelectTrigger>
                    <SelectContent>
                      {qualityOptions.length === 0 ? (
                        <SelectItem value="no-formats" disabled>
                          No formats available
                        </SelectItem>
                      ) : (
                        qualityOptions.map((option) => (
                          <SelectItem key={option.key} value={option.key}>
                            {option.height}p @ {option.fps}fps
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>File Type</Label>
                  <Select
                    value={selectedVideoOnlyFileType}
                    onValueChange={setSelectedVideoOnlyFileType}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mp4">MP4</SelectItem>
                      <SelectItem value="mov">MOV</SelectItem>
                      <SelectItem value="webm">WebM</SelectItem>
                      <SelectItem value="avi">AVI</SelectItem>
                      <SelectItem value="mkv">MKV</SelectItem>
                      <SelectItem value="flv">FLV</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              <TabsContent value="audio" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Audio Quality</Label>
                  <Select
                    value={selectedAudioSource}
                    onValueChange={setSelectedAudioSource}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select quality" />
                    </SelectTrigger>
                    <SelectContent>
                      {audioQualityOptions.length === 0 ? (
                        <SelectItem value="no-formats" disabled>
                          No audio formats available
                        </SelectItem>
                      ) : (
                        audioQualityOptions.map((option) => (
                          <SelectItem key={option.key} value={option.key}>
                            {option.bitrate > 0 ? `${option.bitrate}kbps` : 'Audio'}
                            {option.filesize > 0 && ` • ${formatFileSize(option.filesize)}`}
                            {option.language && option.language !== 'default' && ` • ${option.language}`}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Audio Format</Label>
                  <Select
                    value={selectedAudioFormat}
                    onValueChange={setSelectedAudioFormat}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mp3">MP3</SelectItem>
                      <SelectItem value="m4a">M4A (AAC)</SelectItem>
                      <SelectItem value="ogg">OGG</SelectItem>
                      <SelectItem value="wav">WAV</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>
            </Tabs>

            {downloading && (
              <div className="mt-4 space-y-2">
                <Progress value={downloadProgress} />
                <p className="text-sm text-muted-foreground text-center">
                  {downloadProgress.toFixed(0)}% complete
                </p>
              </div>
            )}

            <Button
              onClick={handleDownload}
              disabled={
                downloading || 
                (formatType === 'video' ? !selectedVideoQuality : 
                 formatType === 'video-only' ? !selectedVideoOnlyQuality :
                 !selectedAudioSource) ||
                (formatType === 'video' ? selectedVideoQuality === 'no-formats' : 
                 formatType === 'video-only' ? selectedVideoOnlyQuality === 'no-formats' :
                 selectedAudioSource === 'no-formats')
              }
              className="w-full mt-4"
              size="lg"
            >
              {downloading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Download {formatType === 'video' ? 'Combined' : formatType === 'video-only' ? 'Video Only' : 'Audio Only'}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
