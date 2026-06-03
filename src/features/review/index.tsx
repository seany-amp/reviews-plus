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
} from '@/lib/github'
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
import type { PRMetadata, PRReview, PRComment } from '@/lib/github/types'
import { toast } from 'sonner'
import { AlertTriangle, MessageSquare, PanelLeft, Settings } from 'lucide-react'
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

interface CommentFormMarker {
  _type: 'comment-form'
  file: string
  line: number
  side: 'additions' | 'deletions'
  startLine?: number
  startSide?: 'additions' | 'deletions'
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
        ),
      )
    }
    return m
  }, [parsedFiles, commentsByPath, activeComment, activeReply])

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

  const scrollToItem = useCallback((id: string) => {
    codeViewRef.current?.scrollTo({
      type: 'item',
      id,
      align: 'start',
      behavior: 'smooth',
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
      scrollToItem(path)
      setTimeout(() => {
        isScrollingFromTreeRef.current = false
      }, 500)
    },
    [scrollToItem],
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
            onSubmit={(body) => handleSubmitComment(body, payload.form!.file, payload.form!.line, payload.form!.side, payload.form!.startLine, payload.form!.startSide)}
            onCancel={handleCancelComment}
            isSubmitting={postComment.isPending}
            placeholder="Add a comment..."
          />
        )
      }

      if (payload.reply) {
        return (
          <CommentForm
            onSubmit={(body) => handleSubmitReply(body, payload.reply!.file, payload.reply!.line, payload.reply!.side, payload.reply!.parentId)}
            onCancel={handleCancelComment}
            isSubmitting={postComment.isPending}
            placeholder="Reply..."
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
    [handleSubmitComment, handleSubmitReply, handleCancelComment, handleStartReply, postComment.isPending],
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
            files={files.data ?? []}
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
              onGoToComment={scrollToComment}
              onSubmitReply={handlePanelReply}
              onResolveThread={handleResolveThread}
              onUnresolveThread={handleUnresolveThread}
              onEditComment={handleEditComment}
              onDeleteComment={handleDeleteComment}
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

function PRHeader({
  metadata,
  reviews,
  fileCount,
  sidebarOpen,
  onToggleSidebar,
  commentsPanelOpen,
  onToggleCommentsPanel,
}: {
  metadata: PRMetadata
  reviews: PRReview[] | undefined
  fileCount: number
  sidebarOpen: boolean
  onToggleSidebar: () => void
  commentsPanelOpen: boolean
  onToggleCommentsPanel: () => void
}) {
  return (
    <div className="border rounded-lg p-4 bg-card mx-4 mt-4">
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
