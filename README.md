<div align="center">
  <img src="public/logo.svg" width="72" height="72" alt="reviews-plus logo" />
  <h1>reviews-plus</h1>
  <p>A fast desktop app for reviewing GitHub pull requests.</p>
</div>

---

reviews-plus is a [Tauri](https://tauri.app) + React desktop app that gives GitHub
PR review its own focused, keyboard-driven home — syntax-highlighted split diffs,
inline comments, and the full review workflow, without a browser tab.

## Features

- **Diff viewer** — split/unified diffs with off-thread syntax highlighting
  (powered by [`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs)),
  virtualized for large PRs.
- **File tree** — jump to any file; the tree always matches what's in the diff.
- **Comments** — click a line number to comment, multi-line selections, threaded
  replies, resolve/unresolve, edit/delete your own.
- **Reviews** — stage pending comments and submit a review (Approve / Request
  changes / Comment) in one go.
- **At a glance** — CI/status checks and a rendered (and editable, for your own
  PRs) Markdown description in the header.
- **Local diff** — compare two local directories with the same viewer.
- **Keyboard-first** — `j`/`k` files, `c` comment, `⌘P` file palette, `⌘B` tree,
  `⌘J` comments, `?` for all shortcuts.

## Install

Download the latest `.dmg` from the [**Releases**](../../releases) page, open it,
and drag **reviews-plus** to Applications.

> The app is not yet code-signed/notarized. On first launch, right-click the app
> → **Open** (or run `xattr -dr com.apple.quarantine /Applications/reviews-plus.app`).

### Set up a token

Open **Settings** and paste a GitHub
[personal access token](https://github.com/settings/tokens) with `repo` scope.
It's stored locally via `tauri-plugin-store` — never sent anywhere but GitHub.

Then paste a PR URL (`https://github.com/owner/repo/pull/123`) and review.

## Development

Prerequisites: [Node](https://nodejs.org) 18+, [pnpm](https://pnpm.io), and the
[Rust toolchain](https://www.rust-lang.org/tools/install) (for Tauri).

```bash
pnpm install
pnpm tauri dev          # run the desktop app
```

Run just the web frontend (auto-mocks GitHub via fixtures when not in Tauri):

```bash
pnpm dev                # http://localhost:1420
```

### Build

```bash
pnpm build              # typecheck + bundle the frontend
pnpm tauri build        # produce the native app + .dmg installer
```

## Releases & versioning

Merging to `main` triggers a GitHub Action that bumps the patch version, tags the
commit, builds the macOS installer, and publishes it to a GitHub Release. The app
version lives in `package.json` and `src-tauri/tauri.conf.json` (kept in sync).

## Tech

React 18 · TypeScript · Tailwind v4 · TanStack Query · Tauri 2 (Rust) ·
`@pierre/diffs` · `@pierre/trees`
