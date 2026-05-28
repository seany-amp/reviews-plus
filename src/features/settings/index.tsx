import { useEffect, useState } from 'react'
import { Eye, EyeOff, KeyRound, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { invoke } from '@/lib/mock/invoke'

function maskToken(token: string): string {
  if (token.length <= 8) return '••••••••'
  const prefix = token.slice(0, 4)
  const suffix = token.slice(-4)
  return `${prefix}${'••••'}...${suffix}`
}

export function SettingsView() {
  const [token, setToken] = useState('')
  const [storedToken, setStoredToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    checkToken()
  }, [])

  async function checkToken() {
    try {
      const existing = await invoke<string>('get_token')
      if (existing) {
        setStoredToken(existing)
      }
    } catch {
      setStoredToken(null)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!token.trim()) {
      toast.error('Please enter a token')
      return
    }

    setSaving(true)
    try {
      await invoke('store_token', { token: token.trim() })
      setStoredToken(token.trim())
      setToken('')
      setShowPassword(false)
      toast.success('Token saved successfully')
    } catch (err) {
      toast.error(
        `Failed to save token: ${err instanceof Error ? err.message : 'Unknown error'}`,
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    try {
      await invoke('delete_token')
      setStoredToken(null)
      toast.success('Token deleted')
    } catch (err) {
      toast.error(
        `Failed to delete token: ${err instanceof Error ? err.message : 'Unknown error'}`,
      )
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="size-6 text-primary" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            Connect GitHub
          </h1>
          <p className="text-sm text-muted-foreground">
            Add a Personal Access Token with <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">repo</code> scope to
            pull your reviews and PRs.
          </p>
        </div>

        {storedToken ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3">
              <KeyRound className="size-4 text-muted-foreground shrink-0" />
              <span className="flex-1 font-mono text-sm">
                {maskToken(storedToken)}
              </span>
            </div>
            <Button
              variant="destructive"
              className="w-full"
              onClick={handleDelete}
            >
              <Trash2 data-icon="inline-start" />
              Delete Token
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave()
                }}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showPassword ? 'Hide token' : 'Show token'}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
            <Button
              className="w-full"
              onClick={handleSave}
              disabled={saving || !token.trim()}
            >
              {saving ? 'Saving...' : 'Save Token'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
