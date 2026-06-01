import { memo, useEffect, useRef, useMemo, useState, useCallback } from 'react'
import {
  usePRMetadata,
  usePRDiff,
  usePRFiles,
  usePRReviews,
  usePRComments,
  usePostComment,
} from '@/lib/github'
import { parsePatchFiles, preloadHighlighter } from '@pierre/diffs'
import { FileDiff, WorkerPoolContextProvider } from '@pierre/diffs/react'
import type {
  FileDiffMetadata,
  FileDiffOptions,
  ThemesType,
  DiffLineAnnotation,
} from '@pierre/diffs'
import {
  WORKER_POOL_OPTIONS,
  WORKER_HIGHLIGHTER_OPTIONS,
} from '@/lib/diffs/worker-pool'
import type { PRIdentifier } from '@/lib/github/parse-url'
import type { PRMetadata, PRReview, PRComment } from '@/lib/github/types'
import { toast } from 'sonner'
import { AlertTriangle, PanelLeft, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { FilePalette } from '@/components/file-palette'
import { ShortcutsHelp } from '@/components/shortcuts-help'
import { FileTreeSidebar } from '@/components/file-tree-sidebar'

interface ActiveComment {
  file: string
  line: number
  side: 'additions' | 'deletions'
}

interface CommentFormMarker {
  _type: 'comment-form'
  file: string
  line: number
  side: 'additions' | 'deletions'
}

interface ReplyFormMarker {
  _type: 'reply-form'
  parentId: number
  file: string
  line: number
  side: 'additions' | 'deletions'
}

interface AnnotationPayload {
  comment?: PRComment
  form?: CommentFormMarker
  reply?: ReplyFormMarker
}

interface ReviewViewProps {
  pr: PRIdentifier | null
}

const EMPTY_COMMENTS: PRComment[] = []

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

const DIFF_OPTIONS: FileDiffOptions<AnnotationPayload> = {
  theme: THEMES,
  themeType: getInitialThemeType(),
  diffStyle: 'split',
  diffIndicators: 'bars',
  hunkSeparators: 'line-info',
  lineDiffType: 'word-alt',
  expandUnchanged: true,
  overflow: 'scroll',
}

export function ReviewView({ pr }: ReviewViewProps) {
  useEffect(() => {
    preloadHighlighter({
      themes: [THEMES.dark, THEMES.light],
      langs: [
        'typescript',
        'javascript',
        'json',
        'css',
        'html',
        'markdown',
        'rust',
        'yaml',
        'toml',
      ],
    })
  }, [])

  if (!pr) {
    return (
      <div className="text-muted-foreground flex items-center justify-center h-full">
        Paste a PR URL above to start reviewing
      </div>
    )
  }

  return <ReviewContent pr={pr} />
}

function ReviewContent({ pr }: { pr: PRIdentifier }) {
  const { owner, repo, number } = pr
  const metadata = usePRMetadata(owner, repo, number)
  const diff = usePRDiff(owner, repo, number)
  const files = usePRFiles(owner, repo, number)
  const reviews = usePRReviews(owner, repo, number)
  const comments = usePRComments(owner, repo, number)
  const postComment = usePostComment(owner, repo, number)

  const [activeComment, setActiveComment] = useState<ActiveComment | null>(null)
  const [activeReply, setActiveReply] = useState<{
    file: string
    line: number
    side: 'additions' | 'deletions'
    parentId: number
  } | null>(null)

  const [themeType, setThemeType] = useState(getInitialThemeType())
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) =>
      setThemeType(e.matches ? 'dark' : 'light')
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const [isNarrow, setIsNarrow] = useState(getIsNarrow())
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)')
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  const diffOptions = useMemo<FileDiffOptions<AnnotationPayload>>(
    () => ({
      ...DIFF_OPTIONS,
      themeType,
      diffStyle: isNarrow ? 'unified' : 'split',
    }),
    [themeType, isNarrow],
  )

  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [filePaletteOpen, setFilePaletteOpen] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const userToggledSidebar = useRef(false)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isScrollingFromTreeRef = useRef(false)

  useEffect(() => {
    if (!userToggledSidebar.current && files.data && files.data.length > 3) {
      setSidebarOpen(true)
    }
  }, [files.data])

  const storageKey = `reviews-plus:viewed:${owner}/${repo}/${number}`
  const [viewedFiles, setViewedFiles] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      if (saved) return new Set(JSON.parse(saved) as string[])
    } catch {
      // ignore
    }
    return new Set()
  })

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify([...viewedFiles]))
  }, [viewedFiles, storageKey])

  const handleMarkViewed = useCallback((path: string) => {
    setViewedFiles((prev) => {
      if (prev.has(path)) return prev
      const next = new Set(prev)
      next.add(path)
      return next
    })
  }, [])

  const parsedFiles = useMemo(() => {
    if (!diff.data) return []
    const patches = parsePatchFiles(diff.data)
    return patches.flatMap((patch) => patch.files)
  }, [diff.data])

  const fileComments = useMemo(() => comments.data ?? [], [comments.data])

  const commentsByPath = useMemo(() => {
    const m = new Map<string, PRComment[]>()
    for (const c of fileComments) {
      const a = m.get(c.path) ?? []
      a.push(c)
      m.set(c.path, a)
    }
    return m
  }, [fileComments])

  const fileIndex = useMemo(
    () => new Map(parsedFiles.map((f, i) => [f.name, i])),
    [parsedFiles],
  )

  // Lazy rendering: only mount files within viewport proximity
  const [visibleFiles, setVisibleFiles] = useState<Set<number>>(() => new Set([0, 1, 2]))

  useEffect(() => {
    setVisibleFiles(new Set([0, 1, 2]))
  }, [parsedFiles])

  const handleStartComment = useCallback(
    (file: string, line: number, side: 'additions' | 'deletions') => {
      setActiveReply(null)
      setActiveComment({ file, line, side })
    },
    [],
  )

  const handleStartReply = useCallback(
    (file: string, line: number, side: 'additions' | 'deletions', parentId: number) => {
      setActiveComment(null)
      setActiveReply({ file, line, side, parentId })
    },
    [],
  )

  const handleCancelComment = useCallback(() => {
    setActiveComment(null)
    setActiveReply(null)
  }, [])

  const handleSubmitComment = useCallback(
    (body: string, path: string, line: number, side: 'additions' | 'deletions') => {
      if (!metadata.data) return
      const ghSide = side === 'deletions' ? 'LEFT' : 'RIGHT'
      postComment.mutate(
        {
          body,
          path,
          line,
          commit_id: metadata.data.head.sha,
          side: ghSide,
        },
        {
          onSuccess: () => {
            setActiveComment(null)
            toast.success('Comment posted')
          },
          onError: (err) => {
            toast.error(`Failed to post comment: ${err.message}`)
          },
        },
      )
    },
    [metadata.data, postComment],
  )

  const handleSubmitReply = useCallback(
    (body: string, path: string, line: number, side: 'additions' | 'deletions', parentId: number) => {
      if (!metadata.data) return
      const ghSide = side === 'deletions' ? 'LEFT' : 'RIGHT'
      postComment.mutate(
        {
          body,
          path,
          line,
          commit_id: metadata.data.head.sha,
          side: ghSide,
          in_reply_to: parentId,
        },
        {
          onSuccess: () => {
            setActiveReply(null)
            toast.success('Reply posted')
          },
          onError: (err) => {
            toast.error(`Failed to post reply: ${err.message}`)
          },
        },
      )
    },
    [metadata.data, postComment],
  )

  const scrollToFileByIndex = useCallback((index: number) => {
    const el = scrollContainerRef.current?.querySelector(`[data-diff-file-idx="${index}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const scrollToFileByName = useCallback((filename: string) => {
    const el = scrollContainerRef.current?.querySelector(`[data-diff-file="${CSS.escape(filename)}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const idx = fileIndex.get(filename)
      if (idx != null) setCurrentFileIndex(idx)
    }
  }, [fileIndex])

  const handleScrollToFile = useCallback((path: string) => {
    const idx = fileIndex.get(path)
    if (idx != null) {
      setVisibleFiles((prev) => {
        const next = new Set(prev)
        next.add(idx)
        return next
      })
    }
    isScrollingFromTreeRef.current = true
    requestAnimationFrame(() => {
      const el = scrollContainerRef.current?.querySelector(`[data-diff-file="${CSS.escape(path)}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      setTimeout(() => {
        isScrollingFromTreeRef.current = false
      }, 500)
    })
  }, [fileIndex])

  const shortcuts = useMemo(
    () => [
      {
        key: 'j',
        ignoreInput: true,
        handler: () => {
          const nextIndex = Math.min(currentFileIndex + 1, parsedFiles.length - 1)
          setCurrentFileIndex(nextIndex)
          setVisibleFiles((prev) => { const n = new Set(prev); n.add(nextIndex); return n })
          requestAnimationFrame(() => scrollToFileByIndex(nextIndex))
        },
      },
      {
        key: 'k',
        ignoreInput: true,
        handler: () => {
          const prevIndex = Math.max(currentFileIndex - 1, 0)
          setCurrentFileIndex(prevIndex)
          setVisibleFiles((prev) => { const n = new Set(prev); n.add(prevIndex); return n })
          requestAnimationFrame(() => scrollToFileByIndex(prevIndex))
        },
      },
      {
        key: 'c',
        ignoreInput: true,
        handler: () => {
          const file = parsedFiles[currentFileIndex]
          if (!file) return
          setVisibleFiles((prev) => {
            const n = new Set(prev)
            n.add(currentFileIndex)
            return n
          })
          requestAnimationFrame(() => scrollToFileByIndex(currentFileIndex))
          handleStartComment(file.name, findFirstAddedLine(file), 'additions')
        },
      },
      {
        key: 'p',
        metaKey: true,
        handler: () => setFilePaletteOpen(true),
      },
      {
        key: 'b',
        metaKey: true,
        handler: () => {
          userToggledSidebar.current = true
          setSidebarOpen((prev) => !prev)
        },
      },
      {
        key: '?',
        ignoreInput: true,
        handler: () => setShowHelp((prev) => !prev),
      },
    ],
    [currentFileIndex, parsedFiles, scrollToFileByIndex, handleStartComment],
  )

  useKeyboardShortcuts(shortcuts)

  // Single IntersectionObserver: lazy-loads files, tracks active file, and
  // auto-marks viewed after 2s visibility — all on the same elements.
  const visibilityTimers = useRef<Map<string, number>>(new Map())
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !parsedFiles.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        const toAdd: number[] = []
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          if (entry.isIntersecting) {
            const idx = Number(el.dataset.diffFileIdx)
            if (!isNaN(idx)) toAdd.push(idx)
          }

          const path = el.dataset.diffFile
          if (path) {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.3) {
              if (!visibilityTimers.current.has(path)) {
                const timer = window.setTimeout(() => {
                  handleMarkViewed(path)
                  visibilityTimers.current.delete(path)
                }, 2000)
                visibilityTimers.current.set(path, timer)
              }
            } else {
              const timer = visibilityTimers.current.get(path)
              if (timer != null) {
                window.clearTimeout(timer)
                visibilityTimers.current.delete(path)
              }
            }
          }
        }
        if (toAdd.length > 0) {
          setVisibleFiles((prev) => {
            const next = new Set(prev)
            toAdd.forEach((i) => next.add(i))
            return next
          })
        }

        if (!isScrollingFromTreeRef.current) {
          for (const entry of entries) {
            if (entry.isIntersecting && entry.intersectionRatio > 0.1) {
              const path = (entry.target as HTMLElement).dataset.diffFile
              if (path) {
                setActiveFile(path)
                break
              }
            }
          }
        }
      },
      { root: container, rootMargin: '200px 0px', threshold: [0, 0.1, 0.3] },
    )

    const elements = container.querySelectorAll('[data-diff-file-idx]')
    elements.forEach((el) => observer.observe(el))

    const timers = visibilityTimers.current
    return () => {
      observer.disconnect()
      timers.forEach((t) => window.clearTimeout(t))
      timers.clear()
    }
  }, [parsedFiles, handleMarkViewed])

  if (metadata.isLoading || diff.isLoading) {
    return <DiffLoadingSkeleton />
  }

  if (metadata.error || diff.error) {
    const error = metadata.error ?? diff.error
    return (
      <ErrorCard
        error={error}
        onRetry={() => {
          metadata.refetch()
          diff.refetch()
        }}
      />
    )
  }

  return (
    <>
      <div className="flex h-full overflow-hidden">
        <FileTreeSidebar
          files={files.data ?? []}
          onSelectFile={handleScrollToFile}
          isOpen={sidebarOpen}
          activeFile={activeFile}
          viewedFiles={viewedFiles}
          onMarkViewed={handleMarkViewed}
        />
        <div className="flex-1 flex flex-col overflow-hidden">
          {metadata.data && (
            <PRHeader
              metadata={metadata.data}
              reviews={reviews.data}
              fileCount={files.data?.length ?? metadata.data.changed_files}
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => {
                userToggledSidebar.current = true
                setSidebarOpen((prev) => !prev)
              }}
            />
          )}
          <WorkerPoolContextProvider
            poolOptions={WORKER_POOL_OPTIONS}
            highlighterOptions={WORKER_HIGHLIGHTER_OPTIONS}
          >
            <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
              {parsedFiles.map((file, idx) => (
                <LazyFileDiff
                  key={file.name}
                  file={file}
                  index={idx}
                  visible={visibleFiles.has(idx)}
                  options={diffOptions}
                  comments={commentsByPath.get(file.name) ?? EMPTY_COMMENTS}
                  activeComment={activeComment}
                  activeReply={activeReply}
                  onStartComment={handleStartComment}
                  onStartReply={handleStartReply}
                  onCancelComment={handleCancelComment}
                  onSubmitComment={handleSubmitComment}
                  onSubmitReply={handleSubmitReply}
                  isSubmitting={postComment.isPending}
                />
              ))}
            </div>
          </WorkerPoolContextProvider>
        </div>
      </div>

      <FilePalette
        open={filePaletteOpen}
        onOpenChange={setFilePaletteOpen}
        files={files.data ?? []}
        onSelectFile={scrollToFileByName}
      />

      <ShortcutsHelp visible={showHelp} />
    </>
  )
}

const LazyFileDiff = memo(function LazyFileDiff({
  file,
  index,
  visible,
  options,
  comments,
  activeComment,
  activeReply,
  onStartComment,
  onStartReply,
  onCancelComment,
  onSubmitComment,
  onSubmitReply,
  isSubmitting,
}: {
  file: FileDiffMetadata
  index: number
  visible: boolean
  options: FileDiffOptions<AnnotationPayload>
  comments: PRComment[]
  activeComment: ActiveComment | null
  activeReply: { file: string; line: number; side: 'additions' | 'deletions'; parentId: number } | null
  onStartComment: (file: string, line: number, side: 'additions' | 'deletions') => void
  onStartReply: (file: string, line: number, side: 'additions' | 'deletions', parentId: number) => void
  onCancelComment: () => void
  onSubmitComment: (body: string, path: string, line: number, side: 'additions' | 'deletions') => void
  onSubmitReply: (body: string, path: string, line: number, side: 'additions' | 'deletions', parentId: number) => void
  isSubmitting: boolean
}) {
  const annotations = useMemo(() =>
    buildAnnotationsForFile(file.name, comments, activeComment, activeReply),
    [file.name, comments, activeComment, activeReply],
  )

  const renderAnnotation = useCallback(
    (annotation: DiffLineAnnotation<AnnotationPayload>) => {
      const payload = annotation.metadata
      if (!payload) return null

      if (payload.form) {
        return (
          <CommentForm
            onSubmit={(body) => onSubmitComment(body, payload.form!.file, payload.form!.line, payload.form!.side)}
            onCancel={onCancelComment}
            isSubmitting={isSubmitting}
            placeholder="Add a comment..."
          />
        )
      }

      if (payload.reply) {
        return (
          <CommentForm
            onSubmit={(body) => onSubmitReply(body, payload.reply!.file, payload.reply!.line, payload.reply!.side, payload.reply!.parentId)}
            onCancel={onCancelComment}
            isSubmitting={isSubmitting}
            placeholder="Reply..."
          />
        )
      }

      if (payload.comment) {
        const comment = payload.comment
        const side = comment.side === 'LEFT' ? 'deletions' as const : 'additions' as const
        return (
          <ExistingComment
            comment={comment}
            onReply={() => onStartReply(comment.path, comment.line!, side, comment.id)}
          />
        )
      }

      return null
    },
    [onSubmitComment, onSubmitReply, onCancelComment, onStartReply, isSubmitting],
  )

  const renderGutterUtility = useCallback(
    (getHoveredLine: () => { lineNumber: number; side: string } | undefined) => (
      <button
        className="diffs-gutter-add-comment"
        onClick={(e) => {
          e.stopPropagation()
          const hovered = getHoveredLine()
          if (hovered) {
            onStartComment(file.name, hovered.lineNumber, hovered.side as 'additions' | 'deletions')
          }
        }}
      >
        +
      </button>
    ),
    [onStartComment, file.name],
  )

  if (!visible) {
    return (
      <div
        data-diff-file={file.name}
        data-diff-file-idx={index}
        className="border rounded overflow-hidden"
        style={{ minHeight: 60 }}
      >
        <div className="h-10 bg-muted/40 border-b flex items-center px-3 gap-2">
          <span className="text-xs text-muted-foreground font-mono truncate">{file.name}</span>
        </div>
      </div>
    )
  }

  return (
    <div data-diff-file={file.name} data-diff-file-idx={index}>
      <FileDiff<AnnotationPayload>
        fileDiff={file}
        options={options}
        lineAnnotations={annotations}
        renderAnnotation={renderAnnotation}
        renderGutterUtility={renderGutterUtility}
      />
    </div>
  )
})

function PRHeader({
  metadata,
  reviews,
  fileCount,
  sidebarOpen,
  onToggleSidebar,
}: {
  metadata: PRMetadata
  reviews: PRReview[] | undefined
  fileCount: number
  sidebarOpen: boolean
  onToggleSidebar: () => void
}) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-center gap-3 mb-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 flex-shrink-0"
          onClick={onToggleSidebar}
          title={sidebarOpen ? 'Hide sidebar (⌘B)' : 'Show sidebar (⌘B)'}
        >
          <PanelLeft className="size-4" />
        </Button>
        <img
          src={metadata.user.avatar_url}
          alt={metadata.user.login}
          className="w-8 h-8 rounded-full"
        />
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold truncate">{metadata.title}</h1>
          <p className="text-sm text-muted-foreground">
            {metadata.user.login} wants to merge into{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              {metadata.base.ref}
            </code>
            {' '}from{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              {metadata.head.ref}
            </code>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 gap-y-2 text-sm">
        <span className="text-green-600 font-medium">
          +{metadata.additions}
        </span>
        <span className="text-red-600 font-medium">
          -{metadata.deletions}
        </span>
        <span className="text-muted-foreground">
          {fileCount} file{fileCount !== 1 ? 's' : ''} changed
        </span>

        {reviews && reviews.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 gap-y-2 ml-auto">
            {reviews.map((review) => (
              <ReviewBadge key={review.id} review={review} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ReviewBadge({ review }: { review: PRReview }) {
  const stateStyles: Record<string, string> = {
    APPROVED: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    CHANGES_REQUESTED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    COMMENTED: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
    DISMISSED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    PENDING: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  }

  const style = stateStyles[review.state] ?? stateStyles.COMMENTED

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${style}`}>
      <img
        src={review.user.avatar_url}
        alt={review.user.login}
        className="w-4 h-4 rounded-full"
      />
      {review.state.toLowerCase().replace('_', ' ')}
    </span>
  )
}

function buildAnnotationsForFile(
  filename: string,
  comments: PRComment[],
  activeComment: ActiveComment | null,
  activeReply: { file: string; line: number; side: 'additions' | 'deletions'; parentId: number } | null,
): DiffLineAnnotation<AnnotationPayload>[] {
  const annotations: DiffLineAnnotation<AnnotationPayload>[] = comments
    .filter((c) => c.line !== null)
    .map((comment) => ({
      side: comment.side === 'LEFT' ? 'deletions' as const : 'additions' as const,
      lineNumber: comment.line!,
      metadata: { comment },
    }))

  if (activeComment && activeComment.file === filename) {
    annotations.push({
      side: activeComment.side,
      lineNumber: activeComment.line,
      metadata: {
        form: {
          _type: 'comment-form',
          file: activeComment.file,
          line: activeComment.line,
          side: activeComment.side,
        },
      },
    })
  }

  if (activeReply && activeReply.file === filename) {
    annotations.push({
      side: activeReply.side,
      lineNumber: activeReply.line,
      metadata: {
        reply: {
          _type: 'reply-form',
          parentId: activeReply.parentId,
          file: activeReply.file,
          line: activeReply.line,
          side: activeReply.side,
        },
      },
    })
  }

  return annotations
}

function findFirstAddedLine(file: FileDiffMetadata | undefined): number {
  if (!file) return 1
  for (const hunk of file.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type === 'change' && content.additions > 0) {
        return hunk.additionStart + (content.additionLineIndex - hunk.additionLineIndex)
      }
    }
  }
  return 1
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function CommentForm({
  onSubmit,
  onCancel,
  isSubmitting,
  placeholder,
}: {
  onSubmit: (body: string) => void
  onCancel: () => void
  isSubmitting: boolean
  placeholder: string
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  return (
    <div className="diffs-comment-form">
      <textarea
        ref={textareaRef}
        className="diffs-comment-textarea"
        placeholder={placeholder}
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            const value = textareaRef.current?.value.trim()
            if (value) onSubmit(value)
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <div className="diffs-comment-form-buttons">
        <button className="diffs-comment-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="diffs-comment-submit-btn"
          disabled={isSubmitting}
          onClick={() => {
            const value = textareaRef.current?.value.trim()
            if (value) onSubmit(value)
          }}
        >
          {isSubmitting ? 'Posting...' : 'Comment'}
        </button>
      </div>
    </div>
  )
}

function ExistingComment({
  comment,
  onReply,
}: {
  comment: PRComment
  onReply: () => void
}) {
  return (
    <div
      className="diffs-existing-comment"
      style={comment.in_reply_to_id ? { marginLeft: 16, borderLeftWidth: 3 } : undefined}
    >
      <div className="diffs-comment-header">
        <img src={comment.user.avatar_url} alt={comment.user.login} className="diffs-comment-avatar" />
        <span className="diffs-comment-author">{comment.user.login}</span>
        <span className="diffs-comment-time">{formatRelativeTime(comment.created_at)}</span>
      </div>
      <div className="diffs-comment-body">{comment.body}</div>
      {!comment.in_reply_to_id && (
        <button className="diffs-reply-btn" onClick={onReply}>
          Reply
        </button>
      )}
    </div>
  )
}

function DiffLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="animate-pulse border rounded-lg p-4 bg-card">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-5 bg-muted rounded w-2/3" />
            <div className="h-3 bg-muted rounded w-1/3" />
          </div>
        </div>
        <div className="flex gap-4">
          <div className="h-4 bg-muted rounded w-12" />
          <div className="h-4 bg-muted rounded w-12" />
          <div className="h-4 bg-muted rounded w-24" />
        </div>
      </div>

      {[280, 180, 220].map((height, i) => (
        <div key={i} className="animate-pulse border rounded overflow-hidden">
          <div className="h-10 bg-muted/70 border-b flex items-center px-3 gap-2">
            <div className="h-3 bg-muted rounded w-48" />
          </div>
          <div className="space-y-px">
            {Array.from({ length: Math.floor(height / 24) }).map((_, j) => (
              <div key={j} className="flex h-6">
                <div className="w-12 bg-muted/30" />
                <div className="flex-1 bg-muted/20 px-2 flex items-center">
                  <div
                    className="h-3 bg-muted/50 rounded"
                    style={{ width: `${30 + Math.random() * 50}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function getErrorDetails(error: unknown): {
  message: string
  showSettings: boolean
  retryDelay?: string
} {
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'

  if (/token.*invalid|token.*expired|unauthorized|401/i.test(msg)) {
    return {
      message: 'Token invalid or expired. Update your token in Settings.',
      showSettings: true,
    }
  }

  if (/rate.?limit|403/i.test(msg)) {
    return {
      message: 'Rate limited by GitHub. Try again in a few minutes.',
      showSettings: false,
      retryDelay: '5 minutes',
    }
  }

  if (/not.?found|404/i.test(msg)) {
    return {
      message: 'PR not found. Check the URL and try again.',
      showSettings: false,
    }
  }

  return { message: msg, showSettings: false }
}

function ErrorCard({
  error,
  onRetry,
}: {
  error: unknown
  onRetry: () => void
}) {
  const details = getErrorDetails(error)

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="w-full max-w-md border rounded-lg p-6 bg-card space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="size-6 text-destructive" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Failed to load PR</h2>
          <p className="text-sm text-muted-foreground">{details.message}</p>
        </div>
        <div className="flex items-center justify-center gap-2">
          <Button onClick={onRetry} variant="outline" size="sm">
            Retry
          </Button>
          {details.showSettings && (
            <Button variant="ghost" size="sm" asChild>
              <a href="#settings">
                <Settings className="size-4" />
                Go to Settings
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
