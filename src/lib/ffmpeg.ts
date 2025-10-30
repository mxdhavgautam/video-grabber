import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

let ffmpegInstance: FFmpeg | null = null
let isLoaded = false

export async function loadFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && isLoaded) {
    return ffmpegInstance
  }

  const ffmpeg = new FFmpeg()
  ffmpegInstance = ffmpeg

  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'

  ffmpeg.on('log', ({ message }) => {
    // Filter out "Aborted()" messages - these are normal in WebAssembly FFmpeg
    // FFmpeg completes successfully, then WebAssembly terminates it, causing "Aborted()"
    if (message.includes('Aborted()') && message.trim() === 'Aborted()') {
      // Suppress this specific message - it's not an error
      return
    }
    console.log('[FFmpeg]', message)
  })

  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })

  isLoaded = true
  return ffmpeg
}

export async function convertVideoToFormat(
  inputData: Uint8Array,
  inputFormat: string,
  outputFormat: string,
  onProgress?: (progress: number) => void
): Promise<Uint8Array> {
  const ffmpeg = await loadFFmpeg()

  const inputFileName = `input.${inputFormat}`
  const outputFileName = `output.${outputFormat}`

  await ffmpeg.writeFile(inputFileName, inputData)

  ffmpeg.on('progress', ({ progress }) => {
    if (onProgress) {
      onProgress(progress * 100)
    }
  })

  // Determine codec based on output format
  let videoCodec = 'libx264'
  let audioCodec = 'aac'
  
  if (outputFormat === 'webm') {
    videoCodec = 'libvpx-vp9'
    audioCodec = 'libopus'
  } else if (outputFormat === 'mov') {
    videoCodec = 'libx264'
    audioCodec = 'aac'
  } else if (outputFormat === 'avi') {
    videoCodec = 'libx264'
    audioCodec = 'libmp3lame'
  } else if (outputFormat === 'mkv') {
    videoCodec = 'libx264'
    audioCodec = 'aac'
  } else if (outputFormat === 'flv') {
    videoCodec = 'libx264'
    audioCodec = 'libmp3lame'
  }

  await ffmpeg.exec([
    '-i', inputFileName,
    '-c:v', videoCodec,
    '-c:a', audioCodec,
    '-preset', 'medium',
    '-crf', '23',
    outputFileName,
  ])

  const data = await ffmpeg.readFile(outputFileName)
  await ffmpeg.deleteFile(inputFileName)
  await ffmpeg.deleteFile(outputFileName)

  return data as Uint8Array
}

