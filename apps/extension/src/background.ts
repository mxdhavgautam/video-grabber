/// <reference lib="webworker" />

import { ERROR_CODES, type RuntimeErrorPayload } from "./shared/errors";
import type { ExtractionResult, JobRecord, RuntimeRequest, RuntimeResponse } from "./shared/protocol";
import { extractFormats } from "./runtime/extractor";
import { deleteOpfsFile, downloadToOpfs } from "./runtime/downloader";
import {
  deleteJobCheckpoint,
  loadJobsFromStorage,
  readJobCheckpoint,
  requestPersistentStorage,
  saveJobsToStorage,
  writeJobCheckpoint,
} from "./runtime/storage";
import { createBlobUrlInOffscreen, runMuxInOffscreen } from "./runtime/mux";

declare const self: ServiceWorkerGlobalScope;

let jobs: JobRecord[] = [];
let activeJobId: string | null = null;

// Helium (and some Chromium builds) may ignore the `filename` option for blob: downloads.
// Use `onDeterminingFilename` to force our deterministic output naming.
const pendingDownloadNameByUrl = new Map<string, { filename: string; createdAt: number }>();
const pendingDownloadNameQueue: Array<{ filename: string; createdAt: number }> = [];

try {
  chrome.downloads?.onDeterminingFilename?.addListener((item, suggest) => {
    try {
      const url = String((item as any)?.url ?? "");
      const isOurBlob =
        url.startsWith(`blob:chrome-extension://${chrome.runtime.id}/`) || url.startsWith(`blob:${chrome.runtime.getURL("")}`);

      // Prefer exact URL match if possible.
      const entry = url ? pendingDownloadNameByUrl.get(url) : undefined;
      const forced = entry?.filename
        ? entry.filename
        : isOurBlob && pendingDownloadNameQueue.length
          ? pendingDownloadNameQueue.shift()?.filename
          : "";

      if (forced) {
        if (url) pendingDownloadNameByUrl.delete(url);
        suggest({ filename: forced, conflictAction: "uniquify" });
        return;
      }
    } catch {
      // ignore
    }
    // Always call suggest() so the download doesn't stall.
    suggest();
  });
} catch {
  // ignore: best-effort; downloads still works without this hook.
}

// Omnibox shortcut: `vg` -> open extension UI. If user enters a URL after the keyword,
// pass it via hash so the UI can prefill the input.
try {
  chrome.omnibox?.onInputEntered?.addListener((text) => {
    const raw = String(text ?? "").trim();
    const base = chrome.runtime.getURL("index.html");
    let target = base;
    if (raw) {
      target = `${base}#url=${encodeURIComponent(raw)}`;
    }
    void (async () => {
      const existing = await chrome.tabs
        .query({ url: base })
        .catch(() => [] as chrome.tabs.Tab[]);
      const tabId = existing?.[0]?.id;
      if (typeof tabId === "number") {
        await chrome.tabs.update(tabId, { active: true, url: target }).catch(() => undefined);
        return;
      }
      await chrome.tabs.create({ url: target }).catch(() => undefined);
    })();
  });
} catch {
  // ignore
}

function randomId(prefix: string): string {
  const entropy = crypto.getRandomValues(new Uint32Array(1))[0].toString(16);
  return `${prefix}_${Date.now()}_${entropy}`;
}

const PROJECT_TAG = "Video-Grabber";

function tokenize(raw: string): string[] {
  return String(raw ?? "").match(/[a-zA-Z0-9]+/g) ?? [];
}

function formatTitleToken(token: string): string {
  if (!token) return "";
  if (/^\d+$/.test(token)) return token;
  // Preserve acronyms and pre-camelcased words (e.g. TypeScript).
  if (token === token.toUpperCase() && token.length <= 6) return token;
  if (/[A-Z]/.test(token.slice(1))) return token;
  return token[0].toUpperCase() + token.slice(1).toLowerCase();
}

