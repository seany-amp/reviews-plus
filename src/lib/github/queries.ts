import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/mock/invoke'
import type {
  PRMetadata,
  PRFile,
  PRComment,
  PRReview,
  PRReviewThread,
  SearchIssueItem,
  CheckRun,
  CheckRunsResponse,
  CommitStatus,
} from './types'

async function githubFetch<T>(
  endpoint: string,
  options?: { accept?: string; method?: string; body?: string },
): Promise<T> {
  let result: string | T
  try {
    result = await invoke<string | T>('github_fetch', {
      endpoint,
      ...options,
    })
  } catch (err) {
    throw new Error(typeof err === 'string' ? err : String(err))
  }
  if (typeof result === 'string') {
    return JSON.parse(result) as T
  }
  return result as T
}

async function githubGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  let raw: string
  try {
    raw = await invoke<string>('github_graphql', {
      body: JSON.stringify({ query, variables }),
    })
  } catch (err) {
    throw new Error(typeof err === 'string' ? err : String(err))
  }
  const parsed = JSON.parse(raw) as { data?: T; errors?: Array<{ message: string }> }
  if (parsed.errors?.length) {
    throw new Error(parsed.errors.map((e) => e.message).join('; '))
  }
  return parsed.data as T
}

async function githubFetchDiff(endpoint: string): Promise<string> {
  try {
    return await invoke<string>('github_fetch', {
      endpoint,
      accept: 'application/vnd.github.diff',
    })
  } catch (err) {
    const msg = typeof err === 'string' ? err : String(err)
    if (msg.includes('406') || msg.includes('too_large')) {
      return fetchDiffFromFiles(endpoint)
    }
    throw new Error(msg)
  }
}

async function fetchDiffFromFiles(prEndpoint: string): Promise<string> {
  const files = await fetchAllFiles(prEndpoint)
  return files
    .filter((f) => f.patch)
    .map((f) => {
      const header = `diff --git a/${f.filename} b/${f.filename}\n--- a/${f.filename}\n+++ b/${f.filename}\n`
      return header + f.patch
    })
    .join('\n')
}

async function fetchAllFiles(prEndpoint: string): Promise<PRFile[]> {
  const allFiles: PRFile[] = []
  let page = 1
  while (true) {
    const batch = await githubFetch<PRFile[]>(
      `${prEndpoint}/files?per_page=100&page=${page}`,
    )
    allFiles.push(...batch)
    if (batch.length < 100) break
    page++
  }
  return allFiles
}

export function usePRMetadata(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: ['pr', owner, repo, number, 'metadata'],
    queryFn: () =>
      githubFetch<PRMetadata>(`/repos/${owner}/${repo}/pulls/${number}`),
    staleTime: 30_000,
  })
}

export function usePRDiff(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: ['pr', owner, repo, number, 'diff'],
    queryFn: () =>
      githubFetchDiff(`/repos/${owner}/${repo}/pulls/${number}`),
    staleTime: 5 * 60_000,
  })
}

export function usePRFiles(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: ['pr', owner, repo, number, 'files'],
    queryFn: () =>
      githubFetch<PRFile[]>(
        `/repos/${owner}/${repo}/pulls/${number}/files`,
      ),
    staleTime: 5 * 60_000,
  })
}

export function usePRComments(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: ['pr', owner, repo, number, 'comments'],
    queryFn: () =>
      githubFetch<PRComment[]>(
        `/repos/${owner}/${repo}/pulls/${number}/comments`,
      ),
    staleTime: 15_000,
  })
}

export function usePRReviews(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: ['pr', owner, repo, number, 'reviews'],
    queryFn: () =>
      githubFetch<PRReview[]>(
        `/repos/${owner}/${repo}/pulls/${number}/reviews`,
      ),
    staleTime: 30_000,
  })
}

const REVIEW_THREADS_QUERY = `
  query ($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            isResolved
            isOutdated
            comments(first: 100) {
              nodes {
                databaseId
              }
            }
          }
        }
      }
    }
  }
`

interface ReviewThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: { nodes: PRReviewThread[] }
    } | null
  } | null
}

