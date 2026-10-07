#!/usr/bin/env node
/**
 * Download a single YouTube video via the extension to the project workspace.
 *
 * Usage: node scripts/download-video.mjs [url]
 * Default URL: https://youtu.be/_WQCvtLTsfg?si=ipEWYjG8ujR4GwiS
 *
 * Output: <project-root>/downloads/<filename>.mp4
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import childProcess from "node:child_process";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detectHeliumExecutable() {
  if (process.env.HELIUM_EXECUTABLE && fs.existsSync(process.env.HELIUM_EXECUTABLE)) {
    return process.env.HELIUM_EXECUTABLE;
  }
  if (process.env.CHROME_EXECUTABLE && fs.existsSync(process.env.CHROME_EXECUTABLE)) {
    return process.env.CHROME_EXECUTABLE;
  }
  if (process.platform !== "darwin") {
    return "";
  }
  const helium = "/Applications/Helium.app/Contents/MacOS/Helium";
  if (fs.existsSync(helium)) return helium;
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(chrome)) return chrome;
  try {
    const out = childProcess
      .execFileSync("mdfind", ["kMDItemFSName == 'Helium.app'"], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)[0];
    if (out) {
      const macosBin = path.join(out, "Contents", "MacOS", "Helium");
      if (fs.existsSync(macosBin)) return macosBin;
    }
  } catch {
    /* ignore */
  }
  return "";
}

async function waitForExtensionServiceWorker(context, timeoutMs = 30_000) {
  const existing = context.serviceWorkers();
  if (existing.length) return existing[0];
  return await context.waitForEvent("serviceworker", { timeout: timeoutMs });
}

function getExtensionIdFromWorker(worker) {
  const url = worker.url();
  const parts = url.split("/");
  return parts[2] || "";
}

async function sendRuntimeMessage(page, request) {
  return await page.evaluate((req) => chrome.runtime.sendMessage(req), request);
}

async function listJobs(page) {
  const response = await sendRuntimeMessage(page, { type: "LIST_JOBS" });
  if (!response?.ok || !("jobs" in response)) {
    throw new Error("LIST_JOBS failed.");
  }
  return response.jobs;
}

async function waitForLatestJobForUrl(page, url, timeoutMs = 20 * 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const jobs = await listJobs(page);
    const match = jobs
      .filter((j) => j.url === url)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
    if (match) return match;
    await sleep(750);
  }
  throw new Error(`Timed out waiting for job creation for ${url}`);
}

async function waitForJobTerminalStatus(page, jobId, timeoutMs = 40 * 60_000) {
  const start = Date.now();
  let lastStatus = "";
  let lastPhase = -1;
  while (Date.now() - start < timeoutMs) {
    const jobs = await listJobs(page);
    const job = jobs.find((j) => j.id === jobId);
    if (!job) {
      throw new Error(`Job disappeared: ${jobId}`);
    }
    const status = String(job.status || "");
    const phase = Number(job.progress?.phaseProgress ?? 0);
    if (status !== lastStatus || Math.abs(phase - lastPhase) >= 0.05) {
      lastStatus = status;
      lastPhase = phase;
      console.log("  Job status:", status, "phase", phase.toFixed(2));
    }
    if (job.status === "failed" || job.status === "complete" || job.status === "cancelled") {
      return job;
    }
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for terminal job status: ${jobId}`);
}

async function getDownloadItem(page, downloadId) {
  return await page.evaluate(async (id) => {
    const items = await chrome.downloads.search({ id });
    return items?.[0] ?? null;
  }, downloadId);
}

async function waitForDownloadComplete(page, downloadId, timeoutMs = 60 * 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const item = await getDownloadItem(page, downloadId);
    if (item) {
      if (item.state === "complete") return item;
      if (item.state === "interrupted") return item;
    }
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for download completion: ${downloadId}`);
}

function pickResolutionOption(options, targetHeight = 1080) {
  const parsed = options
    .map((o) => {
      const m = String(o.label).match(/^(\d{3,4})p\b/i);
      return { value: o.value, label: o.label, height: m ? Number(m[1]) : 0 };
    })
    .filter((o) => o.height > 0);
  const exact = parsed.find((o) => o.height === targetHeight);
  if (exact) return exact.value;
  const fallback = parsed.find((o) => o.height >= targetHeight);
  return fallback?.value ?? parsed.find((o) => o.height <= targetHeight)?.value ?? parsed[0]?.value ?? "";
}