function formatChannelToken(token: string): string {
  if (!token) return "";
  // Keep short lowercase tokens (e.g. "gg") and tokens with digits (e.g. "t3", "2D") as-is.
  if (/\d/.test(token)) return token;
  if (token === token.toLowerCase() && token.length <= 3) return token;
  return token[0].toUpperCase() + token.slice(1).toLowerCase();
}

function formatNiceId(raw: string, kind: "title" | "channel"): string {
  const tokens = tokenize(raw);
  const formatted = tokens
    .slice(0, kind === "title" ? 16 : 10)
    .map((t) => (kind === "title" ? formatTitleToken(t) : formatChannelToken(t)))
    .join("");
  return formatted.slice(0, 100);
}

function sanitizeResolution(raw: string): string {
  const s = String(raw ?? "").replace(/\s+/g, "");
  const m = s.match(/(\d{3,4}p)/i);
  return (m?.[1] ?? s.replace(/[^a-zA-Z0-9]+/g, "").slice(0, 16) ?? "").toLowerCase() || "1080p";
}

function buildOutputFileName(input: {
  title: string;
  channelName?: string;
  resolution: number;
  container?: string;
}): string {
  const title = formatNiceId(input.title, "title") || "Video";
  const channel = formatNiceId(input.channelName || "", "channel") || "UnknownChannel";
  const resolution = `${Math.max(0, Math.floor(Number(input.resolution) || 0)) || 1080}p`;
  const ext = String(input.container || "mp4")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 8) || "mp4";
  return `${title}-${channel}_${resolution}[${PROJECT_TAG}].${ext}`;
}

function extForVideoContainer(container: string): string {
  const c = String(container || "").toLowerCase();
  if (c === "mp4" || c === "mov" || c === "mkv" || c === "webm") return c;
  return "bin";
}

function extForAudioContainer(container: string): string {
  const c = String(container || "").toLowerCase();
  if (c === "mp4") return "m4a";
  if (c === "webm") return "webm";
  return "bin";
}

function mimeTypeForContainer(container: string): string {
  const c = String(container || "").toLowerCase();
  if (c === "webm") return "video/webm";
  if (c === "mkv") return "video/x-matroska";
  if (c === "mov") return "video/quicktime";
  return "video/mp4";
}

function parseHeightFromLabel(label: string): number {
  const m = String(label || "").match(/(\d{3,4})p/i);
  return m ? Number(m[1]) : 0;
}

