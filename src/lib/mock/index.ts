import {
  prMetadata,
  prFiles,
  prComments,
  prReviews,
  prDiff,
  stressMetadata,
  stressFiles,
  stressDiff,
} from './fixtures';

type InvokeArgs = Record<string, unknown>;

function isStressMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.localStorage?.getItem('reviews-plus:stress') === '1') return true;
  return new URLSearchParams(window.location.search).get('stress') === '1';
}

const searchIssuesFixture = {
  items: [
    {
      number: 34417,
      title: "feat(ext/crypto): add ChaCha20-Poly1305 support",
      repository_url: "https://api.github.com/repos/denoland/deno",
      user: { login: "divybot", avatar_url: "https://avatars.githubusercontent.com/u/1234567" },
      created_at: "2026-05-26T10:00:00Z",
      pull_request: { url: "https://api.github.com/repos/denoland/deno/pulls/34417" },
      labels: [],
      state: "open",
      draft: false,
      comments: 4,
      review_comments: 7,
    },
    {
      number: 15422,
      title: "fix(nsis): embed signed copies of stock plugins",
      repository_url: "https://api.github.com/repos/tauri-apps/tauri",
      user: { login: "koki-develop", avatar_url: "https://avatars.githubusercontent.com/u/7654321" },
      created_at: "2026-05-21T14:30:00Z",
      pull_request: { url: "https://api.github.com/repos/tauri-apps/tauri/pulls/15422" },
      labels: [],
      state: "open",
      draft: true,
      comments: 1,
      review_comments: 0,
    },
  ],
};

const userFixture = {
  login: 'octocat',
  id: 1,
  avatar_url: 'https://avatars.githubusercontent.com/u/583231',
  name: 'The Octocat',
};

const ENDPOINT_PATTERNS: Array<{
  pattern: RegExp;
  fixture: unknown;
}> = [
  { pattern: /^\/user$/, fixture: userFixture },
  { pattern: /\/search\/issues/, fixture: searchIssuesFixture },
  { pattern: /\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/files$/, fixture: prFiles },
  { pattern: /\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/comments$/, fixture: prComments },
  { pattern: /\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/reviews$/, fixture: prReviews },
  { pattern: /\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/, fixture: prMetadata },
];

function resolveGithubFetch(args: InvokeArgs): unknown {
  const endpoint = args.endpoint as string | undefined;
  if (!endpoint) {
    throw new Error('[mockInvoke] github_fetch requires an "endpoint" argument');
  }

  const stress = isStressMode();
  const accept = args.accept as string | undefined;

  if (accept && accept.includes('diff')) {
    // Mirror GitHub's real behavior on huge PRs: the unified-diff endpoint
    // returns 406, forcing the app's per-file reconstruction fallback.
    if (stress) {
      throw new Error(
        'GitHub API error (406): Sorry, the diff exceeded the maximum number of lines (20000)',
      );
    }
    return prDiff;
  }

  if (/\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/files/.test(endpoint)) {
    if (!stress) return prFiles;
    // Honor pagination so the app's fetchAllFiles loop terminates.
    const all = stressFiles as unknown[];
    const pageMatch = endpoint.match(/[?&]page=(\d+)/);
    const perMatch = endpoint.match(/[?&]per_page=(\d+)/);
    if (!pageMatch) return all;
    const page = Number(pageMatch[1]);
    const per = perMatch ? Number(perMatch[1]) : 100;
    const start = (page - 1) * per;
    return all.slice(start, start + per);
  }
  if (/\/repos\/[^/]+\/[^/]+\/pulls\/\d+$/.test(endpoint)) {
    return stress ? stressMetadata : prMetadata;
  }

  for (const { pattern, fixture } of ENDPOINT_PATTERNS) {
    if (pattern.test(endpoint)) {
      return fixture;
    }
  }

  throw new Error(`[mockInvoke] No fixture matched endpoint: ${endpoint}`);
}

export async function mockInvoke<T = unknown>(
  command: string,
  args?: InvokeArgs,
): Promise<T> {
  // Simulate async network delay
  await new Promise((resolve) => setTimeout(resolve, 50));

  switch (command) {
    case 'github_fetch':
      return resolveGithubFetch(args ?? {}) as T;

    case 'github_fetch_diff':
      return prDiff as T;

    default:
      throw new Error(`[mockInvoke] Unknown command: ${command}`);
  }
}