export function usePRReviewThreads(owner: string, repo: string, number: number) {
  return useQuery({
    queryKey: ['pr', owner, repo, number, 'threads'],
    queryFn: async () => {
      const data = await githubGraphQL<ReviewThreadsResponse>(REVIEW_THREADS_QUERY, {
        owner,
        repo,
        number,
      })
      return data.repository?.pullRequest?.reviewThreads.nodes ?? []
    },
    staleTime: 15_000,
  })
}

export function useMyPRs() {
  return useQuery({
    queryKey: ['my-prs'],
    queryFn: () =>
      githubFetch<{ items: SearchIssueItem[] }>(
        '/search/issues?q=is:pr+is:open+author:@me',
      ),
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

export interface SubmitReviewParams {
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
  body: string
}

export function useSubmitReview(owner: string, repo: string, number: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: SubmitReviewParams) =>
      githubFetch<PRReview>(
        `/repos/${owner}/${repo}/pulls/${number}/reviews`,
        {
          method: 'POST',
          body: JSON.stringify(params),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pr', owner, repo, number, 'reviews'] })
      queryClient.invalidateQueries({ queryKey: ['pr', owner, repo, number, 'threads'] })
    },
  })
}

export interface MergedCheckRun {
  id: string
  name: string
  status: string
  conclusion: string | null
  url: string
}

function mergeChecks(checkRuns: CheckRun[], combined: CommitStatus): MergedCheckRun[] {
  const runs: MergedCheckRun[] = checkRuns.map((r) => ({
    id: `check-${r.id}`,
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    url: r.html_url,
  }))
  const statusEntries: MergedCheckRun[] = combined.statuses.map((s) => ({
    id: `status-${s.id}`,
    name: s.context,
    status: 'completed',
    conclusion: s.state === 'success' ? 'success' : s.state === 'pending' ? null : 'failure',
    url: s.target_url ?? '',
  }))
  return [...runs, ...statusEntries]
}

export type ChecksAggregate =
  | 'success'
  | 'failure'
  | 'pending'
  | 'none'

export function aggregateChecks(checks: MergedCheckRun[]): ChecksAggregate {
  if (checks.length === 0) return 'none'
  if (checks.some((c) => c.status !== 'completed' || c.conclusion == null)) return 'pending'
  if (checks.some((c) => c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required')) return 'failure'
  return 'success'
}

export function useChecks(owner: string, repo: string, sha: string) {
  return useQuery({
    queryKey: ['commits', owner, repo, sha, 'checks'],
    queryFn: async () => {
      const [runsResponse, combined] = await Promise.all([
        githubFetch<CheckRunsResponse>(
          `/repos/${owner}/${repo}/commits/${sha}/check-runs`,
        ),
        githubFetch<CommitStatus>(
          `/repos/${owner}/${repo}/commits/${sha}/status`,
        ),
      ])
      return mergeChecks(runsResponse.check_runs, combined)
    },
    staleTime: 30_000,
    enabled: Boolean(sha),
  })
}

interface PostCommentParams {
  body: string
  path: string
  line: number
  commit_id: string
  side?: string
  start_line?: number
  start_side?: string
  in_reply_to?: number
}

export function usePostComment(
  owner: string,
  repo: string,
  number: number,
) {
  const queryClient = useQueryClient()
  const commentsKey = ['pr', owner, repo, number, 'comments'] as const
  return useMutation({
    mutationFn: (params: PostCommentParams) =>
      githubFetch<PRComment>(
        `/repos/${owner}/${repo}/pulls/${number}/comments`,
        {
          method: 'POST',
          body: JSON.stringify(params),
        },
      ),
    onMutate: async (params): Promise<{ previous: PRComment[] | undefined; tempId: number }> => {
      await queryClient.cancelQueries({ queryKey: commentsKey })
      const previous = queryClient.getQueryData<PRComment[]>(commentsKey)
      const tempId = -Date.now()
      const optimistic: PRComment = {
        id: tempId,
        user: { login: 'You', avatar_url: '' },
        body: params.body,
        path: params.path,
        line: params.line,
        start_line: params.start_line ?? null,
        side: params.side ?? 'RIGHT',
        created_at: new Date().toISOString(),
        ...(params.in_reply_to != null ? { in_reply_to_id: params.in_reply_to } : {}),
      }
      queryClient.setQueryData<PRComment[]>(commentsKey, (old) => [...(old ?? []), optimistic])
      return { previous, tempId }
    },
    onError: (_err, _params, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(commentsKey, context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: commentsKey })
    },
  })
}