function choosePlan(extraction: ExtractionResult, preferences: JobRecord["preferences"]): NonNullable<JobRecord["plan"]> {
  const outputContainer = String(preferences.container || "mp4").toLowerCase();
  const targetHeight = Math.max(0, Math.floor(Number(preferences.resolution) || 0));
  const audioPref = preferences.audio;

  const heightOf = (v: ExtractionResult["video"][number]) => Number(v.height || 0) || parseHeightFromLabel(v.qualityLabel);

  const byQuality = extraction.video
    .filter((v) => Boolean(v.url))
    .filter((v) => !targetHeight || heightOf(v) === targetHeight);

  const byContainer = byQuality.filter((v) => String(v.container || "").toLowerCase() === outputContainer);
  const candidates = (byContainer.length ? byContainer : byQuality.length ? byQuality : extraction.video).slice();
  candidates.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  const preferAdaptive = candidates.find((v) => !v.hasAudio);
  const chosenVideo = preferAdaptive ?? candidates[0];
  if (!chosenVideo?.url) {
    throw {
      code: ERROR_CODES.EXTRACTOR_NO_FORMATS,
      message: "No usable video stream URL found for the selected resolution/container.",
    } satisfies RuntimeErrorPayload;
  }

  let chosenAudio: ExtractionResult["audio"][number] | undefined;
  if (audioPref !== "none") {
    const audioCandidates = extraction.audio.filter((a) => Boolean(a.url)).slice();
    if (!audioCandidates.length) {
      throw {
        code: ERROR_CODES.EXTRACTOR_NO_FORMATS,
        message: "No usable audio stream URLs were returned.",
      } satisfies RuntimeErrorPayload;
    }

    const preferredAudioContainer = outputContainer === "webm" ? "webm" : outputContainer === "mp4" ? "mp4" : "";
    const preferred = preferredAudioContainer
      ? audioCandidates.filter((a) => String(a.container || "").toLowerCase() === preferredAudioContainer)
      : [];
    const pool = preferred.length ? preferred : audioCandidates;

    pool.sort((a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0));
    chosenAudio = audioPref === "low" ? pool[0] : pool[pool.length - 1];
  }

  const videoContainer = String(chosenVideo.container || "").toLowerCase() || outputContainer;
  const videoHasAudio = Boolean(chosenVideo.hasAudio);
  const videoHeight = heightOf(chosenVideo) || targetHeight || 0;

  let mode: NonNullable<JobRecord["plan"]>["mode"] = "direct";
  let stripAudio = false;
  if (videoHasAudio) {
    if (audioPref === "none") {
      mode = "strip-audio";
      stripAudio = true;
    } else {
      mode = "direct";
    }
  } else {
    mode = audioPref === "none" ? "direct" : "mux";
  }

  const audioContainer = chosenAudio ? String(chosenAudio.container || "").toLowerCase() : undefined;
  const transcodeVideo = videoContainer !== outputContainer;
  const transcodeAudio = Boolean(chosenAudio && audioContainer && audioContainer !== outputContainer && outputContainer !== "mkv");

  if (mode === "direct" && transcodeVideo) {
    mode = "transcode";
  }
  if (mode === "mux" && (transcodeVideo || transcodeAudio)) {
    mode = "transcode";
  }

  return {
    mode,
    outputContainer,
    outputResolution: videoHeight || targetHeight || 0,
    videoItag: Number(chosenVideo.itag || 0) || 0,
    videoUrl: chosenVideo.url,
    videoContainer,
    videoHasAudio,
    audioItag: chosenAudio ? Number(chosenAudio.itag || 0) || 0 : undefined,
    audioUrl: chosenAudio?.url,
    audioContainer,
    transcodeVideo: transcodeVideo || undefined,
    transcodeAudio: transcodeAudio || undefined,
    stripAudio: stripAudio || undefined,
  };
}

function sortJobsForUi(input: JobRecord[]): JobRecord[] {
  return [...input].sort((a, b) => b.createdAt - a.createdAt);
}

async function persistJobs(): Promise<void> {
  await saveJobsToStorage(jobs);
}

const TERMINAL_STATUSES = new Set(["complete", "failed", "cancelled"]);

async function persistCheckpointForJob(job: JobRecord): Promise<void> {
  if (TERMINAL_STATUSES.has(job.status)) {
    await deleteJobCheckpoint(job.id);
    return;
  }
  await writeJobCheckpoint(job);
}

function findJob(jobId: string): JobRecord | undefined {
  return jobs.find((job) => job.id === jobId);
}

function normalizeRuntimeError(error: unknown): RuntimeErrorPayload {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    return error as RuntimeErrorPayload;
  }
  const text = String((error as any)?.message ?? error ?? "Unknown error");
  if (text.includes("quota")) {
    return { code: ERROR_CODES.STORAGE_QUOTA_EXCEEDED, message: text };
  }
  return { code: ERROR_CODES.MUX_FFMPEG_FAILURE, message: text };
}

