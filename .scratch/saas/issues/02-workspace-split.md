# Split into npm workspaces and publish the CLI

Status: ready-for-agent

Blocked by: 01

Four workspaces: `packages/core`, `packages/cli`, `apps/web`, `apps/worker`.
The point of the split is a hard boundary — `apps/web` has a build step and a
dependency tree, and neither may leak into the CLI.

- `packages/core` and `packages/cli` keep an empty `dependencies` block, checked
  in CI so it is enforced rather than intended.
- Add a `bin` entry to `packages/cli` so `npx earshot` works. The
  package currently has `main: src/index.ts` and no `bin`, so it is not
  runnable as a CLI at all.
- Publish `packages/cli` to npm.
