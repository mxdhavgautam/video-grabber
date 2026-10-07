#!/usr/bin/env node
/**
 * Launch browser with extension loaded and open the popup.
 * Keeps the browser open until Ctrl+C.
 *
 * Usage: node scripts/open-extension.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { chromium } from "playwright-core";

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

async function run() {
  const extensionDist = path.resolve("dist");
  const distManifest = path.join(extensionDist, "manifest.json");
  if (!fs.existsSync(distManifest)) {
    throw new Error(`Missing build output. Run: pnpm build (expected ${distManifest})`);
  }

  const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "video-grabber-open-"));
  const defaultDir = path.join(userDataDir, "Default");
  await fs.promises.mkdir(defaultDir, { recursive: true });
  const downloadsPath = path.join(os.homedir(), "Downloads");
  const prefsPath = path.join(defaultDir, "Preferences");
  const prefs = {
    download: {
      default_directory: downloadsPath,
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

  console.log("Downloads will save to:", downloadsPath);

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

  const worker = await waitForExtensionServiceWorker(context);
  const extensionId = getExtensionIdFromWorker(worker);
  if (!extensionId) {
    throw new Error("Failed to detect extension ID.");
  }

  const popupUrl = `chrome-extension://${extensionId}/index.html`;
  console.log("Extension ID:", extensionId);
  console.log("Popup URL:", popupUrl);
  console.log("Press Ctrl+C to close.\n");

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(popupUrl, { waitUntil: "domcontentloaded" });

  // Keep process alive
  await new Promise(() => {});
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
