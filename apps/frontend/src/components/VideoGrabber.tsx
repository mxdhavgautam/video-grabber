import { useState, useMemo, useEffect } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { useToast } from '@/components/ui/use-toast'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Download, Video, Music, Link2, Clipboard, Cookie } from 'lucide-react'
import { extractVideoInfo, detectPlatform, getApiBaseUrl } from '@/lib/video-extractor'
import { extractAudioFromVideo } from '@/lib/ffmpeg'
import { downloadBlob, formatFileSize, formatDuration, formatViewCount, sanitizeFilename, normalizeYouTubeUrl, type VideoInfo, type VideoFormat } from '@/lib/types'
import { CookieUploadModal } from '@/components/CookieUploadModal'

// Helper function to fetch through proxy (bypasses CORS)
async function downloadFormatWithoutProgress(url: string): Promise<Blob> {
  const proxyUrl = `${getApiBaseUrl()}/download?url=${encodeURIComponent(url)}`
  const response = await fetch(proxyUrl)
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(errorData.error || `Failed to download: ${response.statusText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const chunks: BlobPart[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    if (value) {
      chunks.push(value)
    }
  }

  return new Blob(chunks)
}

// Helper to download specific format via yt-dlp backend
async function downloadFormat(videoPageUrl: string, formatId: string, onProgress?: (progress: number) => void): Promise<Blob> {
  const proxyUrl = `${getApiBaseUrl()}/download?url=${encodeURIComponent(videoPageUrl)}&format=${encodeURIComponent(formatId)}`
  
  // Start tracking from 0 - waiting for server to process
  onProgress?.(0)
  
  console.log(`📥 Starting download for format ${formatId} from ${proxyUrl}`)
  
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
  console.log(`📥 Response content-type: ${contentType}`)
  
  if (contentType.includes('application/json')) {
    const errorText = await response.text()
    try {
      const errorJson = JSON.parse(errorText)
      throw new Error(errorJson.error || 'Server returned error response')
    } catch {
      throw new Error(`Server returned error: ${errorText.substring(0, 200)}`)
    }
  }

  // Server processing + downloading (0-60%)
  onProgress?.(60)

  // Download video data with progress tracking
  const contentLength = response.headers.get('content-length')
  const total = contentLength ? parseInt(contentLength, 10) : 0
  
  console.log(`📥 Content-Length: ${total} bytes`)

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

  const chunks: BlobPart[] = []
  let received = 0
  const startTime = Date.now()
  const TIMEOUT_MS = 120000 // 2 minute timeout for download

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.length
      
      // Check for timeout
      if (Date.now() - startTime > TIMEOUT_MS) {
        reader.cancel('Download timeout')
        throw new Error(`Download timeout after 2 minutes (received ${(received / 1024 / 1024).toFixed(2)}MB)`)
      }
    }
    // Stage 4: Downloading (60-100%)
    if (onProgress) {
      if (total > 0) {
        onProgress(60 + (received / total) * 40)
      } else {
        // If no content-length, just increment slowly
        onProgress(Math.min(95, 60 + (received / (1024 * 1024)) * 5))
      }
    }
    
    // Log progress every 10MB
    if (received % (10 * 1024 * 1024) < (value?.length || 0)) {
      console.log(`📊 Downloaded ${(received / 1024 / 1024).toFixed(1)}MB...`)
    }
  }

  const blob = new Blob(chunks)
  
  console.log(`✅ Download complete: ${blob.size} bytes (${(blob.size / 1024 / 1024).toFixed(2)}MB)`)
  
  // Validate blob size - if it's suspiciously small, it might be an error
  if (blob.size < 5000) {
    // Very small file - likely an error
    const text = await blob.text()
    if (text.trim().startsWith('{') || text.trim().startsWith('<')) {
      throw new Error(`Server returned error response: ${text.substring(0, 200)}`)
    }
    // If very small, it's probably incomplete
    throw new Error(`Downloaded file is too small (${blob.size} bytes) - may be incomplete. Try again.`)
  }

  // Finished downloading
  onProgress?.(100)

  return blob
}

// Attempt download using format ID via yt-dlp backend
async function downloadFormatWithFallback(
  videoPageUrl: string,
  format: VideoFormat,
  onProgress?: (p: number) => void
): Promise<Blob> {
  // Use yt-dlp format ID for download
  if (format.format_id) {
    try {
      return await downloadFormat(videoPageUrl, format.format_id, onProgress)
    } catch (err) {
      // Continue to fallback or rethrow
      console.warn('Format download failed:', err)
      throw err
    }
  }

  throw new Error('No format ID available for download')
}

interface QualityOption {
  key: string
  height: number
  fps: number
  formats: VideoFormat[]
}

export function VideoGrabber({ onExtracting }: { onExtracting?: (isExtracting: boolean) => void }) {
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [prevUrl, setPrevUrl] = useState<string>('')
  const [extractionStatus, setExtractionStatus] = useState<string | null>(null)
  const [cookieModalOpen, setCookieModalOpen] = useState(false)
  const { toast } = useToast()

  // Auto-focus URL input on page load
  useEffect(() => {
    const urlInput = document.getElementById('video-url') as HTMLInputElement
    if (urlInput) {
      // Small delay to ensure component is fully rendered
      setTimeout(() => {
        urlInput.focus()
      }, 100)
    }
  }, [])

  // Notify parent when extracting state changes
  useEffect(() => {
    onExtracting?.(videoInfo !== null || loading)
  }, [loading, onExtracting, videoInfo])

  // Handle URL changes - fade out old results
  useEffect(() => {
    if (url !== prevUrl && videoInfo) {
      // URL changed, update prevUrl to track it
      setPrevUrl(url)
    }
  }, [url, prevUrl, videoInfo])

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
  // Now with yt-dlp backend: ALL YouTube formats are available natively
  // No more Format 18 limitation - we get native 2160p, 1440p, 1080p, 720p, etc.
  const qualityOptions = useMemo(() => {
    if (!videoInfo) return []

    // Debug: Log all formats to understand what we're receiving
    console.log('[Frontend] Processing formats:', {
      totalFormats: videoInfo.formats?.length || 0,
      sampleFormat: videoInfo.formats?.[0],
      formatIds: videoInfo.formats?.map(f => f.format_id).slice(0, 10)
    })

    // More lenient filter: Include formats with video codec OR hasVideo flag OR height/width
    // Exclude only explicit audio-only formats (hasVideo === false)
    const videoFormats = videoInfo.formats.filter(f => {
      if (!f.format_id || f.format_id.trim() === '') {
        return false
      }
      
      // Explicitly exclude audio-only formats
      if (f.hasVideo === false) {
        return false
      }
      
      // Include if has video properties
      // Be lenient: include if has any video indicator OR format_note suggests video
      const hasHeightWidth = (typeof f.height === 'number' && f.height > 0) || 
                             (typeof f.width === 'number' && f.width > 0) ||
                             (typeof f.height === 'string' && parseInt(f.height, 10) > 0) ||
                             (typeof f.width === 'string' && parseInt(f.width, 10) > 0)
      const hasVideoCodec = f.video_codec && f.video_codec !== 'none' && f.video_codec !== 'unknown'
      const hasVideoFlag = f.hasVideo === true
      
      // Include if any video indicator is present, or if format_note suggests video
      const formatNoteSuggestsVideo = f.format_note && (
        /\d+p/.test(f.format_note) || 
        !f.format_note.toLowerCase().includes('audio only')
      )
      
      return hasHeightWidth || hasVideoCodec || hasVideoFlag || formatNoteSuggestsVideo
    })

    console.log('[Frontend] Filtered video formats:', {
      total: videoInfo.formats?.length || 0,
      filtered: videoFormats.length,
      sampleFiltered: videoFormats[0]
    })

    // If no formats are available from the API, show a friendly message
    if (videoFormats.length === 0) {
      console.warn('[Frontend] No video formats after filtering')
      console.warn('[Frontend] All formats:', videoInfo.formats?.slice(0, 5))
      return [
        {
          key: '720p@30fps',
          height: 720,
          fps: 30,
          formats: []
        },
        {
          key: '480p@30fps',
          height: 480,
          fps: 30,
          formats: []
        },
        {
          key: '360p@30fps',
          height: 360,
          fps: 30,
          formats: []
        }
      ]
    }

    // Group by resolution + fps
    const qualityMap = new Map<string, QualityOption>()

    videoFormats.forEach(format => {
      // Get height from format.height - handle both number and string types
      let height = 0
      if (typeof format.height === 'number' && format.height > 0) {
        height = format.height
      } else if (typeof format.height === 'string' && format.height) {
        const parsed = parseInt(format.height, 10)
        if (!isNaN(parsed) && parsed > 0) {
          height = parsed
        }
      }

      // If height is missing, try to parse from format_note
      if (height === 0 && format.format_note) {
        const match = format.format_note.match(/(\d+)p/i)
        if (match) {
          height = parseInt(match[1], 10)
        }
      }

      // Default to 360p if height is still missing (but log warning)
      if (height === 0) {
        console.warn('[Frontend] Format missing height, defaulting to 360p:', format.format_id, format)
        height = 360
      }

      // Get fps - handle both number and string types
      let fps = 30
      if (typeof format.fps === 'number' && format.fps > 0) {
        fps = format.fps
      } else if (typeof format.fps === 'string' && format.fps) {
        const parsed = parseInt(format.fps, 10)
        if (!isNaN(parsed) && parsed > 0) {
          fps = parsed
        }
      }

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
    
    const result = Array.from(qualityMap.values()).sort((a, b) => {
      if (a.height !== b.height) return b.height - a.height
      return b.fps - a.fps
    })
    
    console.log('[Frontend] Quality options created:', {
      count: result.length,
      options: result.map(r => ({ key: r.key, height: r.height, fps: r.fps, formatCount: r.formats.length }))
    })
    
    return result

  }, [videoInfo])

  // Get distinct audio quality options (grouped by bitrate only, largest size per bitrate)
  const audioQualityOptions = useMemo(() => {
    if (!videoInfo) return []

    // Audio-only formats: hasVideo === false OR no video codec
    // Note: f.url is optional - backend will resolve URLs via /api/download endpoint
    const audioFormats = videoInfo.formats.filter(f => {
      if (!f.format_id || f.format_id.trim() === '') {
        return false
      }
      
      // Explicit audio-only: hasVideo === false
      if (f.hasVideo === false) {
        return true
      }
      
      // Also include formats with audio codec but no video codec
      const hasAudio = f.audio_codec && f.audio_codec !== 'none'
      const hasVideo = f.video_codec && f.video_codec !== 'none'
      const noHeightWidth = (!f.height || f.height === 0) && (!f.width || f.width === 0)
      
      return hasAudio && !hasVideo && noHeightWidth
    })
    
    console.log('[Frontend] Filtered audio formats:', {
      total: videoInfo.formats?.length || 0,
      filtered: audioFormats.length,
      sampleFiltered: audioFormats[0]
    })

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
      // Extract bitrate from format_note (e.g., "audio only - 128kbps")
      // Backend now includes bitrate in format_note for audio-only formats
      let bitrate = 0;
      
      // First try parsing from format_note
      if (format.format_note) {
        const kbpsMatch = format.format_note.match(/(\d+)kbps/i);
        if (kbpsMatch) {
          bitrate = parseInt(kbpsMatch[1]) || 0;
        }
      }
      
      // Fallback: Use abr (audio bitrate) first, then tbr (total bitrate)
      // For audio-only formats, abr is more accurate than tbr
      if (bitrate === 0) {
        const formatBitrate = format.abr || format.tbr || 0;
        if (formatBitrate > 0) {
          bitrate = Math.round(formatBitrate); // Already in kbps from backend
        }
      }
      
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
  // Default to highest resolution + fps in MP4 for Combined, same for Video Only, highest MP3 for Audio Only
  useEffect(() => {
    if (videoInfo && qualityOptions.length > 0 && !selectedVideoQuality) {
      // For Combined: Find highest resolution in highest fps, preferring MP4
      // Sort by height descending, then fps descending
      const sortedQualities = [...qualityOptions].sort((a, b) => {
        if (a.height !== b.height) return b.height - a.height
        return b.fps - a.fps
      })
      
      // Try to find an option that has MP4 format available
      let bestQuality = sortedQualities[0]
      for (const quality of sortedQualities) {
        // Check if this quality has any formats in MP4
        const hasMp4 = quality.formats.some(f => f.ext === 'mp4' || !f.ext || f.ext === 'mov')
        if (hasMp4) {
          bestQuality = quality
          break
        }
      }
      
      setSelectedVideoQuality(bestQuality.key)
      console.log('[Frontend] Set Combined quality to:', bestQuality.key)
    }
    
    if (videoInfo && qualityOptions.length > 0 && !selectedVideoOnlyQuality) {
      // For Video Only: Same as Combined (highest resolution + fps)
      const sortedQualities = [...qualityOptions].sort((a, b) => {
        if (a.height !== b.height) return b.height - a.height
        return b.fps - a.fps
      })
      setSelectedVideoOnlyQuality(sortedQualities[0].key)
      console.log('[Frontend] Set Video Only quality to:', sortedQualities[0].key)
    }
    
    if (videoInfo && !selectedVideoFileType) {
      // Default to MP4 for combined
      setSelectedVideoFileType('mp4')
    }
    
    if (videoInfo && !selectedVideoOnlyFileType) {
      // Default to MP4 for video only
      setSelectedVideoOnlyFileType('mp4')
    }
    
    if (videoInfo && audioQualityOptions.length > 0 && !selectedAudioSource) {
      // For Audio Only: Auto-select highest bitrate audio format
      // YouTube typically provides webm/opus or m4a formats, not MP3
      // So we select highest bitrate regardless of format (user can convert to MP3 later)
      const sortedAudio = [...audioQualityOptions].sort((a, b) => {
        // Sort by bitrate descending, then by filesize descending
        if (b.bitrate !== a.bitrate) return b.bitrate - a.bitrate;
        return b.filesize - a.filesize;
      });
      
      const bestAudio = sortedAudio[0];
      setSelectedAudioSource(bestAudio.key);
      
      const formatExt = bestAudio.formats?.[0]?.ext || 'unknown';
      const formatName = formatExt.toUpperCase();
      console.log(`[Frontend] Auto-selected highest bitrate audio: ${bestAudio.bitrate}kbps (${formatName}) - ${bestAudio.key}`);
    }
    
    if (videoInfo && !selectedAudioFormat) {
      // Default to MP3 for audio only
      setSelectedAudioFormat('mp3')
    }
    
    // Smart audio track selection: prefer English, then Hindi, then first available
    if (videoInfo && selectedAudioTrack === 'default' && audioTracks && audioTracks.length > 0) {
      let bestTrackIndex = 0
      
      // Try to find English track
      const englishTrack = audioTracks.findIndex(track => 
        track.language_code?.toLowerCase().startsWith('en') || 
        track.language?.toLowerCase().includes('english')
      )
      if (englishTrack >= 0) {
        bestTrackIndex = englishTrack
      } else {
        // Try to find Hindi track
        const hindiTrack = audioTracks.findIndex(track => 
          track.language_code?.toLowerCase().startsWith('hi') || 
          track.language?.toLowerCase().includes('hindi')
        )
        if (hindiTrack >= 0) {
          bestTrackIndex = hindiTrack
        }
        // Otherwise use first track (index 0)
      }
      
      setSelectedAudioTrack(bestTrackIndex.toString())
      console.log('[Frontend] Auto-selected audio track:', bestTrackIndex, audioTracks[bestTrackIndex]?.language)
    }
  }, [videoInfo, qualityOptions, audioQualityOptions, selectedVideoQuality, selectedVideoOnlyQuality, selectedAudioSource, selectedVideoFileType, selectedVideoOnlyFileType, selectedAudioFormat, selectedAudioTrack, audioTracks])

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

    // Normalize YouTube URL (convert youtu.be to youtube.com/watch format)
    const normalizedUrl = normalizeYouTubeUrl(url)
    if (normalizedUrl !== url) {
      setUrl(normalizedUrl)
      console.log('Normalized URL:', url, '->', normalizedUrl)
    }

    setLoading(true)
    setVideoInfo(null)
    setSelectedVideoQuality('')
    setSelectedVideoOnlyQuality('')
    setSelectedAudioSource('')
    setSelectedSubtitleTrack('none')
    setSelectedAudioTrack('default')
    setErrorMessage(null)
    setExtractionStatus('🔍 Extracting video information...')

    try {
      // Use normalized URL for extraction
      const info = await extractVideoInfo(normalizedUrl)
      if (!info) {
        throw new Error('Failed to extract video information')
      }

      setVideoInfo(info)
      setPrevUrl(normalizedUrl)
      setErrorMessage(null)
      setExtractionStatus(null)
      
      // No success toast - extraction happens automatically
    } catch (error) {
      console.error('Error extracting video info:', error)
      setErrorMessage(error instanceof Error ? error.message : 'Failed to extract video information')
      setExtractionStatus(null)
    } finally {
      setLoading(false)
    }
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      setUrl(text)
      setErrorMessage(null)
    } catch (error) {
      console.error('Failed to read clipboard:', error)
      setErrorMessage('Unable to access clipboard. Please paste manually.')
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
        if (!qualityOption) {
          throw new Error('Selected quality not available')
        }

        // If no formats available from API, we use Format 18 + FFmpeg upscaling
        if (qualityOption.formats.length === 0) {
          console.log('📹 No API formats available, using Format 18 + FFmpeg upscaling approach')
          // Download Format 18 and upscale to selected resolution
          setDownloadProgress(10)
          const videoData = await downloadFormat(videoInfo.webpage_url, '18', (progress) => setDownloadProgress(10 + progress * 0.4))

          setDownloadProgress(50)

          // Upscale video to selected resolution using FFmpeg
          const { convertVideoToResolution } = await import('@/lib/ffmpeg')
          const processedData = await convertVideoToResolution(
            new Uint8Array(await videoData.arrayBuffer()),
            'mp4', // Format 18 is MP4
            qualityOption.height,
            selectedVideoFileType,
            (progress: number) => setDownloadProgress(50 + progress * 0.45)
          )

          setDownloadProgress(95)

          // Create filename and download
          const videoTitle = videoInfo.title || 'video'
          const filename = `${sanitizeFilename(videoTitle)}.${selectedVideoFileType}`

          // Convert Uint8Array to regular ArrayBuffer to avoid SharedArrayBuffer issues
          const regularUint8Array = new Uint8Array(processedData)
          const processedBlob = new Blob([regularUint8Array], { type: `video/${selectedVideoFileType}` })
          console.log('Downloaded and upscaled video:', { filename, originalSize: videoData.size, processedSize: processedBlob.size })

          downloadBlob(processedBlob, filename)

          toast({
            title: 'Success',
            description: `Video upscaled to ${qualityOption.height}p and downloaded successfully`,
          })

          setDownloading(false)
          setDownloadProgress(0)
          return
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
            toast({
              title: 'Processing',
              description: '⚙️ Processing video format...',
            })
            const videoBlob = await downloadFormatWithFallback(
              videoInfo.webpage_url,
              format18,
              (progress) => {
                // Map 0-100 to 10-95
                // 0-20% = Cookies (10-20%)
                // 20-40% = Processing with cookies (20-35%)
                // 40-60% = Waiting for download size (35-45%)
                // 60-100% = Downloading (45-95%)
                if (progress < 20) {
                  setDownloadProgress(10 + progress * 0.5)
                } else if (progress < 40) {
                  setDownloadProgress(20 + (progress - 20) * 0.75)
                } else if (progress < 60) {
                  setDownloadProgress(35 + (progress - 40) * 0.5)
                } else {
                  setDownloadProgress(45 + (progress - 60) * 0.5)
                }
              }
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
        // CRITICAL: Find the closest format match to avoid processing
        // Strategy: Find formats that match or nearly match requested height/fps
        // Prefer native formats (MP4 for MP4 output, WebM for WebM output) to skip transcoding
        
        const requestedHeight = qualityOption.height
        const requestedFps = qualityOption.fps
        const requestedExt = selectedVideoFileType
        
        // Score function: lower is better
        // Prefer exact matches, then near matches, prioritize native codec matches
        const scoreFormat = (f: VideoFormat): number => {
          let score = 0
          
          // Get video codec for preference scoring
          const codec = f.video_codec || ''
          
          // 1. Height match (most important) - exact match = 0 points
          const formatHeight = f.height || 0
          const heightDiff = Math.abs(formatHeight - requestedHeight)
          score += heightDiff * 100
          
          // 2. FPS match - exact match = 0 points
          const formatFps = f.fps || 0
          const fpsDiff = Math.abs(formatFps - requestedFps)
          score += fpsDiff * 50
          
          // 3. Format match
          // Native format match = 0 points (no transcoding)
          // Different format = 500 points (requires transcoding)
          const formatExt = f.ext || 'mp4'
          const isNativeFormat = 
            (requestedExt === 'mp4' && (formatExt === 'mp4' || formatExt === 'm4v')) ||
            (requestedExt === 'webm' && formatExt === 'webm') ||
            (requestedExt === 'mov' && (formatExt === 'mov' || formatExt === 'mp4')) ||
            (requestedExt === 'mkv' && formatExt === 'mkv')
          
          if (!isNativeFormat) {
            score += 500
          }
          
          // 4. Video codec preference - prefer H.264 over VP9 (H.264 is faster and more compatible)
          // VP9 is slower but works reliably
          if (codec.includes('vp9') || codec.includes('VP9')) {
            score += 50  // Small penalty for VP9, but it's acceptable
          }
          
          return score
        }
        
        // Filter available formats and score them
        const scoredFormats = qualityOption.formats
          .filter(f => f.format_id && f.height) // Must have ID and height
          .map(f => ({ format: f, score: scoreFormat(f) }))
          .sort((a, b) => a.score - b.score)
        
        if (scoredFormats.length === 0) {
          throw new Error('No suitable formats available')
        }
        
        const bestFormat = scoredFormats[0].format
        const bestScore = scoredFormats[0].score
        
        // Log format selection strategy
        console.log('📊 Format Selection:', {
          requested: { height: requestedHeight, fps: requestedFps, ext: requestedExt },
          selected: { 
            formatId: bestFormat.format_id, 
            height: bestFormat.height, 
            fps: bestFormat.fps,
            ext: bestFormat.ext,
            codec: bestFormat.video_codec
          },
          score: bestScore,
          topCandidates: scoredFormats.slice(0, 3).map(s => ({
            id: s.format.format_id,
            h: s.format.height,
            fps: s.format.fps,
            ext: s.format.ext,
            score: s.score
          }))
        })
        
        // Determine if processing is needed
        const needsProcessing = bestScore > 10 // Only if significant mismatch
        if (!needsProcessing) {
          console.log('✨ Direct download: Format matches requirements perfectly!')
        } else {
          console.log(`⚠️  Processing needed (score: ${bestScore})`)
        }
        
        let videoFormat = bestFormat
        
        if (!videoFormat.format_id) {
          throw new Error('Video format not available')
        }

        toast({
          title: 'Processing',
          description: '⚙️ Processing video format...',
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
              const subtitleBlob = await downloadFormatWithoutProgress(subtitleUrl)
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
          
          // Upscale and/or convert format in one pass (strip audio for video-only)
          const processedData = await convertVideoToResolution(
            videoData,
            videoFormat.ext || 'mp4',
            targetHeight || 360, // Upscale to selected resolution (or keep 360p)
            selectedVideoOnlyFileType,
            (progress: number) => setDownloadProgress(60 + progress * 0.3),
            true // stripAudio: true - remove audio for video-only downloads
          )
          videoData = new Uint8Array(processedData)
        } else {
          // No upscaling/conversion needed, but still need to strip audio
          // (Format 18 has audio, so we need to remove it)
          setDownloadProgress(60)
          const { extractVideoOnly } = await import('@/lib/ffmpeg')
          const videoOnlyData = await extractVideoOnly(
            videoData,
            videoFormat.ext || 'mp4',
            (progress: number) => setDownloadProgress(60 + progress * 0.3)
          )
          videoData = new Uint8Array(videoOnlyData)
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
    <div className={`w-full ${videoInfo ? 'space-y-2' : 'space-y-3 sm:space-y-4'}`}>
      {/* URL Input Section - Always visible */}
      <Card className={`border-0 shadow-sm bg-card/50 backdrop-blur-sm`}>
          <CardContent className={`p-3 sm:p-4`}>
            <div className={`space-y-2`}>
              <div className="space-y-1">
                <Label htmlFor="video-url" className="text-xs sm:text-sm font-medium">
                  Video URL
                </Label>
                <div className="flex flex-col sm:flex-row gap-1.5 sm:gap-2">
                  <div className="flex-1 relative">
                    <Input
                      id="video-url"
                      type="url"
                      placeholder="Paste YouTube link..."
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleExtract()
                        }
                      }}
                      className="w-full pr-10 bg-background/50 text-sm h-11 sm:h-12"
                      autoComplete="off"
                      aria-label="YouTube video URL"
                      disabled={loading}
                    />
                    <div className="absolute inset-y-0 right-0 flex items-center pointer-events-none">
                      <Link2 className="h-3.5 w-3.5 text-muted-foreground mr-2.5" />
                    </div>
                  </div>
                  <div className="flex gap-1 flex-col sm:flex-row sm:w-auto">
                    <Button
                      onClick={handlePaste}
                      disabled={loading}
                      variant="outline"
                      className="w-full sm:w-auto text-xs sm:text-sm h-11 sm:h-12 px-2 sm:px-3"
                      title="Paste from clipboard"
                      aria-label="Paste URL from clipboard"
                    >
                      <Clipboard className="h-3.5 w-3.5 mr-1 sm:mr-0" />
                      <span className="sm:hidden">Paste</span>
                    </Button>
                    <Button
                      onClick={() => setCookieModalOpen(true)}
                      disabled={loading}
                      variant="outline"
                      className="w-full sm:w-auto text-xs sm:text-sm h-11 sm:h-12 px-2 sm:px-3"
                      title="Upload YouTube cookies"
                      aria-label="Upload YouTube cookies"
                    >
                      <Cookie className="h-3.5 w-3.5 mr-1 sm:mr-0" />
                      <span className="sm:hidden">Cookies</span>
                    </Button>
                    <Button
                      onClick={(e) => {
                        console.log('Extract button clicked!', e);
                        handleExtract();
                      }}
                      disabled={loading || !url.trim()}
                      className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-xs sm:text-sm h-11 sm:h-12 px-2 sm:px-3"
                      aria-label={loading ? "Extracting video information..." : "Extract video information"}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                          <span className="hidden sm:inline">Extracting...</span>
                          <span className="sm:hidden">...</span>
                        </>
                      ) : (
                        <>
                          <Link2 className="h-3.5 w-3.5 mr-1 sm:mr-0" />
                          <span className="hidden sm:inline">Extract</span>
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

      {/* Error Alert */}
      {errorMessage && (
        <Alert className="bg-destructive/10 border-destructive/20 text-destructive py-2 px-3">
          <AlertDescription className="flex items-start justify-between gap-2 text-xs sm:text-sm">
            <span>{errorMessage}</span>
            <button
              onClick={() => setErrorMessage(null)}
              className="flex-shrink-0 hover:opacity-70 transition-opacity"
              aria-label="Dismiss error message"
            >
              ✕
            </button>
          </AlertDescription>
        </Alert>
      )}

      {/* Extraction Status - Shows during retries */}
      {loading && extractionStatus && (
        <Alert className="bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400 py-2 px-3">
          <AlertDescription className="flex items-center gap-2 text-xs sm:text-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
            <span>{extractionStatus}</span>
          </AlertDescription>
        </Alert>
      )}

      {/* Video Info - Hidden in compact mode */}
      {videoInfo && (
        <Card className="border-0 shadow-sm overflow-hidden">
          {/* Video Header - Thumbnail + Info */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 p-3 sm:p-4 border-b border-border/50">
            {videoInfo.thumbnail && (
              <div className="flex-shrink-0 w-full sm:w-24">
                <img
                  src={videoInfo.thumbnail}
                  alt={videoInfo.title}
                  className="w-full h-auto sm:h-20 object-cover rounded-lg"
                  loading="lazy"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-sm sm:text-base font-semibold line-clamp-2 mb-1">
                {videoInfo.title}
              </h2>
              <div className="space-y-0.5 text-xs sm:text-sm text-muted-foreground">
                {videoInfo.uploader && (
                  <p>
                    <span className="font-medium text-foreground/70">Channel:</span> {videoInfo.uploader}
                  </p>
                )}
                {videoInfo.duration > 0 && (
                  <p>
                    <span className="font-medium text-foreground/70">Duration:</span> {formatDuration(videoInfo.duration)}
                  </p>
                )}
                {videoInfo.view_count && (
                  <p>
                    <span className="font-medium text-foreground/70">Views:</span> {formatViewCount(videoInfo.view_count)}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Download Tabs */}
          <CardContent className="p-3 sm:p-4">
            <Tabs value={formatType} onValueChange={(v) => setFormatType(v as 'video' | 'audio' | 'video-only')} className="w-full">
              <TabsList className="grid w-full grid-cols-3 gap-0 h-auto">
                <TabsTrigger value="video" className="text-xs sm:text-sm py-1.5 px-0.5 sm:px-2 gap-0.5 sm:gap-1">
                  <Video className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="hidden sm:inline">Video+Audio</span>
                  <span className="sm:hidden">Video</span>
                </TabsTrigger>
                <TabsTrigger value="video-only" className="text-xs sm:text-sm py-1.5 px-0.5 sm:px-2 gap-0.5 sm:gap-1">
                  <Video className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="hidden sm:inline">Video Only</span>
                  <span className="sm:hidden">Only</span>
                </TabsTrigger>
                <TabsTrigger value="audio" className="text-xs sm:text-sm py-1.5 px-0.5 sm:px-2 gap-0.5 sm:gap-1">
                  <Music className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="hidden sm:inline">Audio</span>
                  <span className="sm:hidden">Audio</span>
                </TabsTrigger>
              </TabsList>

              {/* Combined Tab */}
              <TabsContent value="video" className="space-y-2 sm:space-y-3 mt-3 sm:mt-4">
                <div className="grid gap-2 sm:gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="video-quality" className="text-xs sm:text-sm font-medium">Quality</Label>
                    <Select value={selectedVideoQuality} onValueChange={setSelectedVideoQuality}>
                      <SelectTrigger id="video-quality" className="text-xs sm:text-sm h-8 sm:h-9">
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
                  <div className="space-y-1">
                    <Label htmlFor="video-format" className="text-xs sm:text-sm font-medium">Format</Label>
                    <Select value={selectedVideoFileType} onValueChange={setSelectedVideoFileType}>
                      <SelectTrigger id="video-format" className="text-xs sm:text-sm h-8 sm:h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mp4">MP4</SelectItem>
                        <SelectItem value="webm">WebM</SelectItem>
                        <SelectItem value="mov">MOV</SelectItem>
                        <SelectItem value="mkv">MKV</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="audio-track" className="text-xs sm:text-sm font-medium">Audio Track</Label>
                  <Select value={selectedAudioTrack} onValueChange={setSelectedAudioTrack}>
                    <SelectTrigger id="audio-track" className="text-xs sm:text-sm h-8 sm:h-9">
                      <SelectValue placeholder="Select audio track" />
                    </SelectTrigger>
                    <SelectContent>
                      {audioTracks.map((track, index) => (
                        <SelectItem key={track.format_id || `track-${index}`} value={index.toString()}>
                          {track.language} ({track.language_code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {subtitleTracks.length > 0 && (
                  <div className="space-y-1">
                    <Label htmlFor="subtitle-track" className="text-xs sm:text-sm font-medium">Subtitles (Optional)</Label>
                    <Select value={selectedSubtitleTrack} onValueChange={setSelectedSubtitleTrack}>
                      <SelectTrigger id="subtitle-track" className="text-xs sm:text-sm h-8 sm:h-9">
                        <SelectValue placeholder="Select subtitles" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
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

              {/* Video Only Tab */}
              <TabsContent value="video-only" className="space-y-2 sm:space-y-3 mt-3 sm:mt-4">
                <div className="grid gap-2 sm:gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="video-only-quality" className="text-xs sm:text-sm font-medium">Quality</Label>
                    <Select value={selectedVideoOnlyQuality} onValueChange={setSelectedVideoOnlyQuality}>
                      <SelectTrigger id="video-only-quality" className="text-xs sm:text-sm h-8 sm:h-9">
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
                  <div className="space-y-1">
                    <Label htmlFor="video-only-format" className="text-xs sm:text-sm font-medium">Format</Label>
                    <Select value={selectedVideoOnlyFileType} onValueChange={setSelectedVideoOnlyFileType}>
                      <SelectTrigger id="video-only-format" className="text-xs sm:text-sm h-8 sm:h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mp4">MP4</SelectItem>
                        <SelectItem value="webm">WebM</SelectItem>
                        <SelectItem value="mov">MOV</SelectItem>
                        <SelectItem value="mkv">MKV</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>

              {/* Audio Only Tab */}
              <TabsContent value="audio" className="space-y-2 sm:space-y-3 mt-3 sm:mt-4">
                <div className="grid gap-2 sm:gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="audio-quality" className="text-xs sm:text-sm font-medium">Quality</Label>
                    <Select value={selectedAudioSource} onValueChange={setSelectedAudioSource}>
                      <SelectTrigger id="audio-quality" className="text-xs sm:text-sm h-8 sm:h-9">
                        <SelectValue placeholder="Select quality" />
                      </SelectTrigger>
                      <SelectContent>
                        {audioQualityOptions.length === 0 ? (
                          <SelectItem value="no-formats" disabled>
                            No audio available
                          </SelectItem>
                        ) : (
                          audioQualityOptions.map((option) => {
                            const formatExt = option.formats?.[0]?.ext || '';
                            const formatName = formatExt ? formatExt.toUpperCase() : '';
                            const displayName = option.bitrate > 0 
                              ? `${option.bitrate}kbps${formatName ? ` (${formatName})` : ''}`
                              : formatName || 'Audio';
                            return (
                              <SelectItem key={option.key} value={option.key}>
                                {displayName}
                                {option.filesize > 0 && ` • ${formatFileSize(option.filesize)}`}
                              </SelectItem>
                            );
                          })
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="audio-format" className="text-xs sm:text-sm font-medium">Format</Label>
                    <Select value={selectedAudioFormat} onValueChange={setSelectedAudioFormat}>
                      <SelectTrigger id="audio-format" className="text-xs sm:text-sm h-8 sm:h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mp3">MP3</SelectItem>
                        <SelectItem value="m4a">M4A</SelectItem>
                        <SelectItem value="ogg">OGG</SelectItem>
                        <SelectItem value="wav">WAV</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            {/* Download Progress */}
            {downloading && (
              <div className="mt-3 sm:mt-4 space-y-2 p-2 sm:p-3 bg-muted/50 rounded-lg">
                <Progress value={downloadProgress} className="h-1.5" />
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">{downloadProgress.toFixed(0)}%</span>
                  <span className="text-muted-foreground">Processing...</span>
                </div>
              </div>
            )}

            {/* Download Button */}
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
              className="w-full mt-3 sm:mt-4 h-11 sm:h-12 text-sm font-semibold bg-primary hover:bg-primary/90"
              aria-label={`Download ${formatType === 'video' ? 'video with audio' : formatType === 'video-only' ? 'video only' : 'audio only'}`}
            >
              {downloading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Cookie Upload Modal */}
      <CookieUploadModal
        open={cookieModalOpen}
        onOpenChange={setCookieModalOpen}
        apiBaseUrl={getApiBaseUrl()}
      />
    </div>
  )
}