async function initializeJobs(): Promise<void> {
  await requestPersistentStorage();
  jobs = await loadJobsFromStorage();

  for (const [index, storedJob] of jobs.entries()) {
    const checkpoint = await readJobCheckpoint(storedJob.id);
    if (checkpoint && checkpoint.updatedAt > storedJob.updatedAt) {
      jobs[index] = checkpoint;
    }
  }

  // Service workers are ephemeral; recover in-flight states deterministically.
  for (const job of jobs) {
    if (job.status === "extracting" || job.status === "downloading" || job.status === "muxing") {
      job.status = "queued";
      job.error = {
        code: ERROR_CODES.WORKER_TERMINATED_RECOVERED,
        message: "Recovered after worker restart; queued for resume.",
      };
      job.updatedAt = Date.now();
    }
  }
  await persistJobs();

  for (const job of jobs) {
    if (job.status === "queued") {
      void enqueueJob(job.id);
    }
  }
}

async function updateJob(jobId: string, mutate: (job: JobRecord) => void): Promise<void> {
  const job = findJob(jobId);
  if (!job) {
    return;
  }
  mutate(job);
  job.updatedAt = Date.now();
  await persistJobs();
  await persistCheckpointForJob(job);
}

async function enqueueJob(jobId: string): Promise<void> {
  if (activeJobId) {
    return;
  }
  activeJobId = jobId;
  try {
    await runJob(jobId);
  } finally {
    activeJobId = null;
    const next = jobs.find((candidate) => candidate.status === "queued");
    if (next) {
      void enqueueJob(next.id);
    }
  }
}

