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
  if (process.platform !== "darwin") {
    return "";
  }
  const candidate = "/Applications/Helium.app/Contents/MacOS/Helium";
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  try {
    const out = childProcess
      .execFileSync("mdfind", ["kMDItemFSName == 'Helium.app'"], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)[0];
    if (out) {
      const macosBin = path.join(out, "Contents", "MacOS", "Helium");
      if (fs.existsSync(macosBin)) {
        return macosBin;
      }
    }
  } catch {
    // ignore best-effort discovery failures
  }
  return "";
}

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

function parseChannelIdFromHtml(html) {
  const m =
    html.match(/"externalId":"(UC[a-zA-Z0-9_-]{20,})"/) ||
    html.match(/"channelId":"(UC[a-zA-Z0-9_-]{20,})"/);
  return m?.[1] ?? "";
}

function parseLatestVideoIdsFromFeed(xml, limit) {
  const ids = [];
  const re = /<yt:videoId>([^<]+)<\/yt:videoId>/g;
  let match;
  while ((match = re.exec(xml))) {
    ids.push(match[1]);
    if (ids.length >= limit) break;
  }
  return ids;
}

async function getLatestChannelVideoUrls(handle, limit = 5) {
  const normalized = String(handle || "").replace(/^@/, "").trim();
  if (!normalized) {
    throw new Error("Missing channel handle. Set SANDBOX_YT_HANDLE (e.g. mkbhd).");
  }
  const profileHtml = await fetch(`https://www.youtube.com/@${encodeURIComponent(normalized)}`).then((r) => r.text());
  const channelId = parseChannelIdFromHtml(profileHtml);
  if (!channelId) {
    throw new Error(`Failed to discover channel ID for @${normalized}.`);
  }

  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const feedXml = await fetch(feedUrl).then((r) => r.text());
  const videoIds = parseLatestVideoIdsFromFeed(feedXml, limit);
  if (videoIds.length < limit) {
    throw new Error(`Expected ${limit} video IDs from feed, got ${videoIds.length}.`);
  }

  return videoIds.map((id) => `https://www.youtube.com/watch?v=${id}`);
}

async function waitForExtensionServiceWorker(context, timeoutMs = 30_000) {
  const existing = context.serviceWorkers();
  if (existing.length) return existing[0];
  return await context.waitForEvent("serviceworker", { timeout: timeoutMs });
}

