import { useMemo, useState, useRef, useEffect } from 'react'
import { ArrowRight, Check, RotateCcw, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react'
import type { PRComment } from '@/lib/github/types'

interface PendingComment {
  path: string
  line: number
  side: 'additions' | 'deletions'
  body: string
  startLine?: number
  startSide?: 'additions' | 'deletions'
}

type GoToComment = (path: string, line: number, side: 'additions' | 'deletions') => void

interface CommentsPanelProps {
  fileOrder: string[]
  commentsByPath: Map<string, PRComment[]>
  resolvedById: Map<number, boolean>
  outdatedById: Map<number, boolean>
  threadIdByRootId: Map<number, string>
  currentUserLogin: string | undefined
  pendingComments: PendingComment[]
  onGoToComment: GoToComment
  onSubmitReply: (rootId: number, path: string, line: number, side: 'additions' | 'deletions', body: string) => Promise<void> | void
  onResolveThread: (threadId: string) => Promise<void> | void
  onUnresolveThread: (threadId: string) => Promise<void> | void
  onEditComment: (commentId: number, body: string) => Promise<void> | void
  onDeleteComment: (commentId: number) => Promise<void> | void
  onDiscardPending: (c: PendingComment) => void
  isSubmitting: boolean
}

interface Thread {
  root: PRComment
  replies: PRComment[]
  resolved: boolean
  outdated: boolean
  threadId: string | undefined
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
  threadIdByRootId: Map<number, string>,
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
    threadId: threadIdByRootId.get(root.id),
  }))
}

