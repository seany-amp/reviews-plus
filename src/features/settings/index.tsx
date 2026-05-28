import { useEffect, useState } from 'react'
import { Eye, EyeOff, KeyRound, Trash2, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
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
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ valid: boolean; username?: string } | null>(null)

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
      setTestResult(null)
      toast.success('Token deleted')
    } catch (err) {
      toast.error(
        `Failed to delete token: ${err instanceof Error ? err.message : 'Unknown error'}`,
      )
    }
  }

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await invoke<string>('github_fetch', { endpoint: '/user' })
      const user = typeof result === 'string' ? JSON.parse(result) : result
      setTestResult({ valid: true, username: user.login })
      toast.success(`Connected as ${user.login}`)
    } catch {
      setTestResult({ valid: false })
      toast.error('Connection failed. Token may be invalid.')
    } finally {
      setTesting(false)
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

            {testResult && (
              <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
                testResult.valid
                  ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800'
                  : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800'
              }`}>
                {testResult.valid ? (
                  <>
                    <CheckCircle2 className="size-4 shrink-0" />
                    <span>Connected as <strong>{testResult.username}</strong></span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-4 shrink-0" />
                    <span>Connection failed. Token may be invalid or expired.</span>
                  </>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleTestConnection}
                disabled={testing}
              >
                {testing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {testing ? 'Testing...' : 'Test Connection'}
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleDelete}
              >
                <Trash2 data-icon="inline-start" />
                Delete Token
              </Button>
            </div>
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
