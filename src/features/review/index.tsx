import { useEffect, useRef, useMemo } from 'react'
import {
  usePRMetadata,
  usePRDiff,
  usePRFiles,
  usePRReviews,
  usePRComments,
} from '@/lib/github'
import { parsePatchFiles, FileDiff, preloadHighlighter } from '@pierre/diffs'
import type {
  FileDiffMetadata,
  ThemesType,
  DiffLineAnnotation,
} from '@pierre/diffs'
import type { PRIdentifier } from '@/lib/github/parse-url'
import type { PRMetadata, PRReview, PRComment } from '@/lib/github/types'

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
    return <LoadingState />
  }

  if (metadata.error || diff.error) {
    return (
      <div className="text-red-500 p-4">
        Failed to load PR data:{' '}
        {(metadata.error ?? diff.error)?.message ?? 'Unknown error'}
      </div>
    )
  }

  return (
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
          <DiffFile
            key={file.name ?? i}
            metadata={file}
            comments={commentsByFile.get(file.name) ?? []}
          />
        ))}
      </div>
    </div>
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
): DiffLineAnnotation<PRComment>[] {
  return comments
    .filter((c) => c.line !== null)
    .map((comment) => ({
      side: comment.side === 'LEFT' ? 'deletions' as const : 'additions' as const,
      lineNumber: comment.line!,
      metadata: comment,
    }))
}

function renderCommentAnnotation(
  annotation: DiffLineAnnotation<PRComment>,
): HTMLElement | undefined {
  const comment = annotation.metadata
  if (!comment) return undefined

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
}: {
  metadata: FileDiffMetadata
  comments: PRComment[]
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<FileDiff<PRComment> | null>(null)

  const lineAnnotations = useMemo(() => buildAnnotations(comments), [comments])

  useEffect(() => {
    if (!containerRef.current) return

    const themeType = getInitialThemeType()

    const instance = new FileDiff<PRComment>({
      theme: THEMES,
      themeType,
      diffStyle: 'split',
      renderAnnotation: renderCommentAnnotation,
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

function LoadingState() {
  return (
    <div className="flex flex-col gap-4 p-4 animate-pulse">
      <div className="h-24 bg-muted rounded-lg" />
      <div className="h-64 bg-muted rounded" />
      <div className="h-48 bg-muted rounded" />
    </div>
  )
}
