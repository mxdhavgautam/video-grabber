# Error Taxonomy

All runtime failures should map to deterministic error codes.

## Extraction

- `EXTRACTOR_UNSUPPORTED_URL`: URL not supported by current extractor adapters.
- `EXTRACTOR_UPSTREAM_CHANGE`: Upstream response/signature format drift detected.
- `EXTRACTOR_NO_FORMATS`: Extraction succeeded but no downloadable formats found.

## Access / Policy

- `ACCESS_RESTRICTED_CONTENT`: Content requires auth/cookies in public mode.
- `ACCESS_GEO_BLOCKED`: Content unavailable in current region/network.
- `ACCESS_DRM_PROTECTED`: Stream is DRM-protected and intentionally unsupported.

## Download / Storage

- `DOWNLOAD_HTTP_RANGE_UNSUPPORTED`: Remote does not honor range requests.
- `DOWNLOAD_URL_EXPIRED`: Signed URL expired and refresh failed.
- `STORAGE_QUOTA_PRECHECK_FAILED`: Not enough available storage before start.
- `STORAGE_QUOTA_EXCEEDED`: Write failed due to quota or pressure conditions.

## Mux / Media

- `MUX_INPUT_TOO_LARGE`: Input exceeds current supported ffmpeg.wasm guardrails.
- `MUX_CODEC_INCOMPATIBLE`: Stream combination requires unsupported conversion path.
- `MUX_FFMPEG_FAILURE`: ffmpeg execution failed with non-recoverable status.

## Lifecycle / Reliability

- `WORKER_TERMINATED_RECOVERED`: Worker died and job recovered from checkpoint.
- `WORKER_TERMINATED_UNRECOVERABLE`: Worker died and checkpoint was invalid.
- `STATE_CORRUPTED`: Persisted job state failed validation.
