export interface PRMetadata {
  number: number
  title: string
  body: string | null
  state: string
  user: { login: string; avatar_url: string }
  head: { ref: string; sha: string }
  base: { ref: string }
  additions: number
  deletions: number
  changed_files: number
  mergeable: boolean | null
  labels: Array<{ name: string; color: string }>
  requested_reviewers: Array<{ login: string; avatar_url: string }>
  created_at: string
  updated_at: string
}

export interface PRFile {
  filename: string
  status: string // "added" | "removed" | "modified" | "renamed"
  additions: number
  deletions: number
  patch?: string
}

export interface PRComment {
  id: number
  user: { login: string; avatar_url: string }
  body: string
  path: string
  line: number | null
  start_line?: number | null
  side: string // "LEFT" | "RIGHT"
  start_side?: string // "LEFT" | "RIGHT"
  created_at: string
  in_reply_to_id?: number
}

export interface PRReview {
  id: number
  user: { login: string; avatar_url: string }
  state: string // "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING"
  body: string | null
  submitted_at: string
}

export interface PRReviewThread {
  isResolved: boolean
  isOutdated: boolean
  comments: { nodes: Array<{ databaseId: number | null }> }
}

export interface SearchIssueItem {
  number: number
  title: string
  repository_url: string
  user: { login: string; avatar_url: string }
  created_at: string
  labels: Array<{ name: string; color: string }>
  pull_request: { url: string }
  state?: string // "open" | "closed"
  draft?: boolean
  comments?: number
  review_comments?: number
}
