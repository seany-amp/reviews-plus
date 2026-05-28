import { useEffect, useRef, useMemo, useState, useCallback } from 'react'
import {
  usePRMetadata,
  usePRDiff,
  usePRFiles,
  usePRReviews,
  usePRComments,
  usePostComment,
} from '@/lib/github'
import { parsePatchFiles, FileDiff, preloadHighlighter } from '@pierre/diffs'
import type {
  FileDiffMetadata,
  ThemesType,
  DiffLineAnnotation,
} from '@pierre/diffs'
import type { PRIdentifier } from '@/lib/github/parse-url'
import type { PRMetadata, PRReview, PRComment } from '@/lib/github/types'
import { toast } from 'sonner'
import { AlertTriangle, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { FilePalette } from '@/components/file-palette'
import { ShortcutsHelp } from '@/components/shortcuts-help'

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

export function ReviewView({ pr }: ReviewViewProps) {
  useEffect(() => {
    preloadHighlighter({
      themes: [THEMES.dark, THEMES.light],
      langs: ['typescript', 'javascript', 'json', 'css', 'html', 'markdown'],
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

  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [filePaletteOpen, setFilePaletteOpen] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

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
    const containers = document.querySelectorAll('[data-diff-file]')
    const target = containers[index]
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const scrollToFileByName = useCallback((filename: string) => {
    const containers = document.querySelectorAll('[data-diff-file]')
    for (let i = 0; i < containers.length; i++) {
      if (containers[i].getAttribute('data-diff-file') === filename) {
        containers[i].scrollIntoView({ behavior: 'smooth', block: 'start' })
        setCurrentFileIndex(i)
        break
      }
    }
  }, [])

  const shortcuts = useMemo(
    () => [
      {
        key: 'j',
        ignoreInput: true,
        handler: () => {
          const containers = document.querySelectorAll('[data-diff-file]')
          const nextIndex = Math.min(currentFileIndex + 1, containers.length - 1)
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
        key: 'p',
        metaKey: true,
        handler: () => setFilePaletteOpen(true),
      },
      {
        key: '?',
        ignoreInput: true,
        handler: () => setShowHelp((prev) => !prev),
      },
    ],
    [currentFileIndex, scrollToFileByIndex],
  )

  useKeyboardShortcuts(shortcuts)

  const parsedFiles = useMemo(() => {
    if (!diff.data) return []
    const patches = parsePatchFiles(diff.data)
    return patches.flatMap((patch) => patch.files)
  }, [diff.data])

  const commentsByFile = useMemo(() => {
    if (!comments.data) return new Map<string, PRComment[]>()
    const map = new Map<string, PRComment[]>()
    for (const comment of comments.data) {
      if (comment.line === null) continue
      const existing = map.get(comment.path) ?? []
      existing.push(comment)
      map.set(comment.path, existing)
    }
    return map
  }, [comments.data])

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
      <div className="flex flex-col gap-4 h-full overflow-auto">
        {metadata.data && (
          <PRHeader
            metadata={metadata.data}
            reviews={reviews.data}
            fileCount={files.data?.length ?? metadata.data.changed_files}
          />
        )}
        <div className="flex flex-col gap-2">
          {parsedFiles.map((file, i) => (
            <DiffFileContainer
              key={file.name ?? i}
              filename={file.name}
            >
              <DiffFile
                metadata={file}
                comments={commentsByFile.get(file.name) ?? []}
                activeComment={
                  activeComment?.file === file.name ? activeComment : null
                }
                activeReply={
                  activeReply?.file === file.name ? activeReply : null
                }
                onStartComment={handleStartComment}
                onStartReply={handleStartReply}
                onCancelComment={handleCancelComment}
                onSubmitComment={handleSubmitComment}
                onSubmitReply={handleSubmitReply}
                isSubmitting={postComment.isPending}
              />
            </DiffFileContainer>
          ))}
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

function PRHeader({
  metadata,
  reviews,
  fileCount,
}: {
  metadata: PRMetadata
  reviews: PRReview[] | undefined
  fileCount: number
}) {
  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-center gap-3 mb-2">
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

      <div className="flex items-center gap-4 text-sm">
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
          <div className="flex items-center gap-1 ml-auto">
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

function buildAnnotations(
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

  if (activeComment) {
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

  if (activeReply) {
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

function createAnnotationRenderer(callbacks: {
  onSubmitComment: (body: string, path: string, line: number, side: 'additions' | 'deletions') => void
  onSubmitReply: (body: string, path: string, line: number, side: 'additions' | 'deletions', parentId: number) => void
  onCancel: () => void
  onStartReply: (file: string, line: number, side: 'additions' | 'deletions', parentId: number) => void
  isSubmitting: boolean
}) {
  return function renderAnnotation(
    annotation: DiffLineAnnotation<AnnotationPayload>,
  ): HTMLElement | undefined {
    const payload = annotation.metadata
    if (!payload) return undefined

    if (payload.form) {
      const { form } = payload
      return createCommentForm({
        onSubmit: (body) => callbacks.onSubmitComment(body, form.file, form.line, form.side),
        onCancel: callbacks.onCancel,
        isSubmitting: callbacks.isSubmitting,
        placeholder: 'Add a comment...',
      })
    }

    if (payload.reply) {
      const { reply } = payload
      return createCommentForm({
        onSubmit: (body) => callbacks.onSubmitReply(body, reply.file, reply.line, reply.side, reply.parentId),
        onCancel: callbacks.onCancel,
        isSubmitting: callbacks.isSubmitting,
        placeholder: 'Reply...',
      })
    }

    if (payload.comment) {
      return renderExistingComment(payload.comment, callbacks.onStartReply)
    }

    return undefined
  }
}

function renderExistingComment(
  comment: PRComment,
  onStartReply: (file: string, line: number, side: 'additions' | 'deletions', parentId: number) => void,
): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.style.padding = '8px 12px'
  wrapper.style.margin = '4px 0'
  wrapper.style.borderRadius = '6px'
  wrapper.style.border = '1px solid var(--border, #d0d7de)'
  wrapper.style.backgroundColor = 'var(--muted, #f6f8fa)'
  wrapper.style.fontSize = '13px'
  wrapper.style.lineHeight = '1.4'

  if (comment.in_reply_to_id) {
    wrapper.style.marginLeft = '16px'
    wrapper.style.borderLeftWidth = '3px'
  }

  const header = document.createElement('div')
  header.style.display = 'flex'
  header.style.alignItems = 'center'
  header.style.gap = '6px'
  header.style.marginBottom = '4px'

  const avatar = document.createElement('img')
  avatar.src = comment.user.avatar_url
  avatar.alt = comment.user.login
  avatar.style.width = '20px'
  avatar.style.height = '20px'
  avatar.style.borderRadius = '50%'
  header.appendChild(avatar)

  const author = document.createElement('span')
  author.style.fontWeight = '600'
  author.textContent = comment.user.login
  header.appendChild(author)

  const time = document.createElement('span')
  time.style.color = 'var(--muted-foreground, #656d76)'
  time.style.fontSize = '12px'
  time.textContent = formatRelativeTime(comment.created_at)
  header.appendChild(time)

  wrapper.appendChild(header)

  const body = document.createElement('div')
  body.textContent = comment.body
  body.style.whiteSpace = 'pre-wrap'
  wrapper.appendChild(body)

  if (!comment.in_reply_to_id) {
    const replyBtn = document.createElement('button')
    replyBtn.textContent = 'Reply'
    replyBtn.className = 'diffs-reply-btn'
    replyBtn.onclick = (e) => {
      e.stopPropagation()
      const side = comment.side === 'LEFT' ? 'deletions' as const : 'additions' as const
      onStartReply(comment.path, comment.line!, side, comment.id)
    }
    wrapper.appendChild(replyBtn)
  }

  return wrapper
}

function createCommentForm(options: {
  onSubmit: (body: string) => void
  onCancel: () => void
  isSubmitting: boolean
  placeholder: string
}): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'diffs-comment-form'

  const textarea = document.createElement('textarea')
  textarea.placeholder = options.placeholder
  textarea.className = 'diffs-comment-textarea'
  textarea.rows = 3

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      const value = textarea.value.trim()
      if (value) options.onSubmit(value)
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      options.onCancel()
    }
  })

  const buttonRow = document.createElement('div')
  buttonRow.className = 'diffs-comment-form-buttons'

  const cancelBtn = document.createElement('button')
  cancelBtn.textContent = 'Cancel'
  cancelBtn.className = 'diffs-comment-cancel-btn'
  cancelBtn.onclick = (e) => {
    e.stopPropagation()
    options.onCancel()
  }

  const submitBtn = document.createElement('button')
  submitBtn.textContent = options.isSubmitting ? 'Posting...' : 'Comment'
  submitBtn.className = 'diffs-comment-submit-btn'
  submitBtn.disabled = options.isSubmitting
  submitBtn.onclick = (e) => {
    e.stopPropagation()
    const value = textarea.value.trim()
    if (value) options.onSubmit(value)
  }

  buttonRow.appendChild(cancelBtn)
  buttonRow.appendChild(submitBtn)
  wrapper.appendChild(textarea)
  wrapper.appendChild(buttonRow)

  requestAnimationFrame(() => textarea.focus())

  return wrapper
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

function DiffFile({
  metadata,
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
  metadata: FileDiffMetadata
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
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<FileDiff<AnnotationPayload> | null>(null)
  const callbacksRef = useRef({ onStartComment, onStartReply, onCancelComment, onSubmitComment, onSubmitReply, isSubmitting })

  callbacksRef.current = { onStartComment, onStartReply, onCancelComment, onSubmitComment, onSubmitReply, isSubmitting }

  const lineAnnotations = useMemo(
    () => buildAnnotations(comments, activeComment, activeReply),
    [comments, activeComment, activeReply],
  )

  useEffect(() => {
    if (!containerRef.current) return

    const themeType = getInitialThemeType()
    const fileName = metadata.name

    const renderAnnotation = createAnnotationRenderer({
      onSubmitComment: (...args) => callbacksRef.current.onSubmitComment(...args),
      onSubmitReply: (...args) => callbacksRef.current.onSubmitReply(...args),
      onCancel: () => callbacksRef.current.onCancelComment(),
      onStartReply: (...args) => callbacksRef.current.onStartReply(...args),
      isSubmitting: callbacksRef.current.isSubmitting,
    })

    const instance = new FileDiff<AnnotationPayload>({
      theme: THEMES,
      themeType,
      diffStyle: 'split',
      renderAnnotation,
      renderGutterUtility(getHoveredRow) {
        const btn = document.createElement('button')
        btn.textContent = '+'
        btn.className = 'diffs-gutter-add-comment'
        btn.onclick = (e) => {
          e.stopPropagation()
          const hovered = getHoveredRow()
          if (hovered) {
            callbacksRef.current.onStartComment(
              fileName,
              hovered.lineNumber,
              hovered.side as 'additions' | 'deletions',
            )
          }
        }
        return btn
      },
    })

    instance.render({
      fileDiff: metadata,
      fileContainer: containerRef.current,
      lineAnnotations,
    })

    instanceRef.current = instance

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleThemeChange = () => {
      instance.onThemeChange()
    }
    mediaQuery.addEventListener('change', handleThemeChange)

    return () => {
      mediaQuery.removeEventListener('change', handleThemeChange)
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
      instanceRef.current = null
    }
  }, [metadata, lineAnnotations])

  return <div ref={containerRef} className="border rounded overflow-hidden" />
}

function DiffFileContainer({ filename, children }: { filename: string; children: React.ReactNode }) {
  return (
    <div data-diff-file={filename}>
      {children}
    </div>
  )
}

function DiffLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* PR header skeleton */}
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

      {/* File diff skeletons */}
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

function getErrorDetails(error: Error | null): {
  message: string
  showSettings: boolean
  retryDelay?: string
} {
  const msg = error?.message ?? 'Unknown error'

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
  error: Error | null
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
