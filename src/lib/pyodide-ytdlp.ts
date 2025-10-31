/**
 * Client-side YouTube extraction using Pyodide + yt-dlp
 * This runs entirely in the browser - no server required for extraction
 * Server only used for proxying streams (CORS bypass)
 */

import type { VideoInfo } from './types'

let pyodideReady: Promise<any> | null = null

// Detect API base URL
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

/**
 * Initialize Pyodide and load yt-dlp
 */
export async function initPyodide(): Promise<any> {
  if (pyodideReady) {
    return pyodideReady
  }

  pyodideReady = (async () => {
    console.log('[Pyodide] Loading Pyodide runtime from CDN...')
    
    // Use dynamic import to avoid bundling Pyodide
    const PyodideModule = await import('pyodide')
    const pyodide = await PyodideModule.loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.29.0/full/',
    })

    console.log('[Pyodide] Loading yt-dlp from PyPI...')
    
    // Load required packages FIRST
    await pyodide.loadPackage('sqlite3')
    await pyodide.loadPackage('micropip')  // Load micropip package
    
    // THEN install yt-dlp using micropip
    await pyodide.runPythonAsync(`
      import micropip
      await micropip.install('yt-dlp')
    `)

    console.log('[Pyodide] ✅ yt-dlp loaded successfully')
    
    return pyodide
  })()

  return pyodideReady
}

/**
 * Extract video information using client-side yt-dlp
 */
export async function extractVideoInfoClient(url: string): Promise<VideoInfo> {
  try {
    console.log('[Client-YT-DLP] Starting extraction:', url)
    
    const pyodide = await initPyodide()
    
    // Python code to run yt-dlp and get video info
    const pythonCode = `
import json
import yt_dlp

url = '${url.replace(/'/g, "\\'")}'

try:
    # Extract video info with yt-dlp
    ydl_opts = {
        'quiet': False,
        'no_warnings': True,
        'extract_flat': False,
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    
    # Format the response
    response = {
        'id': info.get('id', ''),
        'title': info.get('title', ''),
        'thumbnail': info.get('thumbnail', ''),
        'duration': info.get('duration', 0),
        'description': info.get('description', ''),
        'uploader': info.get('uploader', ''),
        'view_count': info.get('view_count', 0),
        'formats': []
    }
    
    # Process formats
    if 'formats' in info and info['formats']:
        for fmt in info['formats']:
            try:
                format_entry = {
                    'format_id': str(fmt.get('format_id', '')),
                    'format_note': fmt.get('format_note', '') or fmt.get('resolution', ''),
                    'ext': fmt.get('ext', 'mp4'),
                    'resolution': fmt.get('resolution', ''),
                    'filesize': fmt.get('filesize'),
                    'fps': fmt.get('fps'),
                    'video_codec': fmt.get('vcodec'),
                    'audio_codec': fmt.get('acodec'),
                    'url': fmt.get('url', ''),
                    'height': fmt.get('height'),
                    'width': fmt.get('width'),
                    'hasVideo': bool(fmt.get('vcodec') and fmt.get('vcodec') != 'none'),
                    'hasAudio': bool(fmt.get('acodec') and fmt.get('acodec') != 'none'),
                }
                response['formats'].append(format_entry)
            except Exception as e:
                print(f"Error processing format: {e}")
                continue
    
    json.dumps(response)
except Exception as e:
    import traceback
    error_msg = str(e) + "\\n" + traceback.format_exc()
    json.dumps({"error": error_msg})
`

    const result = await pyodide.runPythonAsync(pythonCode)
    const parsed = JSON.parse(result)
    
    if (parsed.error) {
      throw new Error(parsed.error)
    }

    console.log('[Client-YT-DLP] ✅ Extracted:', {
      videoId: parsed.id,
      title: parsed.title,
      formatCount: parsed.formats.length,
    })

    return {
      ...parsed,
      webpage_url: url,
      platform: 'youtube',
      subtitle_tracks: [],
      audio_tracks: [],
    }
  } catch (error) {
    console.error('[Client-YT-DLP] Extraction failed:', error)
    throw error
  }
}

/**
 * Download a specific format via the stream proxy
 */
export async function downloadFormatClient(
  videoUrl: string,
  formatId: string,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  try {
    console.log(`[Client-YT-DLP] Getting download URL for format ${formatId}...`)

    const pyodide = await initPyodide()

    // Get the direct URL from yt-dlp
    const pythonCode = `
import yt_dlp
import json

url = '${videoUrl.replace(/'/g, "\\'")}'
format_id = '${formatId}'

try:
    # Get info with this specific format
    ydl_opts = {'quiet': True, 'no_warnings': True}
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    
    # Find the format
    target_format = None
    if 'formats' in info:
        for fmt in info['formats']:
            if str(fmt.get('format_id')) == format_id:
                target_format = fmt
                break
    
    if not target_format:
        raise ValueError(f"Format {format_id} not found in video")
    
    # Get the URL
    stream_url = target_format.get('url')
    if not stream_url:
        raise ValueError(f"No URL found for format {format_id}")
    
    json.dumps({"url": stream_url, "ext": target_format.get('ext', 'mp4')})
except Exception as e:
    import traceback
    json.dumps({"error": str(e) + "\\n" + traceback.format_exc()})
`

    const result = await pyodide.runPythonAsync(pythonCode)
    const parsed = JSON.parse(result)

    if (parsed.error) {
      throw new Error(`Failed to get format URL: ${parsed.error}`)
    }

    const streamUrl = parsed.url
    console.log('[Client-YT-DLP] Got URL, downloading via proxy...')

    // Now download via the server proxy to bypass CORS
    const proxyUrl = `${getApiBaseUrl()}/stream?url=${encodeURIComponent(streamUrl)}`
    
    const response = await fetch(proxyUrl)

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Stream proxy failed: ${response.status} ${errorText.substring(0, 100)}`)
    }

    // Track download progress
    const contentLength = response.headers.get('content-length')
    const total = contentLength ? parseInt(contentLength, 10) : 0
    let received = 0
    const chunks: BlobPart[] = []

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

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
    console.log('[Client-YT-DLP] ✅ Downloaded:', blob.size, 'bytes')

    return blob
  } catch (error) {
    console.error('[Client-YT-DLP] Download failed:', error)
    throw error
  }
}

/**
 * Clear Pyodide from memory (for cleanup)
 */
export function clearPyodide(): void {
  pyodideReady = null
  console.log('[Pyodide] Cleared from memory')
}
