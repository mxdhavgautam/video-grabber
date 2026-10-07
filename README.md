# Video Grabber

Video Grabber is being rebuilt as a **strict client-side Chromium extension runtime** with a hard cutover strategy.
No backend compatibility, no VPS runtime, and no server deployment path are retained.

## Distribution Strategy (Locked)

Primary track is **open-source unpacked tooling** (developer/power-user flow), with CWS treated as optional and policy-gated.

See:

- `docs/distribution-strategy.md`
- `docs/support-contract.md`
- `docs/error-taxonomy.md`
- `docs/mux-guardrails.md`
- `docs/recovery-failure-matrix.md`
- `docs/breakage-triage-runbook.md`
- `docs/open-source-readiness.md`

## Runtime Architecture

- `apps/extension` (MV3 extension only)
- background service worker control plane
- offscreen document for ffmpeg.wasm operations
- OPFS + `chrome.storage` checkpoints for resumable jobs

## Development

```bash
pnpm install
pnpm dev
pnpm build
```

Build output lands in `apps/extension/dist/`.

## Install In Helium (Unpacked)

Helium is Chromium-based; the flow is the same as Chrome:

1. `pnpm install`
2. `pnpm build`
3. Open Helium and navigate to `chrome://extensions`
4. Enable `Developer mode`
5. Click `Load unpacked`
6. Select `apps/extension/dist`

## Install From GitHub Releases

Chrome Web Store publication is likely to be policy-gated for a YouTube downloader-style extension (regardless of implementation details), so distribution is expected to be via GitHub Releases.

Release install flow:

1. Download the release asset zip
2. Unzip it somewhere permanent on disk
3. Open `chrome://extensions` in Helium (or any Chromium browser)
4. Enable `Developer mode`
5. Click `Load unpacked`
6. Select the unzipped folder (the one that contains `manifest.json`)

## Build And Package (Maintainers)

```bash
pnpm install
pnpm build
```

### Zip (Unpacked Release)

```bash
cd apps/extension/dist
zip -r ../../video-grabber-extension.zip .
```

### CRX (Helium Pack)

```bash
# Requires Helium installed at /Applications/Helium.app (or set HELIUM_EXECUTABLE)
pnpm --filter @video-grabber/extension pack:crx
```

Notes:
- The `.pem` key is stored under `apps/extension/release/` and is intentionally gitignored. Keep it private if you want a stable extension ID across builds.
- Many modern Chromium builds restrict CRX installs outside the Web Store; if CRX install is blocked, use the unpacked install flow instead.

## Omnibox Shortcut

After installing, type `vg` in the address bar, press Space, then press Enter to open the extension UI.

- You can also do `vg <youtube-url>` to open the UI with the URL prefilled.
- Chrome lets users customize omnibox shortcuts under Settings → Search engine → Manage site search.
