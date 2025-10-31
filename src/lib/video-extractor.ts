import type { VideoInfo } from '@/lib/types'
import { detectPlatform } from '@/lib/types'

// Type definition for Chrome API
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        lastError?: Error
      }
      cookies?: {
        getAll: (query: { url: string }, callback: (cookies: Array<{
          name: string
          value: string
          domain?: string
          path?: string
          secure?: boolean
          httpOnly?: boolean
          expirationDate?: number
          hostOnly?: boolean
        }>) => void) => void
      }
    }
  }
}

// Detect API base URL based on current path
// Priority: 1. VITE_API_URL env, 2. /grabber/api for local dev, 3. /api for local dev
function getApiBaseUrl(): string {
  // First priority: Check for VITE_API_URL environment variable (production)
  const envUrl = (import.meta as any).env?.VITE_API_URL
  if (envUrl && envUrl !== '' && !envUrl.includes('undefined')) {
    console.log('[API Config] Using VITE_API_URL from environment:', envUrl)
    return envUrl
  }
  
  // Fallback: Check window location for local development
  if (typeof window !== 'undefined') {
    const pathname = window.location.pathname
    console.log('[API Config] pathname:', pathname, 'env:', envUrl)
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
 * Enable automatic browser cookie extraction from Chrome
 * Extracts cookies from the browser and sends them to the backend
 */
export async function enableBrowserCookies(): Promise<void> {
  try {
    // First, try to extract cookies from the browser
    let cookies: string | undefined
    
    if (typeof window !== 'undefined' && window.chrome?.cookies) {
      // Use Chrome API to get cookies
      cookies = await new Promise<string>((resolve, reject) => {
        window.chrome!.cookies!.getAll({ url: 'https://www.youtube.com' }, (cookieArray) => {
          if (window.chrome?.runtime?.lastError) {
            reject(new Error('Failed to access cookies from browser'))
            return
          }
          
          // Format as Netscape cookies.txt format
          const cookieLines = (cookieArray || []).map(cookie => {
            return [
              cookie.domain || '.youtube.com',
              cookie.hostOnly ? 'FALSE' : 'TRUE',
              cookie.path || '/',
              cookie.secure ? 'TRUE' : 'FALSE',
              cookie.expirationDate ? Math.floor(cookie.expirationDate) : '0',
              cookie.name,
              cookie.value
            ].join('\t')
          }).join('\n')
          
          resolve(cookieLines)
        })
      })
    }
    
    // Send cookies to backend (or just enable flag if no cookies extracted)
    const response = await fetch(`${getApiBaseUrl()}/api/enable-cookies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cookies: cookies || null }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(errorData.error || errorData.message || `Failed to enable cookies: ${response.statusText}`)
    }
  } catch (error) {
    console.error('Error enabling browser cookies:', error)
    throw error
  }
}

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

