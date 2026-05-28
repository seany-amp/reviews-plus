import { useEffect } from 'react'

interface ShortcutConfig {
  key: string
  metaKey?: boolean
  handler: () => void
  ignoreInput?: boolean
}

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable

      for (const shortcut of shortcuts) {
        if (shortcut.ignoreInput && isInput) continue
        if (shortcut.metaKey && !e.metaKey) continue
        if (!shortcut.metaKey && e.metaKey) continue
        if (e.key === shortcut.key) {
          e.preventDefault()
          shortcut.handler()
          return
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [shortcuts])
}
