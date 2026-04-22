# Open Source Readiness

## Codebase State

- Backend, VPS, and containerized runtime surfaces are removed.
- Extension-only runtime (`apps/extension`) is now the sole execution path.
- Public-mode support contract is explicit and documented.

## Required Validation Before Publish

- `npm run lint`
- `npm run build`
- `npm run test:fixtures --workspace @video-grabber/extension`

## History Rewrite Plan

Use `git-filter-repo` to rewrite repository history and remove legacy sensitive eras before public release.

### Suggested sequence

1. Ensure a clean working tree and backups.
2. Install `git-filter-repo` if missing.
3. Run rewrite with explicit path inversions/cleanup strategy as needed.
4. Verify rewritten history for forbidden files/patterns.
5. Force-replace remote branches/tags intentionally.
6. Require collaborators to fresh-clone.

## Collaborator Re-clone Notice

After rewrite:

- Existing clones become incompatible with rewritten history.
- Everyone must re-clone or hard-reset to the new history root.