async function runJob(jobId: string): Promise<void> {
  const job = findJob(jobId);
  if (!job || job.status === "cancelled") {
    return;
  }

  try {
    // Plan + metadata stage (runs once per job attempt).
    if (!job.plan) {
      await updateJob(jobId, (j) => {
        j.status = "extracting";
        j.error = undefined;
        j.progress.phaseProgress = 0;
      });

      const extraction = await extractOnly(job.url);
      const plan = choosePlan(extraction, job.preferences);

      const outputFileName = buildOutputFileName({
        title: extraction.title,
        channelName: extraction.channelName,
        resolution: plan.outputResolution || job.preferences.resolution,
        container: plan.outputContainer,
      });

      await updateJob(jobId, (j) => {
        j.title = extraction.title;
        j.channelName = extraction.channelName;
        j.thumbnailUrl = extraction.thumbnailUrl;
        j.plan = plan;
        j.outputFileName = outputFileName;
        j.status = "downloading";
        j.downloadId = undefined;
        j.progress = {
          phaseProgress: 0,
          downloadedVideoBytes: 0,
          downloadedAudioBytes: 0,
          downloadedVideoTotalBytes: 0,
          downloadedAudioTotalBytes: 0,
        };
        j.tempVideoPath = `tmp/${j.id}.video.${extForVideoContainer(plan.videoContainer)}`;
        j.tempAudioPath = plan.audioUrl ? `tmp/${j.id}.audio.${extForAudioContainer(plan.audioContainer || "")}` : undefined;
      });
    }

    const latest = findJob(jobId);
    if (!latest?.plan) {
      return;
    }

    const plan = latest.plan;
    if (!plan.videoUrl) {
      throw {
        code: ERROR_CODES.EXTRACTOR_NO_FORMATS,
        message: "No primary stream URL available for selected download selection.",
      } satisfies RuntimeErrorPayload;
    }

    await downloadToOpfs(plan.videoUrl, latest.tempVideoPath!, {
      startAt: latest.progress.downloadedVideoBytes,
      onProgress: async (downloadedBytes, totalBytes) => {
        await updateJob(jobId, (j) => {
          j.progress.downloadedVideoBytes = downloadedBytes;
          j.progress.downloadedVideoTotalBytes = totalBytes;
          const phase = totalBytes ? downloadedBytes / totalBytes : 0;
          j.progress.phaseProgress = Math.min(0.6, phase * 0.6);
        });
      },
    });

    if (plan.audioUrl && latest.tempAudioPath) {
      await downloadToOpfs(plan.audioUrl, latest.tempAudioPath, {
        startAt: latest.progress.downloadedAudioBytes,
        onProgress: async (downloadedBytes, totalBytes) => {
          await updateJob(jobId, (j) => {
            j.progress.downloadedAudioBytes = downloadedBytes;
            j.progress.downloadedAudioTotalBytes = totalBytes;
            const phase = totalBytes ? downloadedBytes / totalBytes : 0;
            j.progress.phaseProgress = 0.6 + Math.min(0.2, phase * 0.2);
          });
        },
      });
    }

    const requiresFfmpeg = plan.mode !== "direct";
    if (requiresFfmpeg) {
      await updateJob(jobId, (j) => {
        j.status = "muxing";
        j.progress.phaseProgress = 0.8;
      });
    }

    if (requiresFfmpeg) {
      const muxMode = plan.mode === "direct" ? "mux" : plan.mode;
      const muxResponse = await runMuxInOffscreen({
        requestId: randomId("mux"),
        mode: muxMode,
        videoPath: latest.tempVideoPath!,
        audioPath: plan.audioUrl && latest.tempAudioPath ? latest.tempAudioPath : undefined,
        outputContainer: plan.outputContainer,
        audioPreference: latest.preferences.audio,
        transcodeVideo: Boolean(plan.transcodeVideo),
        transcodeAudio: Boolean(plan.transcodeAudio),
        stripAudio: Boolean(plan.stripAudio),
        useMultiThread: true,
        downloadFileName: latest.outputFileName,
      });

      if (!muxResponse.ok || !muxResponse.blobUrl) {
        throw muxResponse.error ?? {
          code: ERROR_CODES.MUX_FFMPEG_FAILURE,
          message: "Offscreen muxing failed.",
        };
      }

      const muxBlobUrl = muxResponse.blobUrl;
      pendingDownloadNameByUrl.set(muxBlobUrl, { filename: latest.outputFileName, createdAt: Date.now() });
      pendingDownloadNameQueue.push({ filename: latest.outputFileName, createdAt: Date.now() });
      setTimeout(() => pendingDownloadNameByUrl.delete(muxBlobUrl), 2 * 60_000);

      const downloadId = await chrome.downloads.download({
        url: muxBlobUrl,
        filename: latest.outputFileName,
        conflictAction: "uniquify",
        saveAs: true,
      });

      setTimeout(() => {
        void chrome.runtime.sendMessage({ type: "REVOKE_BLOB_URL", url: muxBlobUrl }).catch(() => undefined);
      }, 120_000);

      await updateJob(jobId, (j) => {
        j.status = "complete";
        j.downloadId = downloadId;
        j.progress.phaseProgress = 1;
      });
    } else {
      const blobResult = await createBlobUrlInOffscreen({
        requestId: randomId("blob"),
        opfsPath: latest.tempVideoPath!,
        mimeType: mimeTypeForContainer(plan.outputContainer),
      });
      if (!blobResult.ok || !blobResult.blobUrl) {
        throw blobResult.error ?? {
          code: ERROR_CODES.MUX_FFMPEG_FAILURE,
          message: "Failed to prepare download payload.",
        };
      }

      const blobUrl = blobResult.blobUrl;
      pendingDownloadNameByUrl.set(blobUrl, { filename: latest.outputFileName, createdAt: Date.now() });
      pendingDownloadNameQueue.push({ filename: latest.outputFileName, createdAt: Date.now() });
      setTimeout(() => pendingDownloadNameByUrl.delete(blobUrl), 2 * 60_000);

      const downloadId = await chrome.downloads.download({
        url: blobUrl,
        filename: latest.outputFileName,
        conflictAction: "uniquify",
        saveAs: true,
      });

      setTimeout(() => {
        void chrome.runtime.sendMessage({ type: "REVOKE_BLOB_URL", url: blobUrl }).catch(() => undefined);
      }, 120_000);

      await updateJob(jobId, (j) => {
        j.status = "complete";
        j.downloadId = downloadId;
        j.progress.phaseProgress = 1;
      });
    }

    await deleteOpfsFile(latest.tempVideoPath!);
    if (latest.tempAudioPath) {
      await deleteOpfsFile(latest.tempAudioPath);
    }
    await deleteJobCheckpoint(jobId);
  } catch (error) {
    const normalized = normalizeRuntimeError(error);
    await updateJob(jobId, (j) => {
      j.status = "failed";
      j.error = normalized;
    });
  }
}

