# Distribution Strategy

## Decision

Primary distribution track is **Track B: open-source unpacked extension tooling**.

This means:

- We optimize for local developer/power-user installation (`Load unpacked`).
- We do not block implementation on Chrome Web Store approval.
- We document CWS as a possible future channel with known rejection risk.

## Why This Track

- CWS policy risk is first-order for downloader behavior.
- Non-store workflows keep iteration speed high while architecture stabilizes.
- The re-architecture focuses on technical viability and resilience first.

## Go / No-Go Gates

### Go

- End-to-end extension flow works for supported content classes.
- Local packaged runtime passes CSP/MV3 constraints.
- Recovery after service worker restart is validated.

### No-Go

- Runtime depends on remote executable code.
- Extraction fails systematically for supported public test set.
- Muxing exceeds documented guardrails without deterministic failure handling.

## Contingency

If CWS path is pursued later:

- Add a stricter feature scope profile for store builds.
- Keep an unpacked/open build profile as fallback channel.
- Maintain docs that state scope differences clearly.