function getExtensionIdFromWorker(worker) {
  const url = worker.url(); // chrome-extension://<id>/background.js
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
      console.log("Job status:", status, "phase", phase.toFixed(2));
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

function pickSelectValueFor1080p(options) {
  // Prefer exact 1080p; otherwise pick any >=1080 sorted descending.
  const parsed = options
    .map((o) => {
      const m = String(o.label).match(/^(\d{3,4})p\b/i);
      return { value: o.value, label: o.label, q: m ? Number(m[1]) : 0 };
    })
    .filter((o) => o.q >= 1080)
    .sort((a, b) => a.q - b.q); // low→high so 1080p wins

  const exact = parsed.find((o) => o.q === 1080);
  if (exact) return exact.value;
  return parsed[0]?.value ?? "";
}

async function run() {
  const extensionDist = path.resolve("dist");
  const distManifest = path.join(extensionDist, "manifest.json");
  if (!fs.existsSync(distManifest)) {
    throw new Error(`Missing build output. Run: npm run build (expected ${distManifest})`);
  }

  const handle = process.env.SANDBOX_YT_HANDLE || "t3dotgg";
  const outRoot = path.resolve("../../runtime/download-tests", randomId(`sandbox-extension-${handle}`));
  await ensureDir(outRoot);

  const urls = await getLatestChannelVideoUrls(handle, 5);
  await fs.promises.writeFile(path.join(outRoot, "targets.json"), JSON.stringify(urls, null, 2));

  const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "video-grabber-e2e-"));

  const heliumExecutable = detectHeliumExecutable();
  if (!heliumExecutable) {
    throw new Error(
      "Helium executable not found. Set HELIUM_EXECUTABLE to your Helium binary path (e.g. /Applications/Helium.app/Contents/MacOS/Helium)."
    );
  }
  console.log("Using Helium executable:", heliumExecutable);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: heliumExecutable,
    args: [
      `--disable-extensions-except=${extensionDist}`,
      `--load-extension=${extensionDist}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  try {
    console.log("Sandbox profile:", userDataDir);
    const worker = await waitForExtensionServiceWorker(context);
    const extensionId = getExtensionIdFromWorker(worker);
    if (!extensionId) {
      throw new Error("Failed to detect extension ID.");
    }
    console.log("Extension ID:", extensionId);

    // Keep the whole flow in a single visible tab.
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

    for (const url of urls) {
      const record = { url, ok: false };
      try {
        console.log("\n===", url, "===");
        // Fill URL + analyze.
        await page.locator("#url-input").fill(url);
        await page.getByRole("button", { name: /Analyze/ }).click();

        // Wait for formats select.
        const resolutionSelect = page.locator("select.select").nth(0);
        const typeSelect = page.locator("select.select").nth(1);
        const audioSelect = page.locator("select.select").nth(2);
        await resolutionSelect.waitFor({ timeout: 60_000 });

        // Read all option labels/values and pick 1080p (or lowest >=1080).
        const options = await resolutionSelect.evaluate((sel) => {
          const opts = Array.from(sel.options || []);
          return opts.map((o) => ({ value: o.value, label: o.textContent || "" }));
        });
        console.log("Resolution options:", options.map((o) => o.label).join(", "));
        const selectValue = pickSelectValueFor1080p(options);
        if (!selectValue) {
          throw new Error("No 1080p+ option available in extractor results.");
        }
        await resolutionSelect.selectOption(selectValue);
        console.log("Selected option:", options.find((o) => o.value === selectValue)?.label || selectValue);

        // Prefer mp4 output when available.
        const typeOptions = await typeSelect.evaluate((sel) => Array.from(sel.options || []).map((o) => o.value));
        const wantsType = typeOptions.includes("mp4") ? "mp4" : typeOptions[0] || "";
        if (wantsType) {
          await typeSelect.selectOption(wantsType);
        }

        // Audio: high quality.
        await audioSelect.selectOption("high");

        // Start job.
        await page.getByRole("button", { name: "Start download job" }).click();

        const job = await waitForLatestJobForUrl(page, url);
        console.log("Job ID:", job.id);
        const terminal = await waitForJobTerminalStatus(page, job.id);
        if (terminal.status === "failed") {
          throw new Error(`${terminal.error?.code ?? "FAILED"}: ${terminal.error?.message ?? "Unknown error"}`);
        }
        console.log("Expected filename:", terminal.outputFileName || "(missing)");
        if (!terminal.downloadId) {
          throw new Error("Job finished without downloadId.");
        }
        console.log("Download ID:", terminal.downloadId);

        const item = await waitForDownloadComplete(page, terminal.downloadId);
        console.log("Download item url:", item?.url || "(missing)");
        console.log("Download item filename:", item?.filename || "(missing)");
        if (item.state !== "complete") {
          throw new Error(`Download interrupted: ${item.error ?? "unknown"}`);
        }

        const expectedName = String(terminal.outputFileName || "");
        if (!expectedName) {
          throw new Error("Terminal job missing outputFileName.");
        }
        if (!expectedName.includes("[Video-Grabber]")) {
          throw new Error(`Expected filename missing project tag: ${expectedName}`);
        }
        if (!path.extname(expectedName)) {
          throw new Error(`Expected filename missing extension: ${expectedName}`);
        }

        const filename = String(item.filename || "");
        const dest = path.join(outRoot, expectedName);
        await fs.promises.copyFile(filename, dest);

        const stat = await fs.promises.stat(filename);
        if (!stat.size) {
          throw new Error("Downloaded file is empty.");
        }
        console.log("Downloaded bytes:", stat.size);

        const fd = await fs.promises.open(dest, "r");
        const header = Buffer.alloc(16);
        await fd.read(header, 0, header.length, 0);
        await fd.close();

        const expectedExt = path.extname(expectedName).toLowerCase();
        const isMp4Family = header.subarray(4, 8).toString("ascii") === "ftyp";
        const isEbml = header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])); // Matroska/WebM
        if (expectedExt === ".mp4" || expectedExt === ".mov") {
          if (!isMp4Family) {
            throw new Error(`Downloaded file does not look like ${expectedExt} (missing ftyp).`);
          }
        } else if (expectedExt === ".webm" || expectedExt === ".mkv") {
          if (!isEbml) {
            throw new Error(`Downloaded file does not look like ${expectedExt} (missing EBML header).`);
          }
        }

        record.ok = true;
        record.downloadId = terminal.downloadId;
        record.filename = dest;
        record.bytes = stat.size;

        // Keep the sandbox clean.
        await fs.promises.unlink(filename).catch(() => undefined);
      } catch (error) {
        record.error = String(error?.message ?? error);
        console.log("FAILED:", record.error);
      }

      results.push(record);
      await fs.promises.writeFile(path.join(outRoot, "summary.json"), JSON.stringify(results, null, 2));
    }

    const okCount = results.filter((r) => r.ok).length;
    if (okCount !== results.length) {
      process.exitCode = 1;
    }
  } finally {
    await context.close().catch(() => undefined);
    // Best-effort cleanup of the profile dir; comment out if you want to inspect chrome://downloads afterwards.
    await fs.promises.rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

await run();

