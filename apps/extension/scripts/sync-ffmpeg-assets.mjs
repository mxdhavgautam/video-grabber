import { mkdir, cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// @ffmpeg/ffmpeg runs its own worker as `type: "module"`.
// That worker tries `importScripts(coreURL)` first, but will fall back to `import(coreURL)`
// when `importScripts` is unavailable. So we must ship the ESM builds of ffmpeg-core.
const coreEntry = require.resolve("@ffmpeg/core");
const coreMtEntry = require.resolve("@ffmpeg/core-mt");

// Both resolve to `.../dist/umd/ffmpeg-core.js` (or similar). Walk up to the package root.
const corePkgDir = join(dirname(coreEntry), "..", "..");
const coreMtPkgDir = join(dirname(coreMtEntry), "..", "..");

const coreDistDir = join(corePkgDir, "dist", "esm");
const coreMtDistDir = join(coreMtPkgDir, "dist", "esm");

const targets = [
  {
    sourceBase: coreDistDir,
    destinationBase: join(process.cwd(), "public", "vendor", "ffmpeg", "core-st"),
    files: ["ffmpeg-core.js", "ffmpeg-core.wasm"],
  },
  {
    sourceBase: coreMtDistDir,
    destinationBase: join(process.cwd(), "public", "vendor", "ffmpeg", "core-mt"),
    files: ["ffmpeg-core.js", "ffmpeg-core.wasm", "ffmpeg-core.worker.js"],
  },
];

for (const target of targets) {
  await mkdir(target.destinationBase, { recursive: true });
  for (const fileName of target.files) {
    await cp(join(target.sourceBase, fileName), join(target.destinationBase, fileName), {
      force: true,
    });
  }
}

console.log("ffmpeg.wasm runtime assets synced to public/vendor/ffmpeg");