export function CommentsPanel({
  fileOrder,
  commentsByPath,
  resolvedById,
  outdatedById,
  threadIdByRootId,
  currentUserLogin,
  pendingComments,
  onGoToComment,
  onSubmitReply,
  onResolveThread,
  onUnresolveThread,
  onEditComment,
  onDeleteComment,
  onDiscardPending,
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
    for (const path of commentsByPath.keys()) {
      if (!seen.has(path)) {
        seen.add(path)
        ordered.push(path)
      }
    }
    return ordered.map((path) => ({
      path,
      threads: buildThreads(commentsByPath.get(path) ?? [], resolvedById, outdatedById, threadIdByRootId),
    }))
  }, [fileOrder, commentsByPath, resolvedById, outdatedById, threadIdByRootId])

  const toggleThread = (id: number) => {
    setExpandedThreadIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totalThreads = groups.reduce((sum, g) => sum + g.threads.length, 0)
  const totalCount = totalThreads + pendingComments.length

  return (
    <div className="h-full w-full overflow-hidden flex flex-col">
      <div className="px-3 py-2 border-b">
        <div className="text-sm font-medium text-muted-foreground">
          Comments ({totalCount})
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {pendingComments.length > 0 && (
          <div className="border-b">
            <div className="px-3 py-1.5 sticky top-0 bg-amber-50 dark:bg-amber-950/40 text-xs font-medium border-b text-amber-700 dark:text-amber-400">
              Pending ({pendingComments.length}) — staged for review
            </div>
            {pendingComments.map((c) => (
              <PendingCommentRow
                key={`${c.path}:${c.line}:${c.side}`}
                comment={c}
                onGoToComment={onGoToComment}
                onDiscard={onDiscardPending}
              />
            ))}
          </div>
        )}
        {totalThreads === 0 && pendingComments.length === 0 ? (
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
                  currentUserLogin={currentUserLogin}
                  onToggle={() => toggleThread(thread.root.id)}
                  onGoToComment={onGoToComment}
                  onSubmitReply={onSubmitReply}
                  onResolveThread={onResolveThread}
                  onUnresolveThread={onUnresolveThread}
                  onEditComment={onEditComment}
                  onDeleteComment={onDeleteComment}
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

function PendingCommentRow({
  comment,
  onGoToComment,
  onDiscard,
}: {
  comment: PendingComment
  onGoToComment: GoToComment
  onDiscard: (c: PendingComment) => void
}) {
  const isMultiLine = comment.startLine != null && comment.startLine !== comment.line
  const canNavigate = comment.line != null

  return (
    <div className="group w-full text-left px-3 py-2 hover:bg-muted/50 flex gap-2 items-start">
      <div className="w-5 h-5 flex-shrink-0 mt-0.5 rounded-full bg-amber-400/20 flex items-center justify-center">
        <span className="text-[9px] text-amber-600 dark:text-amber-400 font-bold">P</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400">You</span>
          <span className="text-xs text-muted-foreground truncate max-w-[140px]">
            {comment.path.split('/').pop()}
          </span>
          {comment.line != null && (
            <span className="text-[10px] px-1 rounded bg-muted text-muted-foreground">
              {isMultiLine ? `L${comment.startLine}-${comment.line}` : `L${comment.line}`}
            </span>
          )}
          <span className="text-[10px] px-1 rounded bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            pending
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{comment.body}</div>
      </div>
      <div className="flex-shrink-0 flex items-center gap-0.5">
        {canNavigate && (
          <button
            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted text-muted-foreground"
            title="Go to location in diff"
            onClick={() => onGoToComment(comment.path, comment.line, comment.side)}
          >
            <ArrowRight className="size-3.5" />
          </button>
        )}
        <button
          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted text-destructive"
          title="Discard pending comment"
          onClick={() => onDiscard(comment)}
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function ThreadRow({
  thread,
  expanded,
  currentUserLogin,
  onToggle,
  onGoToComment,
  onSubmitReply,
  onResolveThread,
  onUnresolveThread,
  onEditComment,
  onDeleteComment,
  isSubmitting,
}: {
  thread: Thread
  expanded: boolean
  currentUserLogin: string | undefined
  onToggle: () => void
  onGoToComment: GoToComment
  onSubmitReply: CommentsPanelProps['onSubmitReply']
  onResolveThread: CommentsPanelProps['onResolveThread']
  onUnresolveThread: CommentsPanelProps['onUnresolveThread']
  onEditComment: CommentsPanelProps['onEditComment']
  onDeleteComment: CommentsPanelProps['onDeleteComment']
  isSubmitting: boolean
}) {
  const { root, replies, resolved, outdated, threadId } = thread
  const [resolvePending, setResolvePending] = useState(false)
  const collapsedByDefault = resolved && !expanded
  const isMultiLine = root.start_line != null && root.line != null && root.start_line !== root.line
  const side = root.side === 'LEFT' ? ('deletions' as const) : ('additions' as const)
  const canNavigate = !outdated && root.line != null

  const goToLocation = () => {
    if (canNavigate) onGoToComment(root.path, root.line!, side)
  }

  const handleRowActivate = () => {
    if (!expanded && canNavigate) goToLocation()
    onToggle()
  }

  const handleToggleResolved = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!threadId || resolvePending) return
    setResolvePending(true)
    try {
      if (resolved) {
        await onUnresolveThread(threadId)
      } else {
        await onResolveThread(threadId)
      }
    } finally {
      setResolvePending(false)
    }
  }

  return (
    <div className={collapsedByDefault ? 'opacity-50' : undefined}>
      <div
        className="group w-full text-left px-3 py-2 hover:bg-muted/50 flex gap-2 items-start cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={handleRowActivate}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleRowActivate()
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
        <div className="flex-shrink-0 flex items-center gap-0.5">
          {threadId && (
            <button
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted text-muted-foreground disabled:opacity-40"
              title={resolved ? 'Unresolve thread' : 'Resolve thread'}
              disabled={resolvePending}
              onClick={handleToggleResolved}
            >
              {resolved ? (
                <RotateCcw className="size-3.5" />
              ) : (
                <Check className="size-3.5" />
              )}
            </button>
          )}
          {canNavigate && (
            <button
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted text-muted-foreground"
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
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <ThreadComment
            comment={root}
            isOwnComment={currentUserLogin != null && root.user.login === currentUserLogin}
            onEdit={onEditComment}
            onDelete={onDeleteComment}
          />
          {replies.map((reply) => (
            <ThreadComment
              key={reply.id}
              comment={reply}
              isReply
              isOwnComment={currentUserLogin != null && reply.user.login === currentUserLogin}
              onEdit={onEditComment}
              onDelete={onDeleteComment}
            />
          ))}
          {root.line != null && (
            <ReplyComposer
              onSubmit={(body) => onSubmitReply(root.id, root.path, root.line!, side, body)}
            />
          )}
        </div>
      )}
    </div>
  )
}

function ThreadComment({
  comment,
  isReply,
  isOwnComment,
  onEdit,
  onDelete,
}: {
  comment: PRComment
  isReply?: boolean
  isOwnComment: boolean
  onEdit: (commentId: number, body: string) => Promise<void> | void
  onDelete: (commentId: number) => Promise<void> | void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [menuOpen])

  return (
    <div className={isReply ? 'pl-3 border-l-2 border-muted' : undefined}>
      <div className="flex items-center gap-1.5 group/comment">
        <img
          src={comment.user.avatar_url}
          alt={comment.user.login}
          className="w-4 h-4 rounded-full"
        />
        <span className="text-xs font-medium">{comment.user.login}</span>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(comment.created_at)}
        </span>
        {isOwnComment && !editMode && (
          <div className="relative ml-auto" ref={menuRef}>
            <button
              className="opacity-0 group-hover/comment:opacity-100 p-0.5 rounded hover:bg-muted text-muted-foreground"
              title="More options"
              onClick={() => setMenuOpen((prev) => !prev)}
            >
              <MoreHorizontal className="size-3.5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-5 z-10 bg-popover border rounded shadow-md py-1 min-w-[120px]">
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted text-left"
                  onClick={() => {
                    setMenuOpen(false)
                    setEditMode(true)
                  }}
                >
                  <Pencil className="size-3" />
                  Edit
                </button>
                <button
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-muted text-left text-destructive"
                  onClick={async () => {
                    setMenuOpen(false)
                    await onDelete(comment.id)
                  }}
                >
                  <Trash2 className="size-3" />
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {editMode ? (
        <InlineEditor
          initialBody={comment.body}
          onSave={async (body) => {
            await onEdit(comment.id, body)
            setEditMode(false)
          }}
          onCancel={() => setEditMode(false)}
        />
      ) : (
        <div className="text-xs mt-0.5 whitespace-pre-wrap break-words">{comment.body}</div>
      )}
    </div>
  )
}

function InlineEditor({
  initialBody,
  onSave,
  onCancel,
}: {
  initialBody: string
  onSave: (body: string) => Promise<void>
  onCancel: () => void
}) {
  const [body, setBody] = useState(initialBody)
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true })
    textareaRef.current?.select()
  }, [])

  const save = async () => {
    const value = body.trim()
    if (!value || saving) return
    setSaving(true)
    try {
      await onSave(value)
    } catch {
      // Keep draft on error
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-1 mt-1">
      <textarea
        ref={textareaRef}
        className="w-full text-xs border rounded p-1.5 bg-background resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        rows={3}
        value={body}
        disabled={saving}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void save()
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <div className="flex items-center justify-end gap-1.5">
        <button
          className="text-xs px-2 py-0.5 rounded border hover:bg-muted disabled:opacity-50"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground disabled:opacity-50"
          disabled={saving || !body.trim() || body.trim() === initialBody.trim()}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function ReplyComposer({
  onSubmit,
}: {
  onSubmit: (body: string) => Promise<void> | void
}) {
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true })
  }, [])

  const submit = async () => {
    const value = body.trim()
    if (!value || posting) return
    setPosting(true)
    try {
      await onSubmit(value)
      setBody('')
    } catch {
      // Keep the draft so the user can retry without retyping.
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="space-y-1 pt-2 mt-1 border-t border-border/60">
      <textarea
        ref={textareaRef}
        className="w-full text-xs border rounded p-1.5 bg-background resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        rows={2}
        placeholder="Reply…"
        value={body}
        disabled={posting}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground select-none">
          ⌘↵ to send
        </span>
        <button
          className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground disabled:opacity-50"
          disabled={posting || !body.trim()}
          onClick={() => void submit()}
        >
          {posting ? 'Posting…' : 'Reply'}
        </button>
      </div>
    </div>
  )
}
