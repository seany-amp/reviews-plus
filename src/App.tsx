import { useState } from "react"
import { GitPullRequest, List, Settings, Diff } from "lucide-react"
import { ReviewView } from "./features/review"
import { MyPRsView } from "./features/my-prs"
import { SettingsView } from "./features/settings"
import { LocalDiffView } from "./features/local-diff"
import { PRUrlInput } from "./components/pr-url-input"
import { Button } from "./components/ui/button"
import type { PRIdentifier } from "./lib/github/parse-url"

type View = "review" | "my-prs" | "local-diff" | "settings"

function App() {
  const [view, setView] = useState<View>("review")
  const [currentPR, setCurrentPR] = useState<PRIdentifier | null>(null)

  function handleNavigate(identifier: PRIdentifier) {
    setCurrentPR(identifier)
    setView("review")
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="sticky top-0 z-10 bg-background">
        <PRUrlInput onNavigate={handleNavigate} />
        <nav className="flex items-center gap-1 p-2 border-b">
          <div className="flex items-center gap-2 pl-1 pr-3 mr-1 border-r">
            <img src="/logo.svg" alt="reviews-plus logo" className="size-6" />
            <span className="text-sm font-semibold tracking-tight">
              reviews<span className="text-green-600">+</span>
            </span>
          </div>
          <Button
            variant={view === "review" ? "secondary" : "ghost"}
            size="sm"
            aria-current={view === "review" ? "page" : undefined}
            onClick={() => setView("review")}
          >
            <GitPullRequest className="size-4" />
            Review
          </Button>
          <Button
            variant={view === "my-prs" ? "secondary" : "ghost"}
            size="sm"
            aria-current={view === "my-prs" ? "page" : undefined}
            onClick={() => setView("my-prs")}
          >
            <List className="size-4" />
            My PRs
          </Button>
          <Button
            variant={view === "local-diff" ? "secondary" : "ghost"}
            size="sm"
            aria-current={view === "local-diff" ? "page" : undefined}
            onClick={() => setView("local-diff")}
          >
            <Diff className="size-4" />
            Local Diff
          </Button>
          <Button
            variant={view === "settings" ? "secondary" : "ghost"}
            size="sm"
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => setView("settings")}
          >
            <Settings className="size-4" />
            Settings
          </Button>
        </nav>
      </div>
      <main className="flex-1 overflow-y-auto p-4">
        {view === "review" && <ReviewView pr={currentPR} />}
        {view === "my-prs" && <MyPRsView onOpenPR={handleNavigate} />}
        {view === "local-diff" && <LocalDiffView />}
        {view === "settings" && <SettingsView />}
      </main>
    </div>
  )
}

export default App
