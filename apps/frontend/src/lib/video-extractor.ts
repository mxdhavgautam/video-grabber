import type { VideoInfo } from '@/lib/types'
import { detectPlatform } from '@/lib/types'

// Detect API base URL based on current environment
// Priority: 1. VITE_API_URL env (production), 2. local dev proxy
export function getApiBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_API_URL
  if (envUrl && envUrl !== '' && !envUrl.includes('undefined')) {
    return envUrl
  }
  
  if (typeof window !== 'undefined') {
    const origin = window.location.origin
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return '/api'
    }
  }
  
  return '/api'
}

// Re-export detectPlatform for convenience
export { detectPlatform }

/**
 * Extract video information using backend API
 */
export async function extractVideoInfo(url: string): Promise<VideoInfo | null> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      // Prefer message over error as message usually contains the full user-friendly text
      const errorText = errorData.message || errorData.error || 'Failed to extract video info'
      throw new Error(errorText)
    }

    const data = await response.json()
    return data.success ? data.data : data
  } catch (error) {
    console.error('Error extracting video info:', error)
    throw error
  }
}

/**
 * Download video through proxy using format ID (for CORS bypass)
 * Format ID is now from yt-dlp and can represent:
 * - Combined video+audio (e.g., "18", "22")
 * - Video-only (e.g., "401", "137")
 * - Audio-only (e.g., "140", "251")
 */
export async function downloadVideo(
  url: string,
  formatId: string,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  try {
    // Use new API endpoint with format parameter
    const proxyUrl = `${getApiBaseUrl()}/download?url=${encodeURIComponent(url)}&format=${encodeURIComponent(formatId)}`
    
    // Start SSE connection for progress updates
    let progressConnection: any = null
    let lastProgress = 0
    
    if (typeof window !== 'undefined' && 'EventSource' in window) {
      try {
        progressConnection = new (window as any).EventSource(`${getApiBaseUrl()}/api/progress?format=${encodeURIComponent(formatId)}`)
        
        progressConnection.onmessage = (event: any) => {
          try {
            const data = JSON.parse(event.data)
            if (data.progress !== undefined) {
              lastProgress = data.progress
              onProgress?.(data.progress)
              console.log(`📊 Download progress: ${data.progress}% (${data.stage})`)
            }
          } catch (e) {
            console.warn('Failed to parse progress:', e)
          }
        }
        
        progressConnection.onerror = () => {
          if (progressConnection) {
            progressConnection.close()
          }
        }
      } catch (e) {
        console.warn('Failed to establish progress connection:', e)
      }
    }
    
    // Start download
    const downloadPromise = fetch(proxyUrl)
    
    // Wait a bit for progress connection to establish
    await new Promise(r => setTimeout(r, 100))
    
    const response = await downloadPromise
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(errorData.error || `Failed to download: ${response.statusText}`)
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

      // Update progress based on bytes received
      if (onProgress && total > 0) {
        // Map file transfer (80-100) while backend upload finishes
        const transferProgress = 80 + (received / total) * 20
        onProgress(Math.max(lastProgress, transferProgress))
      }
    }

    // Close SSE connection
    if (progressConnection) {
      progressConnection.close()
    }

    return new Blob(chunks)
  } catch (error) {
    console.error('Error downloading video:', error)
    throw error
  }
}

