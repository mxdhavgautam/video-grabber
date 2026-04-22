# Breakage Triage Runbook

Use this runbook when extraction success drops or users report systemic failures.

## 1) Classify Incident

- **Class A**: extraction parser/decipher drift
- **Class B**: access restrictions/tokens/attestation
- **Class C**: storage/mux runtime constraints

## 2) Reproduce Quickly

- Run fixture checks:
  - `npm run test:fixtures --workspace @video-grabber/extension`
- Run build/lint:
  - `npm run lint && npm run build`
- Test representative supported URLs in extension runtime.

## 3) Mitigate

- Bump pinned extractor dependency (`youtubei.js`) if regression is upstream.
- Keep adapter fallback path active (do not remove fallback on hotfix).
- Preserve error-code determinism; no ad-hoc opaque failures.

## 4) Validate

- Confirm extraction + job lifecycle + mux path still pass baseline checks.
- Confirm no remote-hosted executable code was introduced.

## 5) Document

- Update this runbook's incident notes section (or equivalent release notes) for each breakage.
- Record timestamp, affected class, and remediation commit hash (when committing).
