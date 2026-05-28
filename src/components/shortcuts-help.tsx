interface ShortcutsHelpProps {
  visible: boolean
}

const shortcuts = [
  { keys: '?', description: 'Show this help' },
  { keys: 'j / k', description: 'Next / previous file' },
  { keys: 'c', description: 'Comment on line' },
  { keys: '⌘P', description: 'Jump to file' },
  { keys: '⌘B', description: 'Toggle file sidebar' },
  { keys: '⌘O', description: 'Focus URL input' },
  { keys: '⌘Enter', description: 'Submit comment' },
  { keys: 'Esc', description: 'Cancel / close' },
]

export function ShortcutsHelp({ visible }: ShortcutsHelpProps) {
  if (!visible) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 w-64 rounded-lg border bg-popover/95 p-4 shadow-lg backdrop-blur-sm">
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        Keyboard Shortcuts
      </h3>
      <ul className="space-y-1.5">
        {shortcuts.map(({ keys, description }) => (
          <li key={keys} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{description}</span>
            <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              {keys}
            </kbd>
          </li>
        ))}
      </ul>
    </div>
  )
}
