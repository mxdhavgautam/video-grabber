# Recovery and Failure Matrix

## Recovery Paths

| Scenario | Expected Behavior | Error/State |
| --- | --- | --- |
| Service worker terminated during download | Job restored from storage + OPFS checkpoint and re-queued | `WORKER_TERMINATED_RECOVERED` |
| Browser restart with queued/in-progress jobs | On startup, active jobs move to `queued` and resume | `WORKER_TERMINATED_RECOVERED` |
| Cancel queued job | Job transitions to `cancelled`, temp artifacts cleaned | `cancelled` |
| Failed extraction due upstream drift | Fail with deterministic extraction code, allow retry after update | `EXTRACTOR_UPSTREAM_CHANGE` |

## Deterministic Failure Paths

| Class | Trigger | Code |
| --- | --- | --- |
| Storage preflight | Not enough free quota before download | `STORAGE_QUOTA_PRECHECK_FAILED` |
| Storage write | Quota/pressure during write | `STORAGE_QUOTA_EXCEEDED` |
| Download protocol | Range unsupported with resume requested | `DOWNLOAD_HTTP_RANGE_UNSUPPORTED` |
| Mux workload | Input exceeds current wasm guardrail | `MUX_INPUT_TOO_LARGE` |
| Mux compatibility | Unsupported output container policy | `MUX_CODEC_INCOMPATIBLE` |
| Mux execution | ffmpeg runtime failure | `MUX_FFMPEG_FAILURE` |
| Access policy | Restricted/auth-required in public mode | `ACCESS_RESTRICTED_CONTENT` |
| DRM policy | DRM-protected content | `ACCESS_DRM_PROTECTED` |

## Operational Notes

- Public mode is baseline.
- Restricted mode is optional and consented; not silently auto-enabled.
- No remote executable code patching is used for recovery.
