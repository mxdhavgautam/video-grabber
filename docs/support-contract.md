# Support Contract

## Supported (Initial)

- Publicly accessible videos with non-DRM media streams.
- Format extraction for selectable quality profiles.
- Download + resumable checkpointing for supported URLs.
- Audio/video muxing with `-c copy` first strategy.

## Explicitly Unsupported (Initial)

- DRM-protected streams.
- Private/member-only/auth-gated content in baseline public mode.
- Any flow requiring hidden credential harvesting.
- Unstable live-window edge cases outside validated paths.
- Undocumented bypass behavior that violates declared policy constraints.

## Optional Future Mode (Not Enabled by Default)

- Restricted-mode with explicit user consent and additional permissions.
- Must remain isolated from public baseline mode.
- Must include dedicated policy/legal documentation and clear UX warnings.

## Stability Expectations

- Upstream extraction behavior can break without warning.
- Extension ships with adapter boundaries and fallback handling.
- Breakages should degrade to deterministic error states, not silent failure.
