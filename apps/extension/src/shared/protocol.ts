import type { RuntimeErrorPayload } from "./errors";

export type JobStatus =
  | "queued"
  | "extracting"
  | "downloading"
  | "muxing"
  | "complete"
  | "failed"
  | "cancelled";

export type AudioPreference = "high" | "low" | "none";

export interface DownloadPreferences {
  resolution: number; // height (e.g. 1080)
  container: string; // desired output container (e.g. mp4/webm)
  audio: AudioPreference;
}

export interface VideoStreamOption {
  itag: number;
  qualityLabel: string; // "1080p"
  container: string;
  mimeType: string;
  url: string;
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
  hasAudio: boolean; // true when the stream is progressive (video+audio)
  audioBitrate?: number;
  estimatedBytes?: number;
}

export interface AudioStreamOption {
  itag: number;
  container: string;
  mimeType: string;
  url: string;
  bitrate?: number;
  estimatedBytes?: number;
}

export interface ExtractionResult {
  title: string;
  channelName?: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  video: VideoStreamOption[];
  audio: AudioStreamOption[];
}

export interface JobProgress {
  phaseProgress: number;
  downloadedVideoBytes: number;
  downloadedAudioBytes: number;
  downloadedVideoTotalBytes: number;
  downloadedAudioTotalBytes: number;
}

export interface JobRecord {
  id: string;
  url: string;
  // Filled after extractor runs for this job.
  title: string;
  channelName?: string;
  thumbnailUrl?: string;
  createdAt: number;
  updatedAt: number;
  status: JobStatus;
  preferences: DownloadPreferences;
  plan?: {
    mode: "direct" | "mux" | "strip-audio" | "transcode";
    outputContainer: string;
    outputResolution: number;
    videoItag: number;
    videoUrl: string;
    videoContainer: string;
    videoHasAudio: boolean;
    audioItag?: number;
    audioUrl?: string;
    audioContainer?: string;
    transcodeVideo?: boolean;
    transcodeAudio?: boolean;
    stripAudio?: boolean;
  };
  outputFileName: string;
  tempVideoPath?: string;
  tempAudioPath?: string;
  downloadId?: number;
  error?: RuntimeErrorPayload;
  progress: JobProgress;
}

export interface StartJobRequest {
  url: string;
  preferences: DownloadPreferences;
}

export type RuntimeRequest =
  | { type: "EXTRACT_URL"; url: string }
  | { type: "START_JOB"; payload: StartJobRequest }
  | { type: "LIST_JOBS" }
  | { type: "RETRY_JOB"; jobId: string }
  | { type: "CANCEL_JOB"; jobId: string };

export type RuntimeResponse =
  | { ok: true; extraction: ExtractionResult }
  | { ok: true; jobs: JobRecord[] }
  | { ok: true; jobId: string }
  | { ok: false; error: RuntimeErrorPayload };

// Hard cutover: schema changed (multi-select format picker, job.plan).
export const JOB_STORAGE_KEY = "video_grabber.jobs.v3";
