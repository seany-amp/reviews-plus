type InvokeArgs = Record<string, unknown>;

export async function invoke<T = unknown>(
  command: string,
  args?: InvokeArgs,
): Promise<T> {
  // Check every call — __TAURI_INTERNALS__ may not exist when module first loads
  const hasTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  if (!hasTauri) {
    const { mockInvoke } = await import('./index');
    return mockInvoke<T>(command, args);
  }

  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(command, args);
}