export async function extractAudioFromVideo(
  videoData: Uint8Array,
  videoFormat: string,
  audioFormat: string = 'mp3',
  audioBitrate: string = '192k',
  onProgress?: (progress: number) => void
): Promise<Uint8Array> {
  const ffmpeg = await loadFFmpeg()

  const inputFileName = `input.${videoFormat}`
  const outputFileName = `output.${audioFormat}`

  // Validate input data
  if (!videoData || videoData.length === 0) {
    throw new Error('Invalid video data: empty or null')
  }

  await ffmpeg.writeFile(inputFileName, videoData)

  ffmpeg.on('progress', ({ progress }) => {
    if (onProgress) {
      onProgress(progress * 100)
    }
  })

  // For fragmented MP4 (fMP4) or streaming formats, we need to allow incomplete files
  // Add flags to handle potentially incomplete MP4 files
  const args = [
    '-i', inputFileName,
    '-vn',
    '-acodec', audioFormat === 'mp3' ? 'libmp3lame' : 'aac',
    '-ab', audioBitrate,
    '-fflags', '+genpts', // Generate PTS if missing (needed for fragmented MP4)
    '-err_detect', 'ignore_err', // Ignore errors
    '-avoid_negative_ts', 'make_zero', // Handle negative timestamps
    outputFileName,
  ]

  try {
    await ffmpeg.exec(args)
  } catch (error: any) {
    // FFmpeg WebAssembly sometimes reports "Aborted()" even on successful completion
    // This is normal behavior - FFmpeg completes the work, then WebAssembly terminates it
    // Check if output file exists and has content before treating as error
    try {
      const outputData = await ffmpeg.readFile(outputFileName)
      if (outputData && outputData.length > 0) {
        console.log('FFmpeg completed successfully despite Aborted() message, output size:', outputData.length)
        await ffmpeg.deleteFile(inputFileName)
        await ffmpeg.deleteFile(outputFileName)
        return outputData as Uint8Array
      }
    } catch (readError) {
      // Output file doesn't exist or is empty, continue to fallback
    }
    
    // If error message contains "Aborted" but we have output, it's a false positive
    const errorMsg = error?.message || error?.toString() || ''
    if (errorMsg.includes('Aborted') || errorMsg.includes('aborted')) {
      try {
        const outputData = await ffmpeg.readFile(outputFileName)
        if (outputData && outputData.length > 1000) { // At least 1KB of data
          console.log('FFmpeg Aborted() message ignored, output file exists with content:', outputData.length)
          await ffmpeg.deleteFile(inputFileName)
          await ffmpeg.deleteFile(outputFileName)
          return outputData as Uint8Array
        }
      } catch {
        // Ignore read errors
      }
    }
    
    // If extraction fails, try with even more lenient settings
    console.warn('First extraction attempt failed, trying with more lenient settings:', error)
    
    // Try with copy codec first (much faster and works if format is compatible)
    const fallbackArgs = [
      '-i', inputFileName,
      '-vn',
      '-acodec', 'copy', // Try copying first (no re-encoding)
      '-fflags', '+genpts',
      '-err_detect', 'ignore_err',
      '-avoid_negative_ts', 'make_zero',
      outputFileName,
    ]
    
    try {
      await ffmpeg.exec(fallbackArgs)
    } catch (copyError) {
      console.warn('Copy codec failed, re-encoding:', copyError)
      // Final fallback: re-encode with all error handling flags
      const finalArgs = [
        '-i', inputFileName,
        '-vn',
        '-acodec', audioFormat === 'mp3' ? 'libmp3lame' : 'aac',
        '-ab', audioBitrate,
        '-fflags', '+genpts+igndts', // Generate PTS and ignore DTS
        '-err_detect', 'ignore_err',
        '-avoid_negative_ts', 'make_zero',
        '-f', audioFormat === 'mp3' ? 'mp3' : 'adts', // Force output format
        outputFileName,
      ]
      
      await ffmpeg.exec(finalArgs)
    }
  }

  const data = await ffmpeg.readFile(outputFileName)
  
  // Validate output data
  if (!data || data.length === 0) {
    throw new Error('FFmpeg extraction produced empty output file')
  }
  
  await ffmpeg.deleteFile(inputFileName)
  await ffmpeg.deleteFile(outputFileName)

  return data as Uint8Array
}

export async function extractAudioTrack(
  videoData: Uint8Array,
  videoFormat: string,
  audioTrackIndex: number,
  audioFormat: string = 'mp3',
  onProgress?: (progress: number) => void
): Promise<Uint8Array> {
  const ffmpeg = await loadFFmpeg()

  const inputFileName = `input.${videoFormat}`
  const outputFileName = `output.${audioFormat}`

  await ffmpeg.writeFile(inputFileName, videoData)

  ffmpeg.on('progress', ({ progress }) => {
    if (onProgress) {
      onProgress(progress * 100)
    }
  })

  await ffmpeg.exec([
    '-i', inputFileName,
    '-map', `0:a:${audioTrackIndex}`,
    '-acodec', audioFormat === 'mp3' ? 'libmp3lame' : 'aac',
    outputFileName,
  ])

  const data = await ffmpeg.readFile(outputFileName)
  await ffmpeg.deleteFile(inputFileName)
  await ffmpeg.deleteFile(outputFileName)

  return data as Uint8Array
}

