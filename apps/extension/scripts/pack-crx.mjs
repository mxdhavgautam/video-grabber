import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";

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
  return "";
}

function run(args) {
  const exe = detectHeliumExecutable();
  if (!exe) {
    throw new Error(
      "Helium executable not found. Set HELIUM_EXECUTABLE (e.g. /Applications/Helium.app/Contents/MacOS/Helium)."
    );
  }
  childProcess.execFileSync(exe, args, { stdio: "inherit" });
}

const root = path.resolve(".");
const distDir = path.join(root, "dist");
const manifest = path.join(distDir, "manifest.json");
if (!fs.existsSync(manifest)) {
  throw new Error(`Missing build output at ${manifest}. Run: npm run build`);
}

const releaseDir = path.join(root, "release");
await fs.promises.mkdir(releaseDir, { recursive: true });

const keyPath = path.join(releaseDir, "video-grabber.pem");

// Chromium writes <dir>.crx and <dir>.pem next to the packed directory.
const crxOut = `${distDir}.crx`;
const pemOut = `${distDir}.pem`;

if (fs.existsSync(crxOut)) {
  await fs.promises.rm(crxOut, { force: true });
}

if (fs.existsSync(keyPath)) {
  run([`--pack-extension=${distDir}`, `--pack-extension-key=${keyPath}`]);
} else {
  // First-time: generate a new key.
  run([`--pack-extension=${distDir}`]);
  if (!fs.existsSync(pemOut)) {
    throw new Error(`Expected Helium to emit ${pemOut} but it was not found.`);
  }
  await fs.promises.rename(pemOut, keyPath);
  // Re-pack using the stored key so the output is consistent.
  if (fs.existsSync(crxOut)) {
    await fs.promises.rm(crxOut, { force: true });
  }
  run([`--pack-extension=${distDir}`, `--pack-extension-key=${keyPath}`]);
}

console.log("\nCRX output:", crxOut);
console.log("Key stored (keep private):", keyPath);

