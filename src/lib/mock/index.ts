import { prMetadata, prFiles, prComments, prReviews, prDiff } from './fixtures';

type InvokeArgs = Record<string, unknown>;

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
    },
    {
      number: 15422,
      title: "fix(nsis): embed signed copies of stock plugins",
      repository_url: "https://api.github.com/repos/tauri-apps/tauri",
      user: { login: "koki-develop", avatar_url: "https://avatars.githubusercontent.com/u/7654321" },
      created_at: "2026-05-21T14:30:00Z",
      pull_request: { url: "https://api.github.com/repos/tauri-apps/tauri/pulls/15422" },
      labels: [],
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

  const accept = args.accept as string | undefined;
  if (accept && accept.includes('diff')) {
    return prDiff;
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
    case 'get_token':
      return 'ghp_mock_token_12345' as T;

    case 'store_token':
      return undefined as T;

    case 'delete_token':
      return undefined as T;

    case 'github_fetch':
      return resolveGithubFetch(args ?? {}) as T;

    case 'github_fetch_diff':
      return prDiff as T;

    default:
      throw new Error(`[mockInvoke] Unknown command: ${command}`);
  }
}