function toErrorResponse(error: unknown): RuntimeResponse {
  return { ok: false, error: normalizeRuntimeError(error) };
}

async function extractOnly(url: string): Promise<ExtractionResult> {
  return extractFormats(url);
}

async function handleRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  switch (request.type) {
    case "EXTRACT_URL": {
      const extraction = await extractOnly(request.url);
      return { ok: true, extraction };
    }

    case "LIST_JOBS":
      return { ok: true, jobs: sortJobsForUi(jobs) };

    case "START_JOB": {
      const payload = request.payload;
      const job: JobRecord = {
        id: randomId("job"),
        url: payload.url,
        title: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: "queued",
        preferences: payload.preferences,
        outputFileName: "pending",
        progress: {
          phaseProgress: 0,
          downloadedVideoBytes: 0,
          downloadedAudioBytes: 0,
          downloadedVideoTotalBytes: 0,
          downloadedAudioTotalBytes: 0,
        },
      };
      jobs.push(job);
      await persistJobs();
      if (!activeJobId) {
        void enqueueJob(job.id);
      }
      return { ok: true, jobId: job.id };
    }

    case "RETRY_JOB": {
      const job = findJob(request.jobId);
      if (!job) {
        return toErrorResponse({
          code: ERROR_CODES.STATE_CORRUPTED,
          message: "Retry target job was not found.",
        });
      }
      await updateJob(job.id, (j) => {
        j.status = "queued";
        j.error = undefined;
        j.plan = undefined;
        j.downloadId = undefined;
        j.tempVideoPath = undefined;
        j.tempAudioPath = undefined;
        j.progress = {
          phaseProgress: 0,
          downloadedVideoBytes: 0,
          downloadedAudioBytes: 0,
          downloadedVideoTotalBytes: 0,
          downloadedAudioTotalBytes: 0,
        };
      });
      if (!activeJobId) {
        void enqueueJob(job.id);
      }
      return { ok: true, jobId: job.id };
    }

    case "CANCEL_JOB": {
      const job = findJob(request.jobId);
      if (!job) {
        return toErrorResponse({
          code: ERROR_CODES.STATE_CORRUPTED,
          message: "Cancel target job was not found.",
        });
      }
      await updateJob(job.id, (j) => {
        j.status = "cancelled";
      });
      await deleteJobCheckpoint(job.id);
      await Promise.all([
        job.tempVideoPath ? deleteOpfsFile(job.tempVideoPath) : Promise.resolve(),
        job.tempAudioPath ? deleteOpfsFile(job.tempAudioPath) : Promise.resolve(),
      ]);
      return { ok: true, jobId: job.id };
    }
  }
}

chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
  // Mux diagnostics from the offscreen document.
  if (message?.type === "MUX_LOG") {
    try {
      // eslint-disable-next-line no-console
      console.log("[mux]", message.requestId, message.payload?.stage, message.payload?.detail ?? {});
    } catch {
      // ignore
    }
    sendResponse({ ok: true });
    return false;
  }

  const request = message as RuntimeRequest;
  void handleRequest(request)
    .then(sendResponse)
    .catch((error) => sendResponse(toErrorResponse(error)));
  return true;
});

void initializeJobs();

self.addEventListener("install", () => {
  void self.skipWaiting();
});

self.addEventListener("activate", () => {
  void self.clients.claim();
});
