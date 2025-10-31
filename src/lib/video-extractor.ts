import type { VideoInfo } from '@/lib/types'
import { detectPlatform } from '@/lib/types'

// Detect API base URL based on current path
// Priority: 1. VITE_API_URL env, 2. /grabber/api for local dev, 3. /api for local dev
function getApiBaseUrl(): string {
  // First priority: Check for VITE_API_URL environment variable (production)
  const envUrl = (import.meta as any).env?.VITE_API_URL
  if (envUrl) {
    console.log('[API Config] Using VITE_API_URL from environment:', envUrl)
    return envUrl
  }
  
  // Fallback: Check window location for local development
  if (typeof window !== 'undefined') {
    const pathname = window.location.pathname
    if (pathname.startsWith('/grabber')) {
      console.log('[API Config] Using local /grabber/api path')
      return '/grabber/api'
    }
  }
  
  console.log('[API Config] Using local /api path')
  return '/api'
}

// Re-export detectPlatform for convenience
export { detectPlatform }

/**
 * Extract video information using backend API
 */
export async function extractVideoInfo(url: string): Promise<VideoInfo | null> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/extract?url=${encodeURIComponent(url)}`)
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(errorData.error || errorData.message || 'Failed to extract video info')
    }

    const data = await response.json()
    return data as VideoInfo
  } catch (error) {
    console.error('Error extracting video info:', error)
    throw error
  }
}

/**
 * Download video through proxy (for CORS bypass)
 */
export async function downloadVideo(
  url: string,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  try {
    // Use API proxy for downloads
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
        chunks.push(new Uint8Array(value))
        received += value.length
      }

      if (onProgress && total > 0) {
        onProgress((received / total) * 100)
      }
    }

    return new Blob(chunks)
  } catch (error) {
    console.error('Error downloading video:', error)
    throw error
  }
}

