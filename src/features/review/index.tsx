import { useEffect, useLayoutEffect, useRef, useMemo, useState, useCallback } from 'react'
import {
  usePRMetadata,
  usePRDiff,
  usePRFiles,
  usePRReviews,
  usePRComments,
  usePRReviewThreads,
  usePostComment,
  useResolveThread,
  useUnresolveThread,
  useCurrentUser,
  useEditComment,
  useDeleteComment,
  useSubmitReview,
  useChecks,
  aggregateChecks,
  useEditPRBody,
} from '@/lib/github'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { MergedCheckRun } from '@/lib/github'
import { parsePatchFiles, preloadHighlighter } from '@pierre/diffs'
import { CodeView, WorkerPoolContextProvider } from '@pierre/diffs/react'
import type {
  CodeViewHandle,
  CodeViewItem,
  CodeViewDiffItem,
  CodeViewScrollTarget,
} from '@pierre/diffs/react'
import type {
  FileDiffMetadata,
  CodeViewOptions,
  OnDiffLineClickProps,
  GetHoveredLineResult,
  ThemesType,
  DiffLineAnnotation,
  SelectedLineRange,
} from '@pierre/diffs'

type CodeViewInstance = NonNullable<
  ReturnType<CodeViewHandle<AnnotationPayload>['getInstance']>
>

type GutterHoveredLine =
  | GetHoveredLineResult<'file'>
  | GetHoveredLineResult<'diff'>
import {
  WORKER_POOL_OPTIONS,
  WORKER_HIGHLIGHTER_OPTIONS,
} from '@/lib/diffs/worker-pool'
import type { PRIdentifier } from '@/lib/github/parse-url'
import type { PRMetadata, PRReview, PRComment, PRFile } from '@/lib/github/types'
import type { SubmitReviewParams, PendingReviewComment } from '@/lib/github/queries'
import { toast } from 'sonner'
import {
  AlertTriangle,
  MessageSquare,
  PanelLeft,
  Settings,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
  Circle,
  ExternalLink,
} from 'lucide-react'
import { Collapsible, Popover, RadioGroup } from 'radix-ui'
import { Button } from '@/components/ui/button'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { FilePalette } from '@/components/file-palette'
import { ShortcutsHelp } from '@/components/shortcuts-help'
import { FileTreeSidebar } from '@/components/file-tree-sidebar'
import { CommentsPanel } from '@/components/comments-panel'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import type { ImperativePanelHandle } from 'react-resizable-panels'

interface ActiveComment {
  file: string
  line: number
  side: 'additions' | 'deletions'
  startLine?: number
  startSide?: 'additions' | 'deletions'
}

// A staged (pending) comment that will be submitted as part of a review
interface PendingComment {
  path: string
  line: number
  side: 'additions' | 'deletions'
  body: string
  startLine?: number
  startSide?: 'additions' | 'deletions'
}

// Stable key for deduplicating pending comments
function pendingCommentKey(c: Pick<PendingComment, 'path' | 'line' | 'side'>): string {
  return `${c.path}:${c.line}:${c.side}`
}

interface CommentFormMarker {
  _type: 'comment-form'
  file: string
  line: number
  side: 'additions' | 'deletions'
  startLine?: number
  startSide?: 'additions' | 'deletions'
}

