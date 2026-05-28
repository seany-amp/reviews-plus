import { useMyPRs } from '@/lib/github/queries'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PRIdentifier } from '@/lib/github/parse-url'
import type { SearchIssueItem } from '@/lib/github/types'

function relativeTime(dateString: string): string {
  const now = Date.now()
  const then = new Date(dateString).getTime()
  const diffMs = now - then
  const diffMinutes = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
}

function parseRepoFromUrl(repositoryUrl: string): { owner: string; repo: string } {
  const parts = repositoryUrl.replace(/\/$/, '').split('/')
  return { owner: parts[parts.length - 2], repo: parts[parts.length - 1] }
}

interface MyPRsViewProps {
  onOpenPR: (pr: PRIdentifier) => void
}

export function MyPRsView({ onOpenPR }: MyPRsViewProps) {
  const { data, isLoading, error, refetch } = useMyPRs()

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="animate-pulse py-3 border-b">
            <div className="h-4 bg-muted rounded w-3/4 mb-2" />
            <div className="flex gap-3">
              <div className="h-3 bg-muted rounded w-24" />
              <div className="h-3 bg-muted rounded w-20" />
              <div className="h-3 bg-muted rounded w-16" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="size-6 text-destructive" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-medium">Failed to load PRs</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  const items = data?.items ?? []

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center">
        No open PRs found
      </p>
    )
  }

  return (
    <ul className="divide-y">
      {items.map((item: SearchIssueItem) => {
        const { owner, repo } = parseRepoFromUrl(item.repository_url)
        return (
          <li
            key={`${owner}/${repo}#${item.number}`}
            className="py-3 px-2 cursor-pointer hover:bg-accent rounded transition-colors"
            onClick={() => onOpenPR({ owner, repo, number: item.number })}
          >
            <p className="font-bold text-sm truncate">{item.title}</p>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span>{owner}/{repo}</span>
              <span className="flex items-center gap-1">
                <img
                  src={item.user.avatar_url}
                  alt={item.user.login}
                  className="w-4 h-4 rounded-full"
                />
                {item.user.login}
              </span>
              <span>{relativeTime(item.created_at)}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
