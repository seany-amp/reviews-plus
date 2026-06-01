# reviews-plus — Project Instructions

## MANDATORY: Visual verification on every change

For **any** change that touches rendered UI or app behavior, you MUST verify it in
the running app using the browser MCP visual checker (firefox-devtools, or the
available browser-devtools MCP) before considering the work done. This is not
optional and applies to every change going forward.

Process:
1. Ensure the dev server is running (`pnpm dev`, port 1420). The app runs in plain
   browser mode and auto-mocks Tauri when `__TAURI_INTERNALS__` is absent.
2. Drive the app via the browser MCP: load the affected view, exercise the change,
   take screenshots as evidence.
3. **Check the console and network**: report any errors/warnings verbatim, and any
   failed network/script/worker loads. Zero console errors is the bar.
4. For large/realistic data, use the stress fixtures (`localStorage`
   `reviews-plus:stress=1` or `?stress=1`).

If the visual check cannot be run, say so explicitly — do not claim a UI change
works without it.

## Build / verify commands

- Typecheck + build: `pnpm build` (runs `tsc && vite build`)
- Dev server: `pnpm dev` (port 1420)
- Rust check: `cargo check` in `src-tauri/`

## Architecture notes

- Diff rendering uses `@pierre/diffs`. Syntax highlighting runs off-thread via a
  worker pool (`src/lib/diffs/worker-pool.ts`, `WorkerPoolContextProvider`).
- GitHub access goes through the Tauri `github_fetch` command; a mock layer
  (`src/lib/mock/`) serves fixtures in browser/dev mode.
- Token storage uses `tauri-plugin-store` (`src/lib/token-store.ts`), not the OS
  keychain.