async function run() {
  const url = process.argv[2] || "https://youtu.be/_WQCvtLTsfg?si=ipEWYjG8ujR4GwiS";
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, "../../..");
  const outDir = path.join(projectRoot, "downloads");
  await fs.promises.mkdir(outDir, { recursive: true });

  const extensionDist = path.resolve(__dirname, "../dist");
  const distManifest = path.join(extensionDist, "manifest.json");
  if (!fs.existsSync(distManifest)) {
    throw new Error(`Missing build output. Run: pnpm build (expected ${distManifest})`);
  }

  const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "video-grabber-dl-"));
  const defaultDir = path.join(userDataDir, "Default");
  await fs.promises.mkdir(defaultDir, { recursive: true });
  const prefsPath = path.join(defaultDir, "Preferences");
  const prefs = {
    download: {
      default_directory: outDir,
      prompt_for_download: false,
    },
  };
  await fs.promises.writeFile(prefsPath, JSON.stringify(prefs), "utf8");

  const executable = detectHeliumExecutable();
  if (!executable) {
    throw new Error(
      "Helium or Chrome not found. Set HELIUM_EXECUTABLE or CHROME_EXECUTABLE."
    );
  }

  console.log("URL:", url);
  console.log("Output dir:", outDir);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: executable,
    args: [
      `--disable-extensions-except=${extensionDist}`,
      `--load-extension=${extensionDist}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  try {
    const worker = await waitForExtensionServiceWorker(context);
    const extensionId = getExtensionIdFromWorker(worker);
    if (!extensionId) {
      throw new Error("Failed to detect extension ID.");
    }

    const page = context.pages()[0] || (await context.newPage());
    for (const extra of context.pages()) {
      if (extra !== page) {
        await extra.close().catch(() => undefined);
      }
    }
    context.on("page", async (created) => {
      if (created !== page) {
        await created.close().catch(() => undefined);
      }
    });

    await page.goto(`chrome-extension://${extensionId}/index.html`, { waitUntil: "domcontentloaded" });

    console.log("\nFilling URL and analyzing...");
    await page.locator("#url-input").fill(url);
    await page.getByRole("button", { name: /Analyze/ }).click();

    const resolutionSelect = page.locator("select.select").nth(0);
    const typeSelect = page.locator("select.select").nth(1);
    const audioSelect = page.locator("select.select").nth(2);
    await resolutionSelect.waitFor({ timeout: 60_000 });

    const options = await resolutionSelect.evaluate((sel) => {
      const opts = Array.from(sel.options || []);
      return opts.map((o) => ({ value: o.value, label: o.textContent || "" }));
    });
    const resValue = pickResolutionOption(options, 1080);
    if (!resValue) {
      throw new Error("No 1080p option available.");
    }
    await resolutionSelect.selectOption(resValue);
    console.log("  Selected: 1080p");

    const typeOptions = await typeSelect.evaluate((sel) => Array.from(sel.options || []).map((o) => o.value));
    const wantsType = typeOptions.includes("mp4") ? "mp4" : typeOptions[0] || "";
    if (wantsType) {
      await typeSelect.selectOption(wantsType);
    }

    await audioSelect.selectOption("high");
    console.log("  Selected: high audio");

    console.log("\nStarting download...");
    await page.getByRole("button", { name: "Start download job" }).click();

    const job = await waitForLatestJobForUrl(page, url);
    const terminal = await waitForJobTerminalStatus(page, job.id);
    if (terminal.status === "failed") {
      throw new Error(`${terminal.error?.code ?? "FAILED"}: ${terminal.error?.message ?? "Unknown error"}`);
    }
    if (!terminal.downloadId) {
      throw new Error("Job finished without downloadId.");
    }

    const item = await waitForDownloadComplete(page, terminal.downloadId);
    if (item.state !== "complete") {
      throw new Error(`Download interrupted: ${item.error ?? "unknown"}`);
    }

    const filename = String(item.filename || "");
    const dest = path.join(outDir, path.basename(terminal.outputFileName || filename));
    if (filename !== dest) {
      await fs.promises.copyFile(filename, dest);
      await fs.promises.unlink(filename).catch(() => undefined);
    }

    const stat = await fs.promises.stat(dest);
    console.log("\nDone:", dest);
    console.log("Size:", (stat.size / 1024 / 1024).toFixed(2), "MB");
  } finally {
    await context.close().catch(() => undefined);
    await fs.promises.rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
