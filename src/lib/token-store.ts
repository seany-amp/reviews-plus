interface TokenStore {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  save(): Promise<void>
}

const memoryStore = new Map<string, unknown>()

const mockStore: TokenStore = {
  async get<T>(key: string): Promise<T | null> {
    return (memoryStore.get(key) as T) ?? null
  },
  async set(key: string, value: unknown) {
    memoryStore.set(key, value)
  },
  async delete(key: string) {
    memoryStore.delete(key)
  },
  async save() {},
}

let _storePromise: Promise<TokenStore> | null = null

export function getTokenStore(): Promise<TokenStore> {
  if (_storePromise) return _storePromise

  _storePromise = (async () => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return mockStore
    }

    const { Store } = await import('@tauri-apps/plugin-store')
    const store = await Store.load('settings.json')
    return store as unknown as TokenStore
  })()

  return _storePromise
}
