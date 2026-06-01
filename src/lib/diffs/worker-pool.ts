import type { ThemesType, SupportedLanguages } from '@pierre/diffs'
import type {
  WorkerPoolOptions,
  WorkerInitializationRenderOptions,
} from '@pierre/diffs/react'

export const THEMES: ThemesType = {
  dark: 'github-dark-dimmed',
  light: 'github-light',
}

export const HIGHLIGHT_LANGS: SupportedLanguages[] = [
  'typescript',
  'javascript',
  'json',
  'css',
  'html',
  'markdown',
  'rust',
  'yaml',
  'toml',
]

function workerFactory(): Worker {
  return new Worker(
    new URL('@pierre/diffs/worker/worker.js', import.meta.url),
    { type: 'module' },
  )
}

export const WORKER_POOL_OPTIONS: WorkerPoolOptions = {
  workerFactory,
  poolSize: 4,
}

export const WORKER_HIGHLIGHTER_OPTIONS: WorkerInitializationRenderOptions = {
  langs: HIGHLIGHT_LANGS,
  theme: THEMES,
}
