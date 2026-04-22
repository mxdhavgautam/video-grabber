#!/usr/bin/env node
/**
 * E2E test: download a single video in 3 configs:
 * 1. 4K + low audio
 * 2. 360p + high audio
 * 3. 1080p + no audio
 *
 * Usage: node scripts/test-download-configs.mjs [url]
 * Default URL: https://www.youtube.com/watch?v=xRla0izRxqU
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright-core";
import childProcess from "node:child_process";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString("hex")}`;
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

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
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

function pickResolutionOption(options, targetHeight) {
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

const TEST_CONFIGS = [
  { name: "4K + low audio", resolution: 2160, audio: "low" },
  { name: "360p + high audio", resolution: 360, audio: "high" },
  { name: "1080p + no audio", resolution: 1080, audio: "none" },
];

async function run() {
  const url = process.argv[2] || "https://www.youtube.com/watch?v=xRla0izRxqU";
  const extensionDist = path.resolve("dist");
  const distManifest = path.join(extensionDist, "manifest.json");
  if (!fs.existsSync(distManifest)) {
    throw new Error(`Missing build output. Run: npm run build (expected ${distManifest})`);
  }

  const outRoot = path.resolve("../../runtime/download-tests", randomId("test-configs"));
  await ensureDir(outRoot);
  console.log("Output dir:", outRoot);

  const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "video-grabber-test-"));

  const executable = detectHeliumExecutable();
  if (!executable) {
    throw new Error(
      "Helium or Chrome not found. Set HELIUM_EXECUTABLE or CHROME_EXECUTABLE to your browser binary path."
    );
  }
  console.log("Using browser:", executable);

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
    console.log("Extension ID:", extensionId);

    const existingPages = context.pages();
    const page = existingPages[0] || (await context.newPage());
    for (const extra of existingPages) {
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

    const results = [];

    for (const config of TEST_CONFIGS) {
      const record = { config: config.name, ok: false };
      try {
        console.log("\n=== " + config.name + " ===");
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
        console.log("  Resolution options:", options.map((o) => o.label).join(", "));
        const resValue = pickResolutionOption(options, config.resolution);
        if (!resValue) {
          throw new Error(`No ${config.resolution}p option available.`);
        }
        await resolutionSelect.selectOption(resValue);
        console.log("  Selected resolution:", resValue);

        const typeOptions = await typeSelect.evaluate((sel) => Array.from(sel.options || []).map((o) => o.value));
        const wantsType = typeOptions.includes("mp4") ? "mp4" : typeOptions[0] || "";
        if (wantsType) {
          await typeSelect.selectOption(wantsType);
        }

        await audioSelect.selectOption(config.audio);
        console.log("  Selected audio:", config.audio);

        await page.getByRole("button", { name: "Start download job" }).click();

        const job = await waitForLatestJobForUrl(page, url);
        console.log("  Job ID:", job.id);
        const terminal = await waitForJobTerminalStatus(page, job.id);
        if (terminal.status === "failed") {
          throw new Error(`${terminal.error?.code ?? "FAILED"}: ${terminal.error?.message ?? "Unknown error"}`);
        }
        console.log("  Output:", terminal.outputFileName || "(missing)");
        if (!terminal.downloadId) {
          throw new Error("Job finished without downloadId.");
        }

        const item = await waitForDownloadComplete(page, terminal.downloadId);
        if (item.state !== "complete") {
          throw new Error(`Download interrupted: ${item.error ?? "unknown"}`);
        }

        const expectedName = String(terminal.outputFileName || "");
        const filename = String(item.filename || "");
        const dest = path.join(outRoot, expectedName);
        await fs.promises.copyFile(filename, dest);

        const stat = await fs.promises.stat(filename);
        if (!stat.size) {
          throw new Error("Downloaded file is empty.");
        }
        console.log("  Downloaded:", stat.size, "bytes ->", dest);

        await fs.promises.unlink(filename).catch(() => undefined);

        record.ok = true;
        record.filename = dest;
        record.bytes = stat.size;
      } catch (error) {
        record.error = String(error?.message ?? error);
        console.log("  FAILED:", record.error);
      }
      results.push(record);
    }

    await fs.promises.writeFile(path.join(outRoot, "summary.json"), JSON.stringify(results, null, 2));
    const okCount = results.filter((r) => r.ok).length;
    console.log("\n--- Summary ---");
    console.log(`${okCount}/${results.length} configs succeeded`);
    if (okCount !== results.length) {
      process.exitCode = 1;
    }
  } finally {
    await context.close().catch(() => undefined);
    await fs.promises.rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

await run();
