import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { parsePRUrl, type PRIdentifier } from "@/lib/github/parse-url"

interface PRUrlInputProps {
  onNavigate: (identifier: PRIdentifier) => void
}

export function PRUrlInput({ onNavigate }: PRUrlInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.metaKey && e.key === "o") {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  function submit(input: string) {
    const trimmed = input.trim()
    if (!trimmed) {
      setError(null)
      return
    }

    const result = parsePRUrl(trimmed)
    if (result) {
      setError(null)
      onNavigate(result)
    } else {
      setError("Invalid PR URL. Use https://github.com/owner/repo/pull/123 or owner/repo#123")
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      submit(value)
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text")
    const result = parsePRUrl(pasted)
    if (result) {
      e.preventDefault()
      setValue(pasted)
      setError(null)
      onNavigate(result)
    }
  }

  return (
    <div className="border-b py-2 px-4">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          if (error) setError(null)
        }}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder="Paste GitHub PR URL... (⌘O to focus)"
        aria-invalid={!!error}
        className="w-full"
      />
      {error && (
        <p className="text-sm text-destructive mt-1">{error}</p>
      )}
    </div>
  )
}
