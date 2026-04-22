import { useEffect, useMemo, useState } from "react";
import type { AudioPreference, ExtractionResult, JobRecord, RuntimeRequest, RuntimeResponse } from "../shared/protocol";

async function sendRuntimeMessage(request: RuntimeRequest): Promise<RuntimeResponse> {
  if (!chrome?.runtime?.sendMessage) {
    throw new Error("chrome.runtime is unavailable in this environment.");
  }
  return chrome.runtime.sendMessage(request) as Promise<RuntimeResponse>;
}

export function App() {
  const [url, setUrl] = useState("");
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<number>(0);
  const [selectedContainer, setSelectedContainer] = useState<string>("mp4");
  const [selectedAudio, setSelectedAudio] = useState<AudioPreference>("high");
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outputSummary = (job: JobRecord): string => {
    const res = Number(job.plan?.outputResolution ?? job.preferences?.resolution ?? 0);
    const container = String(job.plan?.outputContainer ?? job.preferences?.container ?? "").toLowerCase();
    const audio = String(job.preferences?.audio ?? "");
    const audioLabel = audio === "none" ? "no audio" : audio === "low" ? "LQ audio" : "HQ audio";
    if (!res || !container) {
      return "out: planning";
    }
    if (audio === "none") {
      return `out: ${res}p ${container} (no audio)`;
    }
    return `out: ${res}p ${container} + ${audioLabel}`;
  };

  const modeLabel = (mode: any): string => {
    const m = String(mode || "");
    if (!m) return "planning";
    if (m === "direct") return "direct";
    if (m === "mux") return "mux";
    if (m === "strip-audio") return "strip-audio";
    if (m === "transcode") return "transcode";
    return m;
  };

  const availableResolutions = useMemo(() => {
    if (!extraction) return [];
    const heights = new Set<number>();
    for (const v of extraction.video) {
      if (v.height) heights.add(v.height);
      else {
        const m = String(v.qualityLabel || "").match(/(\d{3,4})p/i);
        if (m) heights.add(Number(m[1]));
      }
    }
    return Array.from(heights).filter(Boolean).sort((a, b) => b - a);
  }, [extraction]);

  const availableContainers = useMemo(() => {
    if (!extraction) return [];
    const containers = new Set<string>();
    for (const v of extraction.video) {
      const h = Number(v.height || 0) || Number(String(v.qualityLabel || "").match(/(\d{3,4})p/i)?.[1] || 0);
      if (selectedResolution && h !== selectedResolution) continue;
      const c = String(v.container || "").toLowerCase();
      if (c) containers.add(c);
    }
    const list = Array.from(containers);
    list.sort();
    return list;
  }, [extraction, selectedResolution]);

  const refreshJobs = async () => {
    try {
      const response = await sendRuntimeMessage({ type: "LIST_JOBS" });
      if (response.ok && "jobs" in response) {
        setJobs(response.jobs);
      }
    } catch {
      // Non-extension preview mode.
    }
  };

  useEffect(() => {
    // Allow omnibox shortcut to prefill the URL: `chrome-extension://.../index.html#url=<encoded>`
    try {
      const hash = String(window.location.hash || "");
      const m = hash.match(/(?:^#|&)url=([^&]+)/);
      if (m?.[1]) {
        const decoded = decodeURIComponent(m[1]);
        if (decoded && !url) {
          setUrl(decoded);
        }
      }
    } catch {
      // ignore
    }

    void refreshJobs();
    const timer = setInterval(() => {
      void refreshJobs();
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  const analyzeUrl = async () => {
    if (!url.trim()) {
      return;
    }
    setLoading(true);
    setError(null);
    setExtraction(null);
    setSelectedResolution(0);
    setSelectedContainer("mp4");
    setSelectedAudio("high");
    try {
      const response = await sendRuntimeMessage({ type: "EXTRACT_URL", url: url.trim() });
      if (!response.ok) {
        setError(`${response.error.code}: ${response.error.message}`);
        return;
      }
      if (!("extraction" in response)) {
        setError("Unexpected response payload while extracting URL.");
        return;
      }
      const result = response.extraction;
      setExtraction(result);
      const heights = Array.from(
        new Set(
          result.video
            .map((v) => Number(v.height || 0) || Number(String(v.qualityLabel || "").match(/(\d{3,4})p/i)?.[1] || 0))
            .filter(Boolean)
        )
      ).sort((a, b) => b - a);
      const defaultRes = heights[0] ?? 1080;
      setSelectedResolution(defaultRes);
      const containers = Array.from(
        new Set(
          result.video
            .filter((v) => {
              const h = Number(v.height || 0) || Number(String(v.qualityLabel || "").match(/(\d{3,4})p/i)?.[1] || 0);
              return h === defaultRes;
            })
            .map((v) => String(v.container || "").toLowerCase())
        )
      ).filter(Boolean);
      setSelectedContainer(containers.includes("mp4") ? "mp4" : containers[0] || "mp4");
    } catch (err: any) {
      setError(String(err?.message ?? err ?? "Failed to analyze URL"));
    } finally {
      setLoading(false);
    }
  };

  const startJob = async () => {
    if (!extraction || !selectedResolution || !selectedContainer) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await sendRuntimeMessage({
        type: "START_JOB",
        payload: {
          url: extraction.sourceUrl,
          preferences: {
            resolution: selectedResolution,
            container: selectedContainer,
            audio: selectedAudio,
          },
        },
      });
      if (!response.ok) {
        setError(`${response.error.code}: ${response.error.message}`);
      } else {
        await refreshJobs();
      }
    } catch (err: any) {
      setError(String(err?.message ?? err ?? "Failed to start job"));
    } finally {
      setLoading(false);
    }
  };

  const retryJob = async (jobId: string) => {
    await sendRuntimeMessage({ type: "RETRY_JOB", jobId });
    await refreshJobs();
  };

  const cancelJob = async (jobId: string) => {
    await sendRuntimeMessage({ type: "CANCEL_JOB", jobId });
    await refreshJobs();
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void analyzeUrl();
    }
  };

  return (
    <main className="app" id="main-content">
      <section className="panel" aria-labelledby="panel-heading">
        <h1 id="panel-heading">Video Grabber</h1>
        <p className="subtle">Client-only MV3 flow with resumable jobs and deterministic failures.</p>

        <label className="label" htmlFor="url-input">
          URL
        </label>
        <input
          id="url-input"
          className="input"
          type="url"
          inputMode="url"
          autoComplete="url"
          name="video-url"
          placeholder="https://youtube.com/watch?v=…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleUrlKeyDown}
          disabled={loading}
          aria-describedby={error ? "url-error" : undefined}
          aria-invalid={!!error}
        />

        <div className="row">
          <button
            className="button"
            type="button"
            onClick={() => void analyzeUrl()}
            disabled={loading || !url.trim()}
            aria-label={loading ? "Analyzing…" : "Analyze URL"}
          >
            {loading ? "Analyzing…" : "Analyze"}
          </button>
          <button
            className="button primary"
            type="button"
            onClick={() => void startJob()}
            disabled={loading || !selectedResolution || !selectedContainer}
            aria-label="Start download job"
          >
            Start Job
          </button>
        </div>

        {extraction && (
          <div className="block">
            <div className="extractHeader">
              {extraction.thumbnailUrl && (
                <img
                  className="thumb"
                  src={extraction.thumbnailUrl}
                  alt=""
                  width={86}
                  height={48}
                  loading="lazy"
                  aria-hidden="true"
                />
              )}
              <div className="extractMeta">
                <div className="title">{extraction.title}</div>
                {extraction.channelName && <div className="subtle">{extraction.channelName}</div>}
              </div>
            </div>
            <label className="label" htmlFor="resolution-select">
              Resolution
            </label>
            <select
              id="resolution-select"
              className="select"
              value={String(selectedResolution)}
              onChange={(e) => setSelectedResolution(Number(e.target.value))}
              aria-label="Select output resolution"
            >
              {availableResolutions.map((h) => (
                <option key={h} value={String(h)}>
                  {h}p
                </option>
              ))}
            </select>

            <label className="label" htmlFor="container-select">
              File Type
            </label>
            <select
              id="container-select"
              className="select"
              value={selectedContainer}
              onChange={(e) => setSelectedContainer(e.target.value)}
              aria-label="Select output file type"
            >
              {availableContainers.map((c) => (
                <option key={c} value={c}>
                  {c.toUpperCase()}
                </option>
              ))}
            </select>

            <label className="label" htmlFor="audio-select">
              Audio
            </label>
            <select
              id="audio-select"
              className="select"
              value={selectedAudio}
              onChange={(e) => setSelectedAudio(e.target.value as AudioPreference)}
              aria-label="Select audio quality"
            >
              <option value="high">High quality</option>
              <option value="low">Low quality</option>
              <option value="none">No audio</option>
            </select>
          </div>
        )}

        {error && (
          <div id="url-error" className="error" role="alert" aria-live="polite">
            {error}
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="jobs-heading">
        <h2 id="jobs-heading">Jobs</h2>
        {!jobs.length && <p className="subtle">No jobs yet.</p>}
        <ul className="jobs" aria-label="Download jobs">
          {jobs.map((job) => (
            <li key={job.id} className="job">
              <div className="jobRow">
                {job.thumbnailUrl && (
                  <img
                    className="thumb small"
                    src={job.thumbnailUrl}
                    alt=""
                    width={72}
                    height={40}
                    loading="lazy"
                    aria-hidden="true"
                  />
                )}
                <div className="jobMeta">
                  <div className="jobHeader">
                    <strong>{job.title}</strong>
                    <div className="jobBadges">
                      <span className={`badge mode ${modeLabel(job.plan?.mode)}`}>
                        mode: {modeLabel(job.plan?.mode)}
                      </span>
                      <span className="badge output">{outputSummary(job)}</span>
                      <span className={`status ${job.status}`} aria-label={`Status: ${job.status}`}>
                        {job.status}
                      </span>
                    </div>
                  </div>
                  <div className="subtle">
                    {job.channelName ? `${job.channelName} • ` : ""}
                    {job.outputFileName}
                  </div>
                </div>
              </div>
              <progress
                max={1}
                value={job.progress.phaseProgress || 0}
                aria-label={`Progress: ${Math.round((job.progress.phaseProgress || 0) * 100)}%`}
              />
              {job.error && (
                <div className="error" role="alert" aria-live="polite">
                  {job.error.code}: {job.error.message}
                </div>
              )}
              <div className="row">
                <button
                  className="button"
                  type="button"
                  onClick={() => void retryJob(job.id)}
                  disabled={job.status !== "failed"}
                  aria-label="Retry failed job"
                >
                  Retry
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={() => void cancelJob(job.id)}
                  disabled={job.status !== "queued"}
                  aria-label="Cancel queued job"
                >
                  Cancel
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