export async function mergeVideoAndAudio(
  videoData: Uint8Array,
  videoFormat: string,
  audioData: Uint8Array,
  audioFormat: string,
  outputFormat: string = 'mp4',
  onProgress?: (progress: number) => void,
  targetHeight?: number // Optional: upscale to this resolution (e.g., 720 for 720p)
): Promise<Uint8Array> {
  const ffmpeg = await loadFFmpeg()

  const videoFileName = `video.${videoFormat}`
  const audioFileName = `audio.${audioFormat}`
  const outputFileName = `output.${outputFormat}`

  await ffmpeg.writeFile(videoFileName, videoData)
  await ffmpeg.writeFile(audioFileName, audioData)

  ffmpeg.on('progress', ({ progress }) => {
    if (onProgress) {
      onProgress(progress * 100)
    }
  })

  // CRITICAL OPTIMIZATION: Avoid unnecessary transcoding - use copy codec when possible
  // WebM (VP9) -> MP4 (H.264) transcoding is EXTREMELY slow in browser WebAssembly
  // Strategy: Use copy codec when container formats match, only re-encode when absolutely necessary
  
  const isWebmVideo = videoFormat === 'webm'
  const isMp4Output = outputFormat === 'mp4' || outputFormat === 'mov'
  const isWebmOutput = outputFormat === 'webm'
  
  // Determine if we can copy codecs (fastest - no re-encoding)
  const canCopyVideo = (videoFormat === outputFormat) || (isWebmVideo && isWebmOutput)
  const canCopyAudio = (audioFormat === outputFormat) || 
                       (audioFormat === 'm4a' && isMp4Output) ||
                       (audioFormat === 'opus' && isWebmOutput) ||
                       (audioFormat === 'mp4' && isMp4Output)
  
  let videoCodec = 'copy'
  let audioCodec = 'copy'
  
  // Only re-encode video if container formats don't match
  if (!canCopyVideo) {
    // Format mismatch - must re-encode (WARNING: This is SLOW for VP9->H.264)
    if (outputFormat === 'webm') {
      videoCodec = 'libvpx-vp9'
      audioCodec = 'libopus'
    } else if (outputFormat === 'avi' || outputFormat === 'flv') {
      videoCodec = 'libx264'
      audioCodec = 'libmp3lame'
    } else {
      // mp4, mov, mkv - use H.264
      videoCodec = 'libx264'
      audioCodec = 'aac'
    }
  } else {
    // Video can be copied - only re-encode audio if needed
    if (!canCopyAudio) {
      if (isWebmOutput) {
        audioCodec = 'libopus'
      } else if (outputFormat === 'avi' || outputFormat === 'flv') {
        audioCodec = 'libmp3lame'
      } else {
        audioCodec = 'aac'
      }
    }
  }

  // Build FFmpeg arguments
  const args = [
    '-i', videoFileName,
    '-i', audioFileName,
  ]
  
  // Add upscaling if target height is specified and we're transcoding
  // Note: Upscaling requires re-encoding, so we must set videoCodec appropriately
  if (targetHeight && targetHeight > 0) {
    // Force video re-encoding for upscaling (can't use copy codec)
    if (videoCodec === 'copy') {
      videoCodec = outputFormat === 'webm' ? 'libvpx-vp9' : 'libx264'
    }
    // Scale to target height, maintaining aspect ratio
    // scale=-2:height means width is automatically calculated to maintain aspect ratio
    args.push('-vf', `scale=-2:${targetHeight}`)
    console.log(`[FFmpeg] Upscaling video to ${targetHeight}p`)
  }
  
  args.push('-c:v', videoCodec)
  args.push('-c:a', audioCodec)
  args.push('-shortest')
  
  // Add encoding optimizations only when transcoding is unavoidable
  if (videoCodec !== 'copy') {
    // Use ultrafast preset for maximum speed (trades quality for speed)
    args.push('-preset', 'ultrafast')
    args.push('-crf', '28') // Higher CRF = lower quality but much faster encoding
    args.push('-threads', '1') // Single thread for better WebAssembly compatibility
    args.push('-movflags', '+faststart') // Enable fast start for web playback
  }
  
  if (audioCodec !== 'copy') {
    // Use faster audio encoding
    args.push('-b:a', '192k')
  }
  
  // CRITICAL: Add error handling flags to prevent abort on minor issues
  args.push('-fflags', '+genpts') // Generate PTS if missing
  args.push('-err_detect', 'ignore_err') // Ignore parsing errors
  args.push('-avoid_negative_ts', 'make_zero') // Handle negative timestamps
  
  args.push(outputFileName)

  try {
    await ffmpeg.exec(args)
  } catch (error: any) {
    console.error('FFmpeg merge error:', error)
    
    // FFmpeg WebAssembly sometimes reports "Aborted()" even on successful completion
    // This is normal behavior - FFmpeg completes the work, then WebAssembly terminates it
    // Check if output file exists and has content before treating as error
    try {
      const outputData = await ffmpeg.readFile(outputFileName)
      if (outputData && outputData.length > 0) {
        console.log('FFmpeg merge completed successfully despite Aborted() message, file size:', outputData.length)
        await ffmpeg.deleteFile(videoFileName)
        await ffmpeg.deleteFile(audioFileName)
        await ffmpeg.deleteFile(outputFileName)
        return outputData as Uint8Array
      }
    } catch (readError) {
      console.error('Failed to read output file:', readError)
    }
    
    // If error message contains "Aborted" but we have output, it's a false positive
    const errorMsg = error?.message || error?.toString() || ''
    if (errorMsg.includes('Aborted') || errorMsg.includes('aborted')) {
      try {
        const outputData = await ffmpeg.readFile(outputFileName)
        if (outputData && outputData.length > 1000) { // At least 1KB of data
          console.log('FFmpeg Aborted() message ignored, output file exists with content:', outputData.length)
          await ffmpeg.deleteFile(videoFileName)
          await ffmpeg.deleteFile(audioFileName)
          await ffmpeg.deleteFile(outputFileName)
          return outputData as Uint8Array
        }
      } catch {
        // Ignore read errors
      }
    }
    
    throw error
  }

  const data = await ffmpeg.readFile(outputFileName)
  
  // Validate output data
  if (!data || data.length === 0) {
    throw new Error('FFmpeg merge produced empty output file')
  }
  
  await ffmpeg.deleteFile(videoFileName)
  await ffmpeg.deleteFile(audioFileName)
  await ffmpeg.deleteFile(outputFileName)

  return data as Uint8Array
}

