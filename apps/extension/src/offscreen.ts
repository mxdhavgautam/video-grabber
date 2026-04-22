import { FFmpeg, FFFSType } from "@ffmpeg/ffmpeg";
import { ERROR_CODES } from "./shared/errors";
import { getOpfsFileHandle } from "./runtime/opfs";

let ffmpegSingle: FFmpeg | null = null;
let ffmpegMulti: FFmpeg | null = null;
let activeLoad: Promise<FFmpeg> | null = null;
const activeBlobUrls = new Set<string>();

async function loadWithHardTimeout(ffmpeg: FFmpeg, config: any, timeoutMs: number): Promise<void> {
  let timer: any;
  const timeout = new Promise<void>((_resolve, reject) => {
    timer = setTimeout(() => {
      try {
        ffmpeg.terminate();
      } catch {
        // ignore
      }
      reject(new Error(`ffmpeg.load timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    await Promise.race([ffmpeg.load(config as any) as any, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function probeCoreAssets(
  mode: "core-mt" | "core-st",
  loadConfig: { coreURL: string; wasmURL: string; workerURL?: string }
): Promise<Record<string, unknown>> {
  const probes: Array<{ name: string; url: string; init?: RequestInit }> = [
    { name: "coreURL", url: loadConfig.coreURL },
    { name: "wasmURL", url: loadConfig.wasmURL, init: { headers: { Range: "bytes=0-0" } } },
  ];
  if (mode === "core-mt" && loadConfig.workerURL) {
    probes.push({ name: "workerURL", url: loadConfig.workerURL });
  }

  const results: Record<string, unknown> = { mode };
  for (const probe of probes) {
    try {
      const response = await fetch(probe.url, probe.init);
      results[probe.name] = { ok: response.ok, status: response.status };
    } catch (error: any) {
      results[probe.name] = { ok: false, error: String(error?.message ?? error) };
    }
  }
  return results;
}

async function loadFfmpeg(
  useMultiThread: boolean,
  log?: (stage: string, detail?: Record<string, unknown>) => Promise<void>
): Promise<FFmpeg> {
  if (useMultiThread && ffmpegMulti) {
    return ffmpegMulti;
  }
  if (!useMultiThread && ffmpegSingle) {
    return ffmpegSingle;
  }
  if (activeLoad) {
    return activeLoad;
  }

  activeLoad = (async () => {
    let ffmpeg = new FFmpeg();
    const wantsMt = useMultiThread && self.crossOriginIsolated;
    const tryModes = wantsMt ? ["core-mt", "core-st"] : ["core-st"];
    let lastErrorMessage = "";

    for (const mode of tryModes) {
      const coreBase = chrome.runtime.getURL(`vendor/ffmpeg/${mode}`);
      const loadConfig =
        mode === "core-mt"
          ? {
              coreURL: `${coreBase}/ffmpeg-core.js`,
              wasmURL: `${coreBase}/ffmpeg-core.wasm`,
              workerURL: `${coreBase}/ffmpeg-core.worker.js`,
            }
          : {
              coreURL: `${coreBase}/ffmpeg-core.js`,
              wasmURL: `${coreBase}/ffmpeg-core.wasm`,
            };

      try {
        await log?.("ffmpeg:load:attempt", { mode, coreBase });
        await log?.("ffmpeg:load:probe", (await probeCoreAssets(mode as any, loadConfig as any)) as any);
        // core-mt can occasionally hang on load depending on Chromium build/features.
        // Prefer it, but don't allow it to block the whole workflow.
        await loadWithHardTimeout(ffmpeg, loadConfig as any, mode === "core-mt" ? 20_000 : 60_000);
        if (mode === "core-mt") {
          ffmpegMulti = ffmpeg;
        } else {
          ffmpegSingle = ffmpeg;
        }
        await log?.("ffmpeg:load:success", { mode });
        return ffmpeg;
      } catch (error: any) {
        lastErrorMessage = String(error?.message ?? error ?? "Unknown ffmpeg.load error");
        await log?.("ffmpeg:load:failed", { mode, error: lastErrorMessage });
        ffmpeg.terminate();
        // Recreate a new instance for the next attempt.
        ffmpeg = new FFmpeg();
      }
    }

    throw new Error(`Failed to load ffmpeg.wasm runtime. ${lastErrorMessage ? `Last error: ${lastErrorMessage}` : ""}`);
  })();

  try {
    return await activeLoad;
  } finally {
    activeLoad = null;
  }
}

async function writeOpfs(path: string, bytes: Uint8Array): Promise<void> {
  const fileHandle = await getOpfsFileHandle(path, true);
  const writable = await fileHandle.createWritable({ keepExistingData: false });
  const chunk = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  await writable.write(new Blob([chunk]));
  await writable.close();
}

function createMuxLogger(requestId: string) {
  const startedAt = Date.now();
  let lastLine = "";

  const log = async (stage: string, detail?: Record<string, unknown>) => {
    const elapsedMs = Date.now() - startedAt;
    const payload = {
      requestId,
      stage,
      elapsedMs,
      detail: detail ?? {},
      line: lastLine,
    };
    // Best-effort; avoid throwing from logging paths.
    try {
      await chrome.runtime.sendMessage({ type: "MUX_LOG", requestId, payload });
    } catch {
      // ignore
    }
    // Keep some visibility in DevTools for the offscreen document.
    if (stage !== "progress") {
      // eslint-disable-next-line no-console
      console.log("[mux]", requestId, stage, payload.detail, `${elapsedMs}ms`, lastLine ? `line=${lastLine}` : "");
    }
  };

  const setLastLine = (value: string) => {
    lastLine = value.slice(0, 300);
  };

  return { log, setLastLine };
}

chrome.runtime.onMessage.addListener((message: any) => {
  if (message?.type === "REVOKE_BLOB_URL") {
    const url = String(message.url ?? "");
    if (url && activeBlobUrls.has(url)) {
      activeBlobUrls.delete(url);
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    return;
  }
  if (message?.type === "BLOB_URL_REQUEST") {
    const payload = message.payload as { requestId: string; opfsPath: string; mimeType?: string };
    if (!payload?.requestId || !payload?.opfsPath) {
      return;
    }
    void (async () => {
      const sendResult = async (response: any) => {
        try {
          await chrome.runtime.sendMessage({
            type: "BLOB_URL_RESULT",
            requestId: payload.requestId,
            payload: response,
          });
        } catch {
          // ignore
        }
      };

      try {
        const handle = await getOpfsFileHandle(payload.opfsPath, false);
        const file = await handle.getFile();
        const blob = payload.mimeType ? file.slice(0, file.size, payload.mimeType) : file;
        const blobUrl = URL.createObjectURL(blob);
        activeBlobUrls.add(blobUrl);
        await sendResult({ ok: true, requestId: payload.requestId, blobUrl });
      } catch (error: any) {
        await sendResult({
          ok: false,
          requestId: payload.requestId,
          error: {
            code: ERROR_CODES.MUX_FFMPEG_FAILURE,
            message: String(error?.message ?? error ?? "Failed to create blob URL from OPFS file."),
          },
        });
      }
    })();
    return;
  }
  if (!message || message.type !== "MUX_REQUEST") {
    return;
  }

  const payload = message.payload as {
    requestId: string;
    mode: "mux" | "strip-audio" | "transcode";
    videoPath: string;
    audioPath?: string;
    outputContainer: string;
    audioPreference: "high" | "low" | "none";
    transcodeVideo: boolean;
    transcodeAudio: boolean;
    stripAudio: boolean;
    useMultiThread: boolean;
    downloadFileName: string;
  };

  void (async () => {
    const muxLog = createMuxLogger(payload.requestId);
    let ffmpeg: FFmpeg | null = null;
    let inputMount = "";
    let outputName = "";
    let onLog: ((event: any) => void) | null = null;
    let onProgress: ((event: any) => void) | null = null;
    let resultSent = false;

    const sendResult = async (response: any) => {
      if (resultSent) return;
      resultSent = true;
      try {
        await chrome.runtime.sendMessage({
          type: "MUX_RESULT",
          requestId: payload.requestId,
          payload: response,
        });
      } catch {
        // ignore
      }
    };

    try {
      await muxLog.log("start", {
        crossOriginIsolated: Boolean(self.crossOriginIsolated),
        useMultiThreadRequested: payload.useMultiThread,
      });

      await muxLog.log("ffmpeg:load:start");
      ffmpeg = await loadFfmpeg(payload.useMultiThread, muxLog.log);
      await muxLog.log("ffmpeg:load:done", {
        loadedMode: ffmpegMulti === ffmpeg ? "core-mt" : "core-st",
      });

      inputMount = `/input-${payload.requestId}`;
      outputName = `mux-output-${payload.requestId}.${payload.outputContainer || "mp4"}`;

      onLog = (event: any) => {
        if (!event || typeof event.message !== "string") return;
        muxLog.setLastLine(event.message);
      };
      let lastProgress = -1;
      let lastProgressAt = 0;
      onProgress = (event: any) => {
        const progress = Number(event?.progress ?? -1);
        const now = Date.now();
        if (!Number.isFinite(progress) || progress < 0) {
          return;
        }
        if (progress - lastProgress < 0.05 && now - lastProgressAt < 2000) {
          return;
        }
        lastProgress = progress;
        lastProgressAt = now;
        void muxLog.log("progress", { progress, time: event?.time });
      };
      ffmpeg.on("log", onLog);
      ffmpeg.on("progress", onProgress);

      await muxLog.log("opfs:open-inputs");
      const videoHandle = await getOpfsFileHandle(payload.videoPath, false);
      const videoFile = await videoHandle.getFile();
      const files = [videoFile];

      let audioFile: File | undefined;
      const wantsAudio = payload.audioPreference !== "none" && !payload.stripAudio;
      if (payload.audioPath && wantsAudio) {
        const audioHandle = await getOpfsFileHandle(payload.audioPath, false);
        audioFile = await audioHandle.getFile();
        files.push(audioFile);
      }

      await muxLog.log("opfs:inputs-ready", {
        videoName: videoFile.name,
        videoBytes: videoFile.size,
        audioName: audioFile?.name ?? null,
        audioBytes: audioFile?.size ?? 0,
      });

      const projectedBytes = videoFile.size + (audioFile?.size ?? 0);
      if (projectedBytes > 1_800_000_000) {
        throw {
          code: ERROR_CODES.MUX_INPUT_TOO_LARGE,
          message: "Input exceeds current ffmpeg.wasm guardrail (approx 1.8GB).",
        };
      }

      await ffmpeg.createDir(inputMount).catch(() => undefined);
      await muxLog.log("ffmpeg:mount", { inputMount, files: files.map((f) => ({ name: f.name, size: f.size })) });
      await ffmpeg.mount(FFFSType.WORKERFS, { files }, inputMount);

      const videoInputPath = `${inputMount}/${videoFile.name}`;
      const cmd = ["-i", videoInputPath];
      if (payload.audioPath && wantsAudio) {
        const audioInputPath = `${inputMount}/${audioFile?.name ?? ""}`;
        cmd.push("-i", audioInputPath, "-map", "0:v:0", "-map", "1:a:0");
      }

      const out = String(payload.outputContainer || "mp4").toLowerCase();
      const wantsNoAudio = payload.audioPreference === "none" || payload.stripAudio || payload.mode === "strip-audio";

      if (payload.mode === "mux") {
        cmd.push("-c", "copy");
        if (wantsNoAudio) {
          cmd.push("-an");
        }
      } else if (payload.mode === "strip-audio") {
        cmd.push("-c:v", "copy", "-an");
      } else {
        // transcode (best-effort; prefer copy where possible)
        if (payload.transcodeVideo) {
          if (out === "webm") {
            cmd.push("-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32");
          } else {
            cmd.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20");
          }
        } else {
          cmd.push("-c:v", "copy");
        }

        if (wantsNoAudio) {
          cmd.push("-an");
        } else if (payload.transcodeAudio) {
          const high = payload.audioPreference !== "low";
          if (out === "webm") {
            cmd.push("-c:a", "libopus", "-b:a", high ? "160k" : "96k");
          } else {
            cmd.push("-c:a", "aac", "-b:a", high ? "192k" : "96k");
          }
        } else {
          cmd.push("-c:a", "copy");
        }
      }

      if (out === "mp4" || out === "mov") {
        cmd.push("-movflags", "+faststart");
      }

      cmd.push(outputName);

      await muxLog.log("ffmpeg:exec", { cmd });
      const exitCode = await ffmpeg.exec(cmd, 20 * 60_000);
      if (exitCode !== 0) {
        throw new Error(`ffmpeg exec failed (exit=${exitCode})`);
      }
      await muxLog.log("ffmpeg:exec-done");

      await muxLog.log("ffmpeg:read-output", { outputName });
      const outputBytes = (await ffmpeg.readFile(outputName)) as Uint8Array;
      await muxLog.log("ffmpeg:read-output-done", { outputBytes: outputBytes.byteLength });

      await muxLog.log("blob-url:create", { fileName: payload.downloadFileName });
      // Ensure we pass a plain ArrayBuffer to Blob to avoid TS complaints when the underlying buffer is a SharedArrayBuffer.
      const outputBuffer = outputBytes.buffer.slice(
        outputBytes.byteOffset,
        outputBytes.byteOffset + outputBytes.byteLength
      ) as ArrayBuffer;
      const blob = new Blob([outputBuffer], {
        type:
          payload.outputContainer?.toLowerCase() === "webm"
            ? "video/webm"
            : payload.outputContainer?.toLowerCase() === "mkv"
              ? "video/x-matroska"
              : "video/mp4",
      });
      const blobUrl = URL.createObjectURL(blob);
      activeBlobUrls.add(blobUrl);
      await muxLog.log("blob-url:created");

      await sendResult({
        ok: true,
        requestId: payload.requestId,
        blobUrl,
      });
    } catch (error: any) {
      const code = String(error?.code ?? ERROR_CODES.MUX_FFMPEG_FAILURE) as any;
      const message = String(error?.message ?? error ?? "Unknown ffmpeg.wasm failure");
      await muxLog.log("fatal", { message, stack: String(error?.stack ?? "") });
      await sendResult({
        ok: false,
        requestId: payload.requestId,
        error: {
          code,
          message,
        },
      });
    } finally {
      try {
        await muxLog.log("cleanup:start");
        if (ffmpeg && inputMount) {
          await ffmpeg.unmount(inputMount).catch(() => undefined);
          await ffmpeg.deleteDir(inputMount).catch(() => undefined);
        }
        if (ffmpeg && outputName) {
          await ffmpeg.deleteFile(outputName).catch(() => undefined);
        }
        if (ffmpeg && onLog) {
          ffmpeg.off("log", onLog);
        }
        if (ffmpeg && onProgress) {
          ffmpeg.off("progress", onProgress);
        }
      } finally {
        await muxLog.log("cleanup:done");
      }
    }
  })();
});
