import { useMemo, useState, useRef, useEffect } from 'react'
import { ArrowRight } from 'lucide-react'
import type { PRComment } from '@/lib/github/types'

type GoToComment = (path: string, line: number, side: 'additions' | 'deletions') => void

interface CommentsPanelProps {
  fileOrder: string[]
  commentsByPath: Map<string, PRComment[]>
  resolvedById: Map<number, boolean>
  outdatedById: Map<number, boolean>
  onGoToComment: GoToComment
  onSubmitReply: (rootId: number, path: string, line: number, side: 'additions' | 'deletions', body: string) => void
  isSubmitting: boolean
}

interface Thread {
  root: PRComment
  replies: PRComment[]
  resolved: boolean
  outdated: boolean
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

function buildThreads(
  comments: PRComment[],
  resolvedById: Map<number, boolean>,
  outdatedById: Map<number, boolean>,
): Thread[] {
  const roots = comments.filter((c) => !c.in_reply_to_id)
  const repliesByRoot = new Map<number, PRComment[]>()
  for (const c of comments) {
    if (c.in_reply_to_id == null) continue
    const arr = repliesByRoot.get(c.in_reply_to_id) ?? []
    arr.push(c)
    repliesByRoot.set(c.in_reply_to_id, arr)
  }
  return roots.map((root) => ({
    root,
    replies: repliesByRoot.get(root.id) ?? [],
    resolved: resolvedById.get(root.id) ?? false,
    outdated: outdatedById.get(root.id) ?? false,
  }))
}

export function CommentsPanel({
  fileOrder,
  commentsByPath,
  resolvedById,
  outdatedById,
  onGoToComment,
  onSubmitReply,
  isSubmitting,
}: CommentsPanelProps) {
  const [expandedThreadIds, setExpandedThreadIds] = useState<Set<number>>(new Set())

  const groups = useMemo(() => {
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const path of fileOrder) {
      if (commentsByPath.has(path) && !seen.has(path)) {
        seen.add(path)
        ordered.push(path)
      }
    }
    // Comments on files not present in the diff (e.g. fully outdated) still list.
    for (const path of commentsByPath.keys()) {
      if (!seen.has(path)) {
        seen.add(path)
        ordered.push(path)
      }
    }
    return ordered.map((path) => ({
      path,
      threads: buildThreads(commentsByPath.get(path) ?? [], resolvedById, outdatedById),
    }))
  }, [fileOrder, commentsByPath, resolvedById, outdatedById])

  const toggleThread = (id: number) => {
    setExpandedThreadIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totalThreads = groups.reduce((sum, g) => sum + g.threads.length, 0)

  return (
    <div className="w-[300px] md:w-[340px] max-w-[45vw] h-full border-l overflow-y-auto flex-shrink-0 flex flex-col">
      <div className="px-3 py-2 border-b">
        <div className="text-sm font-medium text-muted-foreground">
          Comments ({totalThreads})
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {totalThreads === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No comments yet</div>
        ) : (
          groups.map((group) => (
            <div key={group.path} className="border-b">
              <div className="px-3 py-1.5 sticky top-0 bg-card/95 backdrop-blur text-xs font-medium truncate border-b">
                {group.path.split('/').pop()}
                <span className="text-muted-foreground ml-1">{group.path}</span>
              </div>
              {group.threads.map((thread) => (
                <ThreadRow
                  key={thread.root.id}
                  thread={thread}
                  expanded={expandedThreadIds.has(thread.root.id)}
                  onToggle={() => toggleThread(thread.root.id)}
                  onGoToComment={onGoToComment}
                  onSubmitReply={onSubmitReply}
                  isSubmitting={isSubmitting}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ThreadRow({
  thread,
  expanded,
  onToggle,
  onGoToComment,
  onSubmitReply,
  isSubmitting,
}: {
  thread: Thread
  expanded: boolean
  onToggle: () => void
  onGoToComment: GoToComment
  onSubmitReply: CommentsPanelProps['onSubmitReply']
  isSubmitting: boolean
}) {
  const { root, replies, resolved, outdated } = thread
  const collapsedByDefault = resolved && !expanded
  const isMultiLine = root.start_line != null && root.line != null && root.start_line !== root.line
  const side = root.side === 'LEFT' ? ('deletions' as const) : ('additions' as const)
  const canNavigate = !outdated && root.line != null

  const goToLocation = () => {
    if (canNavigate) onGoToComment(root.path, root.line!, side)
  }

  return (
    <div className={collapsedByDefault ? 'opacity-50' : undefined}>
      <div
        className="group w-full text-left px-3 py-2 hover:bg-muted/50 flex gap-2 items-start cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onDoubleClick={goToLocation}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        <img
          src={root.user.avatar_url}
          alt={root.user.login}
          className="w-5 h-5 rounded-full flex-shrink-0 mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium">{root.user.login}</span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(root.created_at)}
            </span>
            {root.line != null && (
              <span className="text-[10px] px-1 rounded bg-muted text-muted-foreground">
                {isMultiLine ? `L${root.start_line}-${root.line}` : `L${root.line}`}
              </span>
            )}
            {resolved && (
              <span className="text-[10px] px-1 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                resolved
              </span>
            )}
            {outdated && (
              <span className="text-[10px] px-1 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                outdated
              </span>
            )}
            {replies.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {replies.length} repl{replies.length === 1 ? 'y' : 'ies'}
              </span>
            )}
          </div>
          {!collapsedByDefault && (
            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {root.body}
            </div>
          )}
        </div>
        {canNavigate && (
          <button
            className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-1 rounded hover:bg-muted text-muted-foreground"
            title="Go to location in diff"
            onClick={(e) => {
              e.stopPropagation()
              goToLocation()
            }}
          >
            <ArrowRight className="size-3.5" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <ThreadComment comment={root} />
          {replies.map((reply) => (
            <ThreadComment key={reply.id} comment={reply} isReply />
          ))}
          {root.line != null && (
            <ReplyComposer
              isSubmitting={isSubmitting}
              onSubmit={(body) => onSubmitReply(root.id, root.path, root.line!, side, body)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function ThreadComment({ comment, isReply }: { comment: PRComment; isReply?: boolean }) {
  return (
    <div className={isReply ? 'pl-3 border-l-2 border-muted' : undefined}>
      <div className="flex items-center gap-1.5">
        <img
          src={comment.user.avatar_url}
          alt={comment.user.login}
          className="w-4 h-4 rounded-full"
        />
        <span className="text-xs font-medium">{comment.user.login}</span>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(comment.created_at)}
        </span>
      </div>
      <div className="text-xs mt-0.5 whitespace-pre-wrap break-words">{comment.body}</div>
    </div>
  )
}

function ReplyComposer({
  onSubmit,
  isSubmitting,
}: {
  onSubmit: (body: string) => void
  isSubmitting: boolean
}) {
  const [body, setBody] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const submit = () => {
    const value = body.trim()
    if (value) {
      onSubmit(value)
      setBody('')
    }
  }

  return (
    <div className="space-y-1">
      <textarea
        ref={textareaRef}
        className="w-full text-xs border rounded p-1.5 bg-background resize-y"
        rows={2}
        placeholder="Reply..."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <button
        className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground disabled:opacity-50"
        disabled={isSubmitting || !body.trim()}
        onClick={submit}
      >
        {isSubmitting ? 'Posting...' : 'Reply'}
      </button>
    </div>
  )
}