export async function extractVideoOnly(
  videoData: Uint8Array,
  videoFormat: string,
  onProgress?: (progress: number) => void
): Promise<Uint8Array> {
  const ffmpeg = await loadFFmpeg()

  const inputFileName = `input.${videoFormat}`
  const outputFileName = `output.${videoFormat}`

  await ffmpeg.writeFile(inputFileName, videoData)

  ffmpeg.on('progress', ({ progress }) => {
    if (onProgress) {
      onProgress(progress * 100)
    }
  })

  // Strip audio using copy codec (no re-encoding, very fast)
  await ffmpeg.exec([
    '-i', inputFileName,
    '-c:v', 'copy',  // Copy video codec (no re-encoding)
    '-an',           // Remove audio
    outputFileName,
  ])

  const data = await ffmpeg.readFile(outputFileName)
  await ffmpeg.deleteFile(inputFileName)
  await ffmpeg.deleteFile(outputFileName)

  return data as Uint8Array
}

export async function convertVideoToResolution(
  videoData: Uint8Array,
  videoFormat: string,
  targetHeight: number,
  outputFormat: string = 'mp4',
  onProgress?: (progress: number) => void
): Promise<Uint8Array> {
  const ffmpeg = await loadFFmpeg()

  const inputFileName = `input.${videoFormat}`
  const outputFileName = `output.${outputFormat}`

  await ffmpeg.writeFile(inputFileName, videoData)

  ffmpeg.on('progress', ({ progress }) => {
    if (onProgress) {
      onProgress(progress * 100)
    }
  })

  // Scale video to target height, maintaining aspect ratio
  // Using scale filter: scale=-2:height (width calculated automatically)
  await ffmpeg.exec([
    '-i', inputFileName,
    '-vf', `scale=-2:${targetHeight}`,
    '-c:v', 'libx264',
    '-crf', '23', // Good quality balance
    '-preset', 'medium',
    '-c:a', 'aac',
    '-b:a', '192k',
    outputFileName,
  ])

  const data = await ffmpeg.readFile(outputFileName)
  await ffmpeg.deleteFile(inputFileName)
  await ffmpeg.deleteFile(outputFileName)

  return data as Uint8Array
}

export async function burnSubtitlesIntoVideo(
  videoData: Uint8Array,
  videoFormat: string,
  subtitleText: string,
  outputFormat: string = 'mp4',
  onProgress?: (progress: number) => void
): Promise<Uint8Array> {
  const ffmpeg = await loadFFmpeg()

  const videoFileName = `video.${videoFormat}`
  const subtitleFileName = `subtitles.vtt`
  const outputFileName = `output.${outputFormat}`

  await ffmpeg.writeFile(videoFileName, videoData)
  await ffmpeg.writeFile(subtitleFileName, new TextEncoder().encode(subtitleText))

  ffmpeg.on('progress', ({ progress }) => {
    if (onProgress) {
      onProgress(progress * 100)
    }
  })

  // Burn subtitles into video using subtitles filter
  await ffmpeg.exec([
    '-i', videoFileName,
    '-vf', `subtitles=${subtitleFileName}:force_style='FontSize=20,PrimaryColour=&Hffffff,OutlineColour=&H000000,Outline=2'`,
    '-c:a', 'copy',
    outputFileName,
  ])

  const data = await ffmpeg.readFile(outputFileName)
  await ffmpeg.deleteFile(videoFileName)
  await ffmpeg.deleteFile(subtitleFileName)
  await ffmpeg.deleteFile(outputFileName)

  return data as Uint8Array
}
