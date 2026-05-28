import { prMetadata, prFiles, prComments, prReviews, prDiff } from './fixtures';

type InvokeArgs = Record<string, unknown>;

const ENDPOINT_PATTERNS: Array<{
  pattern: RegExp;
  fixture: unknown;
}> = [
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
