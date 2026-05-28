import type { PRIdentifier } from "@/lib/github/parse-url"

interface ReviewViewProps {
  pr: PRIdentifier | null
}

export function ReviewView({ pr }: ReviewViewProps) {
  if (!pr) {
    return (
      <div className="text-muted-foreground">
        Paste a PR URL above to start reviewing
      </div>
    )
  }

  return (
    <div>
      Loading PR: {pr.owner}/{pr.repo}#{pr.number}
    </div>
  )
}
