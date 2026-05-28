type InvokeArgs = Record<string, unknown>;

function isMockMode(): boolean {
  return typeof window === 'undefined' || !('__TAURI__' in window);
}

export async function invoke<T = unknown>(
  command: string,
  args?: InvokeArgs,
): Promise<T> {
  if (isMockMode()) {
    const { mockInvoke } = await import('./index');
    return mockInvoke<T>(command, args);
  }

  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}
