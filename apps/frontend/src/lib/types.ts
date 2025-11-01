export interface VideoFormat {
  format_id: string
  format_note?: string
  ext: string
  resolution?: string
  filesize?: number
  filesize_approx?: number
  fps?: number
  video_codec?: string
  audio_codec?: string
  quality?: number
  vcodec?: string
  acodec?: string
  url?: string
  protocol?: string
  width?: number
  height?: number
  hasAudio?: boolean
  hasVideo?: boolean
  language?: string
  audio_track_id?: string
}

export interface SubtitleTrack {
  language: string
  language_code: string
  format_id: string
  base_url?: string
}

export interface AudioTrack {
  language: string
  language_code: string
  format_id: string
  track_id?: string
  format_ids?: string[]
}

export interface VideoInfo {
  id: string
  title: string
  thumbnail: string
  duration: number
  formats: VideoFormat[]
  subtitle_tracks?: SubtitleTrack[]
  audio_tracks?: AudioTrack[]
  webpage_url: string
  platform: 'youtube' | 'instagram' | 'facebook' | 'twitter'
  description?: string
  uploader?: string
  view_count?: number
}

export interface DownloadOptions {
  format_id: string
  format_type: 'video' | 'audio'
  audio_track?: string
  ext: string
}

export function detectPlatform(url: string): VideoInfo['platform'] | null {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube'
  // Other platforms removed - YouTube only for now
  return null
}

/**
 * Normalize YouTube URLs to standard watch format
 * Converts youtu.be share links and removes unnecessary parameters
 * @param url - YouTube URL (any format)
 * @returns Normalized YouTube URL in watch format
 */
export function normalizeYouTubeUrl(url: string): string {
  try {
    const urlObj = new URL(url)
    
    // Handle youtu.be share links
    if (urlObj.hostname === 'youtu.be' || urlObj.hostname === 'www.youtu.be') {
      const videoId = urlObj.pathname.slice(1).split('/')[0]
      return `https://www.youtube.com/watch?v=${videoId}`
    }
    
    // Handle youtube.com URLs
    if (urlObj.hostname.includes('youtube.com')) {
      // Extract video ID from various formats
      let videoId = urlObj.searchParams.get('v')
      
      // Handle /embed/ format
      if (!videoId && urlObj.pathname.includes('/embed/')) {
        videoId = urlObj.pathname.split('/embed/')[1].split('/')[0]
      }
      
      // Handle /v/ format
      if (!videoId && urlObj.pathname.includes('/v/')) {
        videoId = urlObj.pathname.split('/v/')[1].split('/')[0]
      }
      
      // Handle /watch format (already normalized)
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`
      }
    }
    
    // Return original URL if we couldn't normalize it
    return url
  } catch (e) {
    // If URL parsing fails, return original
    return url
  }
}

export function formatFileSize(bytes?: number): string {
  if (!bytes) return 'Unknown size'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

export function formatViewCount(count?: number): string {
  if (!count) return 'Unknown views'
  if (count >= 1_000_000_000) {
    return `${(count / 1_000_000_000).toFixed(1)}B views`
  }
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M views`
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K views`
  }
  return `${count} views`
}

// Sanitize filename by removing invalid characters
export function sanitizeFilename(filename: string): string {
  // Remove or replace invalid filename characters
  // Windows: < > : " / \ | ? *
  // Unix: / (forward slash)
  return filename
    .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid chars with underscore
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
    .replace(/^\.+/, '') // Remove leading dots
    .replace(/\.+$/, '') // Remove trailing dots
    .substring(0, 200) // Limit length
}

export function downloadBlob(blob: Blob, filename: string) {
  // Ensure filename is sanitized
  const sanitizedFilename = sanitizeFilename(filename)
  
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = sanitizedFilename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

