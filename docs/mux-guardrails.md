# Mux Guardrails

## Default Behavior

- Mux pipeline runs in offscreen context with ffmpeg.wasm.
- Command strategy is `-c copy` first (no default re-encode).

## Guardrails

- Supported output containers: `mp4`, `webm`, `mkv`, `mov`.
- Combined video+audio input guardrail: approximately `1.8 GB` max planned mux workload.
- If guardrails are exceeded, runtime returns deterministic failures:
  - `MUX_INPUT_TOO_LARGE`
  - `MUX_CODEC_INCOMPATIBLE`
  - `MUX_FFMPEG_FAILURE`

## Threading Strategy

- Attempt multi-thread core only when cross-origin isolation is available.
- Fallback to single-thread core automatically when isolation/threading is unavailable.

## Rationale

- Aligns with ffmpeg.wasm practical limits and performance envelope.
- Avoids hidden re-encode paths that destabilize browser runtime behavior.