interface PendingAnnotationMarker {
  _type: 'pending'
  comment: PendingComment
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
  pending?: PendingAnnotationMarker
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

const DIFF_OPTIONS: CodeViewOptions<AnnotationPayload> = {
  theme: THEMES,
  themeType: getInitialThemeType(),
  diffStyle: 'split',
  diffIndicators: 'bars',
  hunkSeparators: 'line-info',
  lineDiffType: 'word-alt',
  expandUnchanged: true,
  overflow: 'scroll',
  stickyHeaders: true,
  enableLineSelection: true,
  lineHoverHighlight: 'number',
  layout: { gap: 16, paddingTop: 0, paddingBottom: 0 },
}

type CommentSide = 'additions' | 'deletions'

function resolveSelectionRange(range: SelectedLineRange): {
  line: number
  side: CommentSide
  startLine: number
  startSide: CommentSide
} {
  const startSide = range.side ?? 'additions'
  const endSide = range.endSide ?? startSide
  if (range.end >= range.start) {
    return { startLine: range.start, startSide, line: range.end, side: endSide }
  }
  return { startLine: range.end, startSide: endSide, line: range.start, side: startSide }
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
  const reviewThreads = usePRReviewThreads(owner, repo, number)
  const postComment = usePostComment(owner, repo, number)
  const resolveThread = useResolveThread(owner, repo, number)
  const unresolveThread = useUnresolveThread(owner, repo, number)
  const currentUser = useCurrentUser()
  const editComment = useEditComment(owner, repo, number)
  const deleteComment = useDeleteComment(owner, repo, number)
  const submitReview = useSubmitReview(owner, repo, number)
  const editPRBody = useEditPRBody(owner, repo, number)
  const headSha = metadata.data?.head.sha ?? ''
  const checks = useChecks(owner, repo, headSha)

  const canEditDescription =
    !!currentUser.data?.login &&
    currentUser.data.login === metadata.data?.user.login

  const [activeComment, setActiveComment] = useState<ActiveComment | null>(null)
  const [activeReply, setActiveReply] = useState<{
    file: string
    line: number
    side: 'additions' | 'deletions'
    parentId: number
  } | null>(null)

  const [pendingComments, setPendingComments] = useState<PendingComment[]>([])

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

  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [filePaletteOpen, setFilePaletteOpen] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [commentsPanelOpen, setCommentsPanelOpen] = useState(false)
  const userToggledSidebar = useRef(false)
  const leftPanelRef = useRef<ImperativePanelHandle>(null)
  const rightPanelRef = useRef<ImperativePanelHandle>(null)
  // Whether react-resizable-panels has a persisted layout from a previous
  // visit. If so, we respect it instead of forcing the file tree open.
  const hasPersistedLayout = useRef(
    typeof window !== 'undefined' &&
      window.localStorage.getItem(
        'react-resizable-panels:reviews-plus:review-panels',
      ) != null,
  )
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const codeViewRef = useRef<CodeViewHandle<AnnotationPayload>>(null)
  const isScrollingFromTreeRef = useRef(false)

  // Sync panel-open state to whatever react-resizable-panels restored from its
  // persisted layout on mount (onExpand/onCollapse don't fire for the initial
  // restored layout).
  useLayoutEffect(() => {
    setSidebarOpen(!(leftPanelRef.current?.isCollapsed() ?? true))
    setCommentsPanelOpen(!(rightPanelRef.current?.isCollapsed() ?? true))
  }, [])

  useEffect(() => {
    if (
      !hasPersistedLayout.current &&
      !userToggledSidebar.current &&
      files.data &&
      files.data.length > 3
    ) {
      leftPanelRef.current?.expand()
    }
  }, [files.data])

  const toggleSidebar = useCallback(() => {
    userToggledSidebar.current = true
    const panel = leftPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }, [])

  const toggleCommentsPanel = useCallback(() => {
    const panel = rightPanelRef.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }, [])

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

  // Tree mirrors the rendered diff exactly (built from parsedFiles, enriched with
  // REST stats when available) so the file list always matches what's scrollable.
  const treeFiles = useMemo<PRFile[]>(() => {
    const byName = new Map((files.data ?? []).map((f) => [f.filename, f]))
    return parsedFiles.map((pf) => {
      const existing = byName.get(pf.name)
      if (existing) return existing
      return {
        filename: pf.name,
        status: pf.prevName ? 'renamed' : 'modified',
        additions: 0,
        deletions: 0,
      } satisfies PRFile
    })
  }, [parsedFiles, files.data])

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

  // GraphQL reviewThreads carry resolved/outdated state keyed by each comment's
  // databaseId, which equals the REST comment id. Derive id->state maps rather
  // than denormalizing onto PRComment so the REST shape stays untouched.
  const threadStateById = useMemo(() => {
    const resolved = new Map<number, boolean>()
    const outdated = new Map<number, boolean>()
    const threadIdByRootId = new Map<number, string>()
    for (const thread of reviewThreads.data ?? []) {
      const firstId = thread.comments.nodes[0]?.databaseId
      for (const node of thread.comments.nodes) {
        if (node.databaseId == null) continue
        resolved.set(node.databaseId, thread.isResolved)
        outdated.set(node.databaseId, thread.isOutdated)
      }
      if (firstId != null && thread.id) {
        threadIdByRootId.set(firstId, thread.id)
      }
    }
    return { resolved, outdated, threadIdByRootId }
  }, [reviewThreads.data])

  const fileNameOrder = useMemo(() => parsedFiles.map((f) => f.name), [parsedFiles])

  const annotationsByFile = useMemo(() => {
    const m = new Map<string, DiffLineAnnotation<AnnotationPayload>[]>()
    for (const file of parsedFiles) {
      m.set(
        file.name,
        buildAnnotationsForFile(
          file.name,
          commentsByPath.get(file.name) ?? EMPTY_COMMENTS,
          activeComment,
          activeReply,
          pendingComments.filter((c) => c.path === file.name),
        ),
      )
    }
    return m
  }, [parsedFiles, commentsByPath, activeComment, activeReply, pendingComments])

  // Per-file version bumped only when that file's annotations change, so
  // CodeView keeps the cached record snapshot for unchanged files.
  const versionRef = useRef(
    new Map<string, { version: number; snapshot: DiffLineAnnotation<AnnotationPayload>[] }>(),
  )

  const items = useMemo<CodeViewDiffItem<AnnotationPayload>[]>(() => {
    return parsedFiles.map((file) => {
      const annotations = annotationsByFile.get(file.name) ?? []
      const entry = versionRef.current.get(file.name)
      let version: number
      if (!entry || !areAnnotationsEqual(entry.snapshot, annotations)) {
        version = (entry?.version ?? 0) + 1
        versionRef.current.set(file.name, { version, snapshot: annotations })
      } else {
        version = entry.version
      }
      return {
        id: file.name,
        type: 'diff' as const,
        fileDiff: file,
        annotations,
        version,
      }
    })
  }, [parsedFiles, annotationsByFile])

  const handleStartComment = useCallback(
    (file: string, line: number, side: 'additions' | 'deletions') => {
      setActiveReply(null)
      const selection = codeViewRef.current?.getSelectedLines()
      if (selection && selection.id === file && selection.range.start !== selection.range.end) {
        const r = resolveSelectionRange(selection.range)
        setActiveComment({ file, line: r.line, side: r.side, startLine: r.startLine, startSide: r.startSide })
      } else {
        setActiveComment({ file, line, side })
      }
    },
    [],
  )

  const diffOptions = useMemo<CodeViewOptions<AnnotationPayload>>(
    () => ({
      ...DIFF_OPTIONS,
      themeType,
      diffStyle: isNarrow ? 'unified' : 'split',
      onLineNumberClick: ((props: OnDiffLineClickProps, context: { item: { id: string } }) =>
        handleStartComment(context.item.id, props.lineNumber, props.annotationSide)
      ) as unknown as CodeViewOptions<AnnotationPayload>['onLineNumberClick'],
    }),
    [themeType, isNarrow, handleStartComment],
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
    (
      body: string,
      path: string,
      line: number,
      side: 'additions' | 'deletions',
      startLine?: number,
      startSide?: 'additions' | 'deletions',
    ) => {
      if (!metadata.data) return
      const ghSide = side === 'deletions' ? 'LEFT' : 'RIGHT'
      const hasRange = startLine != null && startLine !== line
      postComment.mutate(
        {
          body,
          path,
          line,
          commit_id: metadata.data.head.sha,
          side: ghSide,
          ...(hasRange
            ? {
                start_line: startLine,
                start_side: (startSide ?? side) === 'deletions' ? 'LEFT' : 'RIGHT',
              }
            : {}),
        },
        {
          onSuccess: () => {
            setActiveComment(null)
            codeViewRef.current?.clearSelectedLines()
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

  const handleAddPendingComment = useCallback(
    (
      body: string,
      path: string,
      line: number,
      side: 'additions' | 'deletions',
      startLine?: number,
      startSide?: 'additions' | 'deletions',
    ) => {
      setPendingComments((prev) => {
        const key = pendingCommentKey({ path, line, side })
        const without = prev.filter((c) => pendingCommentKey(c) !== key)
        return [...without, { path, line, side, body, startLine, startSide }]
      })
      setActiveComment(null)
      codeViewRef.current?.clearSelectedLines()
      toast.success('Comment staged for review')
    },
    [],
  )

  const handleDiscardPendingComment = useCallback((c: PendingComment) => {
    setPendingComments((prev) =>
      prev.filter((p) => pendingCommentKey(p) !== pendingCommentKey(c)),
    )
  }, [])

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

  const handlePanelReply = useCallback(
    async (
      rootId: number,
      path: string,
      line: number,
      side: 'additions' | 'deletions',
      body: string,
    ) => {
      if (!metadata.data) return
      const ghSide = side === 'deletions' ? 'LEFT' : 'RIGHT'
      try {
        await postComment.mutateAsync({
          body,
          path,
          line,
          commit_id: metadata.data.head.sha,
          side: ghSide,
          in_reply_to: rootId,
        })
        toast.success('Reply posted')
      } catch (err) {
        toast.error(`Failed to post reply: ${(err as Error).message}`)
        throw err
      }
    },
    [metadata.data, postComment],
  )

  const handleResolveThread = useCallback(
    async (threadId: string) => {
      try {
        await resolveThread.mutateAsync(threadId)
        toast.success('Thread resolved')
      } catch (err) {
        toast.error(`Failed to resolve thread: ${(err as Error).message}`)
        throw err
      }
    },
    [resolveThread],
  )

  const handleUnresolveThread = useCallback(
    async (threadId: string) => {
      try {
        await unresolveThread.mutateAsync(threadId)
        toast.success('Thread reopened')
      } catch (err) {
        toast.error(`Failed to unresolve thread: ${(err as Error).message}`)
        throw err
      }
    },
    [unresolveThread],
  )

  const handleEditComment = useCallback(
    async (commentId: number, body: string) => {
      try {
        await editComment.mutateAsync({ commentId, body })
        toast.success('Comment updated')
      } catch (err) {
        toast.error(`Failed to update comment: ${(err as Error).message}`)
        throw err
      }
    },
    [editComment],
  )

  const handleDeleteComment = useCallback(
    async (commentId: number) => {
      try {
        await deleteComment.mutateAsync(commentId)
        toast.success('Comment deleted')
      } catch (err) {
        toast.error(`Failed to delete comment: ${(err as Error).message}`)
        throw err
      }
    },
    [deleteComment],
  )

  const scrollToItem = useCallback((id: string, behavior: 'smooth' | 'instant' = 'smooth') => {
    codeViewRef.current?.scrollTo({
      type: 'item',
      id,
      align: 'start',
      behavior,
    } satisfies CodeViewScrollTarget)
  }, [])

  const scrollToFileByIndex = useCallback(
    (index: number) => {
      const file = parsedFiles[index]
      if (file) scrollToItem(file.name)
    },
    [parsedFiles, scrollToItem],
  )

  const scrollToFileByName = useCallback(
    (filename: string) => {
      scrollToItem(filename)
      const idx = fileIndex.get(filename)
      if (idx != null) setCurrentFileIndex(idx)
    },
    [fileIndex, scrollToItem],
  )

  const handleScrollToFile = useCallback(
    (path: string) => {
      isScrollingFromTreeRef.current = true
      scrollToItem(path, 'instant')
      const idx = fileIndex.get(path)
      if (idx != null) setCurrentFileIndex(idx)
      setTimeout(() => {
        isScrollingFromTreeRef.current = false
      }, 250)
    },
    [scrollToItem, fileIndex],
  )

  const scrollToComment = useCallback(
    (path: string, line: number, side: 'additions' | 'deletions') => {
      if (!fileIndex.has(path)) return
      isScrollingFromTreeRef.current = true
      codeViewRef.current?.scrollTo({
        type: 'line',
        id: path,
        lineNumber: line,
        side,
        align: 'center',
        behavior: 'smooth',
      } satisfies CodeViewScrollTarget)
      const idx = fileIndex.get(path)
      if (idx != null) setCurrentFileIndex(idx)
      setTimeout(() => {
        isScrollingFromTreeRef.current = false
      }, 500)
    },
    [fileIndex],
  )

  const renderAnnotation = useCallback(
    (
      annotation: DiffLineAnnotation<AnnotationPayload>,
      _item: CodeViewItem<AnnotationPayload>,
    ) => {
      const payload = annotation.metadata
      if (!payload) return null

      if (payload.form) {
        return (
          <CommentForm
            onSubmitImmediate={(body) => handleSubmitComment(body, payload.form!.file, payload.form!.line, payload.form!.side, payload.form!.startLine, payload.form!.startSide)}
            onAddPending={(body) => handleAddPendingComment(body, payload.form!.file, payload.form!.line, payload.form!.side, payload.form!.startLine, payload.form!.startSide)}
            onCancel={handleCancelComment}
            isSubmitting={postComment.isPending}
          />
        )
      }

      if (payload.reply) {
        return (
          <ReplyForm
            onSubmit={(body) => handleSubmitReply(body, payload.reply!.file, payload.reply!.line, payload.reply!.side, payload.reply!.parentId)}
            onCancel={handleCancelComment}
            isSubmitting={postComment.isPending}
          />
        )
      }

      if (payload.pending) {
        return (
          <PendingCommentAnnotation
            comment={payload.pending.comment}
            onDiscard={handleDiscardPendingComment}
          />
        )
      }

      if (payload.comment) {
        const comment = payload.comment
        const side = comment.side === 'LEFT' ? ('deletions' as const) : ('additions' as const)
        return (
          <ExistingComment
            comment={comment}
            onReply={() => handleStartReply(comment.path, comment.line!, side, comment.id)}
          />
        )
      }

      return null
    },
    [handleSubmitComment, handleAddPendingComment, handleSubmitReply, handleCancelComment, handleStartReply, handleDiscardPendingComment, postComment.isPending],
  )

  const renderGutterUtility = useCallback(
    (
      getHoveredLine: () => GutterHoveredLine | undefined,
      item: CodeViewItem<AnnotationPayload>,
    ) => (
      <button
        className="diffs-gutter-add-comment"
        onClick={(e) => {
          e.stopPropagation()
          const hovered = getHoveredLine()
          if (hovered && 'side' in hovered) {
            handleStartComment(item.id, hovered.lineNumber, hovered.side)
          }
        }}
      >
        +
      </button>
    ),
    [handleStartComment],
  )

  const shortcuts = useMemo(
    () => [
      {
        key: 'j',
        ignoreInput: true,
        handler: () => {
          const nextIndex = Math.min(currentFileIndex + 1, parsedFiles.length - 1)
          setCurrentFileIndex(nextIndex)
          scrollToFileByIndex(nextIndex)
        },
      },
      {
        key: 'k',
        ignoreInput: true,
        handler: () => {
          const prevIndex = Math.max(currentFileIndex - 1, 0)
          setCurrentFileIndex(prevIndex)
          scrollToFileByIndex(prevIndex)
        },
      },
      {
        key: 'c',
        ignoreInput: true,
        handler: () => {
          const file = parsedFiles[currentFileIndex]
          if (!file) return
          scrollToFileByIndex(currentFileIndex)
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
          toggleSidebar()
        },
      },
      {
        key: 'j',
        metaKey: true,
        handler: () => {
          toggleCommentsPanel()
        },
      },
      {
        key: '?',
        ignoreInput: true,
        handler: () => setShowHelp((prev) => !prev),
      },
    ],
    [currentFileIndex, parsedFiles, scrollToFileByIndex, handleStartComment, toggleSidebar, toggleCommentsPanel],
  )

  useKeyboardShortcuts(shortcuts)

  // Active-file detection + 2s>=30% auto-mark-viewed, computed from CodeView's
  // virtualized scroll/visibility instead of a per-element IntersectionObserver.
  const visibilityTimers = useRef<Map<string, number>>(new Map())

  const handleCodeViewScroll = useCallback(
    (scrollTop: number, viewer: CodeViewInstance) => {
      const viewportHeight = viewer.getHeight()
      const rendered = viewer.getRenderedItems()

      let topmostItem: string | null = null
      let topmostTop = Infinity

      for (const r of rendered) {
        const top = viewer.getTopForItem(r.id)
        if (top == null) continue
        const itemHeight = r.element.offsetHeight || 1

        const viewportTop = scrollTop
        const viewportBottom = scrollTop + viewportHeight
        const overlap =
          Math.min(top + itemHeight, viewportBottom) - Math.max(top, viewportTop)
        const fraction = overlap > 0 ? overlap / itemHeight : 0

        if (fraction >= 0.3) {
          if (!visibilityTimers.current.has(r.id)) {
            const timer = window.setTimeout(() => {
              handleMarkViewed(r.id)
              visibilityTimers.current.delete(r.id)
            }, 2000)
            visibilityTimers.current.set(r.id, timer)
          }
        } else {
          const timer = visibilityTimers.current.get(r.id)
          if (timer != null) {
            window.clearTimeout(timer)
            visibilityTimers.current.delete(r.id)
          }
        }

        if (overlap > 0 && top < topmostTop) {
          topmostTop = top
          topmostItem = r.id
        }
      }

      if (!isScrollingFromTreeRef.current && topmostItem) {
        setActiveFile(topmostItem)
      }
    },
    [handleMarkViewed],
  )

  useEffect(() => {
    const timers = visibilityTimers.current
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      timers.clear()
    }
  }, [parsedFiles])

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
      <ResizablePanelGroup
        direction="horizontal"
        autoSaveId="reviews-plus:review-panels"
        className="h-full overflow-hidden"
      >
        <ResizablePanel
          ref={leftPanelRef}
          id="file-tree"
          order={1}
          collapsible
          collapsedSize={0}
          defaultSize={0}
          minSize={16}
          maxSize={42}
          onCollapse={() => setSidebarOpen(false)}
          onExpand={() => setSidebarOpen(true)}
        >
          <FileTreeSidebar
            files={treeFiles}
            onSelectFile={handleScrollToFile}
            isOpen={sidebarOpen}
            activeFile={activeFile}
            viewedFiles={viewedFiles}
            onMarkViewed={handleMarkViewed}
          />
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel
          id="diff"
          order={2}
          minSize={30}
          className="flex flex-col overflow-hidden"
        >
          {metadata.data && (
            <PRHeader
              metadata={metadata.data}
              reviews={reviews.data}
              fileCount={files.data?.length ?? metadata.data.changed_files}
              sidebarOpen={sidebarOpen}
              onToggleSidebar={toggleSidebar}
              commentsPanelOpen={commentsPanelOpen}
              onToggleCommentsPanel={toggleCommentsPanel}
              checksData={checks.data}
              pendingComments={pendingComments}
              onSubmitReview={(params) =>
                submitReview.mutate(params, {
                  onSuccess: () => {
                    setPendingComments([])
                    toast.success('Review submitted')
                  },
                  onError: (err) => toast.error(`Failed to submit review: ${err.message}`),
                })
              }
              isSubmittingReview={submitReview.isPending}
              canEditDescription={canEditDescription}
              isSavingDescription={editPRBody.isPending}
              onSaveDescription={(body) =>
                editPRBody.mutate(body, {
                  onSuccess: () => toast.success('Description updated'),
                  onError: (err) => toast.error(`Failed to update description: ${err.message}`),
                })
              }
            />
          )}
          <WorkerPoolContextProvider
            poolOptions={WORKER_POOL_OPTIONS}
            highlighterOptions={WORKER_HIGHLIGHTER_OPTIONS}
          >
            <CodeView<AnnotationPayload>
              ref={codeViewRef}
              items={items}
              options={diffOptions}
              className="flex-1 overflow-y-auto p-4"
              renderAnnotation={renderAnnotation}
              renderGutterUtility={renderGutterUtility}
              onScroll={handleCodeViewScroll}
              containerRef={scrollContainerRef}
            />
          </WorkerPoolContextProvider>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel
          ref={rightPanelRef}
          id="comments"
          order={3}
          collapsible
          collapsedSize={0}
          defaultSize={0}
          minSize={20}
          maxSize={45}
          onCollapse={() => setCommentsPanelOpen(false)}
          onExpand={() => setCommentsPanelOpen(true)}
        >
          {commentsPanelOpen && (
            <CommentsPanel
              fileOrder={fileNameOrder}
              commentsByPath={commentsByPath}
              resolvedById={threadStateById.resolved}
              outdatedById={threadStateById.outdated}
              threadIdByRootId={threadStateById.threadIdByRootId}
              currentUserLogin={currentUser.data?.login}
              pendingComments={pendingComments}
              onGoToComment={scrollToComment}
              onSubmitReply={handlePanelReply}
              onResolveThread={handleResolveThread}
              onUnresolveThread={handleUnresolveThread}
              onEditComment={handleEditComment}
              onDeleteComment={handleDeleteComment}
              onDiscardPending={handleDiscardPendingComment}
              isSubmitting={postComment.isPending}
            />
          )}
        </ResizablePanel>
      </ResizablePanelGroup>

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

const DESC_STORAGE_KEY = 'reviews-plus:desc-open'

function PRHeader({
  metadata,
  reviews,
  fileCount,
  sidebarOpen,
  onToggleSidebar,
  commentsPanelOpen,
  onToggleCommentsPanel,
  checksData,
  pendingComments,
  onSubmitReview,
  isSubmittingReview,
  canEditDescription,
  isSavingDescription,
  onSaveDescription,
}: {
  metadata: PRMetadata
  reviews: PRReview[] | undefined
  fileCount: number
  sidebarOpen: boolean
  onToggleSidebar: () => void
  commentsPanelOpen: boolean
  onToggleCommentsPanel: () => void
  checksData: MergedCheckRun[] | undefined
  pendingComments: PendingComment[]
  onSubmitReview: (params: SubmitReviewParams) => void
  isSubmittingReview: boolean
  canEditDescription: boolean
  isSavingDescription: boolean
  onSaveDescription: (body: string) => void
}) {
  const [descOpen, setDescOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DESC_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  const handleDescToggle = (open: boolean) => {
    setDescOpen(open)
    try {
      localStorage.setItem(DESC_STORAGE_KEY, open ? 'true' : 'false')
    } catch {
      // ignore
    }
  }

  return (
    <div className="border rounded-lg bg-card mx-4 mt-4">
      <div className="p-4">
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
          <Button
            variant={commentsPanelOpen ? 'secondary' : 'ghost'}
            size="icon"
            className="size-8 flex-shrink-0"
            onClick={onToggleCommentsPanel}
            title={commentsPanelOpen ? 'Hide comments' : 'Show comments'}
          >
            <MessageSquare className="size-4" />
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 gap-y-2 text-sm">
          <span className="text-green-600 font-medium">+{metadata.additions}</span>
          <span className="text-red-600 font-medium">-{metadata.deletions}</span>
          <span className="text-muted-foreground">
            {fileCount} file{fileCount !== 1 ? 's' : ''} changed
          </span>

          {checksData !== undefined && checksData.length > 0 && (
            <ChecksIndicator checks={checksData} />
          )}

          <div className="flex flex-wrap items-center gap-1 gap-y-2 ml-auto">
            {reviews && reviews.length > 0 &&
              reviews.map((review) => (
                <ReviewBadge key={review.id} review={review} />
              ))
            }
            <ReviewChangesButton
              onSubmit={onSubmitReview}
              isSubmitting={isSubmittingReview}
              pendingComments={pendingComments}
            />
          </div>
        </div>
      </div>

      <Collapsible.Root open={descOpen} onOpenChange={handleDescToggle}>
        <div className="border-t px-4 py-2 flex items-center">
          <Collapsible.Trigger asChild>
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              {descOpen ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              Description
            </button>
          </Collapsible.Trigger>
        </div>
        <Collapsible.Content>
          <div className="px-4 pb-4">
            <PRDescription
              body={metadata.body}
              canEdit={canEditDescription}
              isSaving={isSavingDescription}
              onSave={onSaveDescription}
            />
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  )
}

function PRDescription({
  body,
  canEdit,
  isSaving,
  onSave,
}: {
  body: string | null
  canEdit: boolean
  isSaving: boolean
  onSave: (body: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(body ?? '')

  useEffect(() => {
    if (!editing) setDraft(body ?? '')
  }, [body, editing])

  if (editing) {
    return (
      <div className="space-y-2">
        <textarea
          className="w-full min-h-48 rounded border bg-background px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={isSaving || draft === (body ?? '')}
            onClick={() => {
              onSave(draft)
              setEditing(false)
            }}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative max-h-80 overflow-y-auto rounded border bg-muted/30 p-3">
      {canEdit && (
        <Button
          variant="ghost"
          size="xs"
          className="absolute right-2 top-2"
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
      )}
      {body ? (
        <div className="markdown-body text-sm leading-relaxed">
          <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">No description provided.</p>
      )}
    </div>
  )
}

const CHECK_CONCLUSION_ORDER = ['failure', 'timed_out', 'action_required', 'pending', 'success', 'neutral', 'skipped', 'cancelled']

function ChecksIndicator({ checks }: { checks: MergedCheckRun[] }) {
  const [open, setOpen] = useState(false)
  const aggregate = aggregateChecks(checks)

  const failureCount = checks.filter(
    (c) => c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required',
  ).length
  const pendingCount = checks.filter((c) => c.status !== 'completed' || c.conclusion == null).length
  const successCount = checks.filter((c) => c.conclusion === 'success' || c.conclusion === 'neutral' || c.conclusion === 'skipped').length

  const sorted = [...checks].sort((a, b) => {
    const ai = CHECK_CONCLUSION_ORDER.indexOf(a.conclusion ?? 'pending')
    const bi = CHECK_CONCLUSION_ORDER.indexOf(b.conclusion ?? 'pending')
    return ai - bi
  })

  const aggregateIcon =
    aggregate === 'success' ? (
      <CheckCircle2 className="size-3.5 text-green-500" />
    ) : aggregate === 'failure' ? (
      <XCircle className="size-3.5 text-red-500" />
    ) : (
      <Clock className="size-3.5 text-yellow-500" />
    )

  const aggregateLabel =
    aggregate === 'success'
      ? `${successCount} check${successCount !== 1 ? 's' : ''} passed`
      : aggregate === 'failure'
      ? `${failureCount} check${failureCount !== 1 ? 's' : ''} failed`
      : `${pendingCount} check${pendingCount !== 1 ? 's' : ''} pending`

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          {aggregateIcon}
          {aggregateLabel}
          <ChevronDown className="size-3" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50 w-80 rounded-lg border bg-popover p-2 shadow-md text-popover-foreground outline-none"
        >
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {sorted.map((check) => (
              <CheckRunRow key={check.id} check={check} />
            ))}
          </div>
          <Popover.Arrow className="fill-popover" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

function CheckRunRow({ check }: { check: MergedCheckRun }) {
  const isPending = check.status !== 'completed' || check.conclusion == null
  const isSuccess = check.conclusion === 'success' || check.conclusion === 'neutral' || check.conclusion === 'skipped'
  const isFailure = check.conclusion === 'failure' || check.conclusion === 'timed_out' || check.conclusion === 'action_required'

  const icon = isPending ? (
    <Clock className="size-3.5 text-yellow-500 flex-shrink-0" />
  ) : isSuccess ? (
    <CheckCircle2 className="size-3.5 text-green-500 flex-shrink-0" />
  ) : isFailure ? (
    <XCircle className="size-3.5 text-red-500 flex-shrink-0" />
  ) : (
    <Circle className="size-3.5 text-muted-foreground flex-shrink-0" />
  )

  const conclusionLabel = isPending
    ? 'In progress'
    : check.conclusion
      ? check.conclusion.replace(/_/g, ' ')
      : 'Queued'

  const inner = (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted/50 transition-colors">
      {icon}
      <span className="flex-1 truncate">{check.name}</span>
      <span className="text-muted-foreground capitalize">{conclusionLabel}</span>
      {check.url && <ExternalLink className="size-3 text-muted-foreground flex-shrink-0" />}
    </div>
  )

  if (check.url) {
    return (
      <a href={check.url} target="_blank" rel="noreferrer" className="block">
        {inner}
      </a>
    )
  }
  return inner
}

type ReviewEvent = SubmitReviewParams['event']

function ReviewChangesButton({
  onSubmit,
  isSubmitting,
  pendingComments,
}: {
  onSubmit: (params: SubmitReviewParams) => void
  isSubmitting: boolean
  pendingComments: PendingComment[]
}) {
  const [open, setOpen] = useState(false)
  const [event, setEvent] = useState<ReviewEvent>('COMMENT')
  const [body, setBody] = useState('')

  const handleSubmit = () => {
    const comments: PendingReviewComment[] = pendingComments.map((c) => ({
      path: c.path,
      line: c.line,
      side: c.side === 'deletions' ? 'LEFT' : 'RIGHT',
      body: c.body,
      ...(c.startLine != null && c.startLine !== c.line
        ? {
            start_line: c.startLine,
            start_side: (c.startSide ?? c.side) === 'deletions' ? 'LEFT' : 'RIGHT',
          }
        : {}),
    }))
    onSubmit({ event, body, ...(comments.length > 0 ? { comments } : {}) })
    setOpen(false)
    setBody('')
    setEvent('COMMENT')
  }

  const eventLabel: Record<ReviewEvent, string> = {
    APPROVE: 'Approve',
    REQUEST_CHANGES: 'Request changes',
    COMMENT: 'Comment',
  }

  const eventStyles: Record<ReviewEvent, string> = {
    APPROVE: 'text-green-600',
    REQUEST_CHANGES: 'text-red-600',
    COMMENT: 'text-foreground',
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="outline" size="sm">
          {pendingComments.length > 0
            ? `Review changes (${pendingComments.length})`
            : 'Review changes'}
          <ChevronDown className="size-3.5" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className="z-50 w-80 rounded-lg border bg-popover p-4 shadow-md text-popover-foreground outline-none space-y-3"
        >
          <p className="text-sm font-medium">Submit review</p>
          <textarea
            className="w-full rounded border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Leave a comment (optional)"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <RadioGroup.Root
            value={event}
            onValueChange={(v) => setEvent(v as ReviewEvent)}
            className="space-y-2"
          >
            {(['COMMENT', 'APPROVE', 'REQUEST_CHANGES'] as ReviewEvent[]).map((e) => (
              <label
                key={e}
                className="flex items-center gap-2 cursor-pointer text-sm"
              >
                <RadioGroup.Item
                  value={e}
                  className="size-4 rounded-full border border-input bg-background ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-primary data-[state=checked]:bg-primary"
                >
                  <RadioGroup.Indicator className="flex items-center justify-center">
                    <span className="block size-2 rounded-full bg-primary-foreground" />
                  </RadioGroup.Indicator>
                </RadioGroup.Item>
                <span className={eventStyles[e]}>{eventLabel[e]}</span>
              </label>
            ))}
          </RadioGroup.Root>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Submitting...' : `Submit ${eventLabel[event].toLowerCase()}`}
            </Button>
          </div>
          <Popover.Arrow className="fill-popover" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
  filePendingComments: PendingComment[],
): DiffLineAnnotation<AnnotationPayload>[] {
  const annotations: DiffLineAnnotation<AnnotationPayload>[] = comments
    .filter((c) => c.line !== null)
    .map((comment) => ({
      side: comment.side === 'LEFT' ? 'deletions' as const : 'additions' as const,
      lineNumber: comment.line!,
      metadata: { comment },
    }))

  for (const pending of filePendingComments) {
    annotations.push({
      side: pending.side,
      lineNumber: pending.line,
      metadata: { pending: { _type: 'pending', comment: pending } },
    })
  }

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
          startLine: activeComment.startLine,
          startSide: activeComment.startSide,
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

function areAnnotationsEqual(
  a: DiffLineAnnotation<AnnotationPayload>[],
  b: DiffLineAnnotation<AnnotationPayload>[],
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.side !== y.side || x.lineNumber !== y.lineNumber) return false
    const xm = x.metadata
    const ym = y.metadata
    if (xm?.comment?.id !== ym?.comment?.id) return false
    if (xm?.comment?.body !== ym?.comment?.body) return false
    if (Boolean(xm?.form) !== Boolean(ym?.form)) return false
    if (xm?.form?.startLine !== ym?.form?.startLine) return false
    if (xm?.reply?.parentId !== ym?.reply?.parentId) return false
    if (xm?.pending?.comment.body !== ym?.pending?.comment.body) return false
  }
  return true
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

function ReplyForm({
  onSubmit,
  onCancel,
  isSubmitting,
}: {
  onSubmit: (body: string) => void
  onCancel: () => void
  isSubmitting: boolean
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
        placeholder="Reply..."
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
          {isSubmitting ? 'Posting...' : 'Reply'}
        </button>
      </div>
    </div>
  )
}

function CommentForm({
  onSubmitImmediate,
  onAddPending,
  onCancel,
  isSubmitting,
}: {
  onSubmitImmediate: (body: string) => void
  onAddPending: (body: string) => void
  onCancel: () => void
  isSubmitting: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const currentBody = () => textareaRef.current?.value.trim() ?? ''

  return (
    <div className="diffs-comment-form">
      <textarea
        ref={textareaRef}
        className="diffs-comment-textarea"
        placeholder="Add a comment..."
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            const value = currentBody()
            if (value) onSubmitImmediate(value)
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
          style={{ background: 'transparent', color: 'inherit', border: '1px solid currentColor' }}
          onClick={() => {
            const value = currentBody()
            if (value) onAddPending(value)
          }}
        >
          Add review comment
        </button>
        <button
          className="diffs-comment-submit-btn"
          disabled={isSubmitting}
          onClick={() => {
            const value = currentBody()
            if (value) onSubmitImmediate(value)
          }}
        >
          {isSubmitting ? 'Posting...' : 'Add single comment'}
        </button>
      </div>
    </div>
  )
}

function PendingCommentAnnotation({
  comment,
  onDiscard,
}: {
  comment: PendingComment
  onDiscard: (c: PendingComment) => void
}) {
  return (
    <div
      className="diffs-existing-comment"
      style={{ borderLeftColor: 'var(--color-amber-400, #fbbf24)', borderLeftWidth: 3, opacity: 0.9 }}
    >
      <div className="diffs-comment-header">
        <span className="diffs-comment-author" style={{ color: 'var(--color-amber-600, #d97706)' }}>
          Pending review comment
        </span>
      </div>
      <div className="diffs-comment-body">{comment.body}</div>
      <button
        className="diffs-reply-btn"
        style={{ color: 'var(--color-destructive, #ef4444)' }}
        onClick={() => onDiscard(comment)}
      >
        Discard
      </button>
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
