import { memo, useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { parsePatchFiles, preloadHighlighter } from '@pierre/diffs'
import { FileDiff, WorkerPoolContextProvider } from '@pierre/diffs/react'
import type {
  FileDiffMetadata,
  FileDiffOptions,
  ThemesType,
} from '@pierre/diffs'
import { invoke } from '@/lib/mock/invoke'
import { open } from '@tauri-apps/plugin-dialog'
import { Button } from '@/components/ui/button'
import { FolderOpen, ArrowLeftRight, Loader2, PanelLeft } from 'lucide-react'
import { toast } from 'sonner'
import { FileTreeSidebar } from '@/components/file-tree-sidebar'
import type { PRFile } from '@/lib/github/types'
import {
  WORKER_POOL_OPTIONS,
  WORKER_HIGHLIGHTER_OPTIONS,
} from '@/lib/diffs/worker-pool'

const THEMES: ThemesType = {
  dark: 'github-dark-dimmed',
  light: 'github-light',
}

function getInitialThemeType(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function getIsNarrow(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 767px)').matches
}

const DIFF_OPTIONS: FileDiffOptions<undefined> = {
  theme: THEMES,
  themeType: getInitialThemeType(),
  diffStyle: 'split',
  diffIndicators: 'bars',
  hunkSeparators: 'line-info',
  lineDiffType: 'word-alt',
  expandUnchanged: true,
  overflow: 'scroll',
}

function getIsTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function LocalDiffView() {
  const isTauri = getIsTauri()
  const [leftPath, setLeftPath] = useState<string | null>(null)
  const [rightPath, setRightPath] = useState<string | null>(null)
  const [diffText, setDiffText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [visibleFiles, setVisibleFiles] = useState<Set<number>>(new Set([0, 1, 2]))

  useEffect(() => {
    preloadHighlighter({
      themes: [THEMES.dark, THEMES.light],
      langs: ['typescript', 'javascript', 'json', 'css', 'html', 'markdown', 'rust', 'yaml', 'toml'],
    })
  }, [])

  const pickLeft = useCallback(async () => {
    const selected = await open({ directory: true, title: 'Select Left (base) directory' })
    if (selected) setLeftPath(selected as string)
  }, [])

  const pickRight = useCallback(async () => {
    const selected = await open({ directory: true, title: 'Select Right (current) directory' })
    if (selected) setRightPath(selected as string)
  }, [])

  const runDiff = useCallback(async () => {
    if (!leftPath || !rightPath) return
    setLoading(true)
    setError(null)
    setDiffText(null)
    try {
      const result = await invoke<string>('local_diff', { left: leftPath, right: rightPath })
      if (!result || result.trim() === '') {
        setError('No differences found between the two directories.')
      } else {
        setDiffText(result)
        setVisibleFiles(new Set([0, 1, 2]))
      }
    } catch (err) {
      const msg = typeof err === 'string' ? err : err instanceof Error ? err.message : 'Unknown error'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }, [leftPath, rightPath])

  const parsedFiles = useMemo(() => {
    if (!diffText) return []
    const patches = parsePatchFiles(diffText)
    return patches.flatMap((patch) => patch.files)
  }, [diffText])

  const [isNarrow, setIsNarrow] = useState(getIsNarrow())
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const diffOptions = useMemo<FileDiffOptions<undefined>>(
    () => ({ ...DIFF_OPTIONS, diffStyle: isNarrow ? 'unified' : 'split' }),
    [isNarrow],
  )

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [viewedFiles, setViewedFiles] = useState<Set<string>>(new Set())

  const handleMarkViewed = useCallback((path: string) => {
    setViewedFiles((prev) => {
      if (prev.has(path)) return prev
      const next = new Set(prev)
      next.add(path)
      return next
    })
  }, [])

  const sidebarFiles: PRFile[] = useMemo(() => {
    return parsedFiles.map((file) => {
      const statusMap: Record<string, string> = {
        'new': 'added',
        'deleted': 'removed',
        'change': 'modified',
        'rename-pure': 'renamed',
        'rename-changed': 'renamed',
      }
      return {
        filename: file.name,
        status: statusMap[file.type] ?? 'modified',
        additions: 0,
        deletions: 0,
      }
    })
  }, [parsedFiles])

  const fileIndex = useMemo(
    () => new Map(parsedFiles.map((f, i) => [f.name, i])),
    [parsedFiles],
  )

  const handleScrollToFile = useCallback((path: string) => {
    const idx = fileIndex.get(path)
    if (idx != null) {
      setVisibleFiles((prev) => {
        const next = new Set(prev)
        next.add(idx)
        return next
      })
    }
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-diff-file="${path}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  }, [fileIndex])

  // Lazy loading via IntersectionObserver
  useEffect(() => {
    const container = scrollRef.current
    if (!container || !parsedFiles.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        const toAdd: number[] = []
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Number((entry.target as HTMLElement).dataset.idx)
            if (!isNaN(idx)) toAdd.push(idx)
            const path = (entry.target as HTMLElement).dataset.diffFile
            if (path) setActiveFile(path)
          }
        }
        if (toAdd.length > 0) {
          setVisibleFiles((prev) => {
            const next = new Set(prev)
            toAdd.forEach((i) => next.add(i))
            return next
          })
        }
      },
      { root: container, rootMargin: '200px 0px', threshold: [0] },
    )

    const elements = container.querySelectorAll('[data-idx]')
    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [parsedFiles])

  if (!leftPath || !rightPath || !diffText) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
        <div className="text-center space-y-2">
          <h2 className="text-lg font-semibold">Local Codebase Diff</h2>
          <p className="text-sm text-muted-foreground">
            Compare two local directories — respects .gitignore
          </p>
        </div>

        {!isTauri && (
          <p className="text-sm text-destructive text-center max-w-[320px]">
            Local Diff requires the desktop app.
          </p>
        )}

        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-2">
            <Button onClick={pickLeft} variant="outline" className="gap-2" disabled={!isTauri}>
              <FolderOpen className="size-4" />
              {leftPath ? 'Change' : 'Select Left'}
            </Button>
            {leftPath && (
              <span className="text-xs text-muted-foreground max-w-[200px] truncate" title={leftPath}>
                {leftPath.split('/').slice(-2).join('/')}
              </span>
            )}
          </div>

          <ArrowLeftRight className="size-5 text-muted-foreground" />

          <div className="flex flex-col items-center gap-2">
            <Button onClick={pickRight} variant="outline" className="gap-2" disabled={!isTauri}>
              <FolderOpen className="size-4" />
              {rightPath ? 'Change' : 'Select Right'}
            </Button>
            {rightPath && (
              <span className="text-xs text-muted-foreground max-w-[200px] truncate" title={rightPath}>
                {rightPath.split('/').slice(-2).join('/')}
              </span>
            )}
          </div>
        </div>

        {leftPath && rightPath && (
          <Button onClick={runDiff} disabled={loading || !isTauri} className="gap-2">
            {loading && <Loader2 className="size-4 animate-spin" />}
            {loading ? 'Diffing...' : 'Compare'}
          </Button>
        )}

        {error && (
          <p className="text-sm text-muted-foreground">{error}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      <FileTreeSidebar
        files={sidebarFiles}
        onSelectFile={handleScrollToFile}
        isOpen={sidebarOpen}
        activeFile={activeFile}
        viewedFiles={viewedFiles}
        onMarkViewed={handleMarkViewed}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 p-3 border-b bg-card">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 flex-shrink-0"
            onClick={() => setSidebarOpen((prev) => !prev)}
          >
            <PanelLeft className="size-4" />
          </Button>
          <span className="text-xs font-mono text-muted-foreground truncate" title={leftPath}>
            {leftPath.split('/').slice(-2).join('/')}
          </span>
          <ArrowLeftRight className="size-4 text-muted-foreground flex-shrink-0" />
          <span className="text-xs font-mono text-muted-foreground truncate" title={rightPath}>
            {rightPath.split('/').slice(-2).join('/')}
          </span>
          <span className="text-xs text-muted-foreground ml-auto">
            {parsedFiles.length} file{parsedFiles.length !== 1 ? 's' : ''} changed
          </span>
          <Button variant="outline" size="sm" onClick={runDiff} disabled={loading} className="gap-1">
            {loading && <Loader2 className="size-3 animate-spin" />}
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setDiffText(null); setVisibleFiles(new Set([0, 1, 2])) }}>
            Change dirs
          </Button>
        </div>
        <WorkerPoolContextProvider
          poolOptions={WORKER_POOL_OPTIONS}
          highlighterOptions={WORKER_HIGHLIGHTER_OPTIONS}
        >
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {parsedFiles.map((file, idx) => (
              <LazyLocalFile key={file.name} file={file} index={idx} visible={visibleFiles.has(idx)} options={diffOptions} />
            ))}
          </div>
        </WorkerPoolContextProvider>
      </div>
    </div>
  )
}

const LazyLocalFile = memo(function LazyLocalFile({ file, index, visible, options }: { file: FileDiffMetadata; index: number; visible: boolean; options: FileDiffOptions<undefined> }) {
  if (!visible) {
    return (
      <div data-idx={index} data-diff-file={file.name} className="border rounded overflow-hidden" style={{ minHeight: 60 }}>
        <div className="h-10 bg-muted/40 border-b flex items-center px-3">
          <span className="text-xs text-muted-foreground font-mono truncate">{file.name}</span>
        </div>
      </div>
    )
  }

  return (
    <div data-idx={index} data-diff-file={file.name}>
      <FileDiff fileDiff={file} options={options} />
    </div>
  )
})
