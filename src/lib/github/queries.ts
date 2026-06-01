import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/mock/invoke'
import type { PRMetadata, PRFile, PRComment, PRReview, SearchIssueItem } from './types'

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

export function usePostComment(
  owner: string,
  repo: string,
  number: number,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (params: {
      body: string
      path: string
      line: number
      commit_id: string
      side?: string
      in_reply_to?: number
    }) =>
      githubFetch<PRComment>(
        `/repos/${owner}/${repo}/pulls/${number}/comments`,
        {
          method: 'POST',
          body: JSON.stringify(params),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['pr', owner, repo, number, 'comments'],
      })
    },
  })
}
