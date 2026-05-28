import { useState } from "react"
import { GitPullRequest, List, Settings } from "lucide-react"
import { ReviewView } from "./features/review"
import { MyPRsView } from "./features/my-prs"
import { SettingsView } from "./features/settings"
import { PRUrlInput } from "./components/pr-url-input"
import { Button } from "./components/ui/button"
import type { PRIdentifier } from "./lib/github/parse-url"

type View = "review" | "my-prs" | "settings"

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
        <nav className="flex gap-1 p-2 border-b">
          <Button
            variant={view === "review" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("review")}
          >
            <GitPullRequest className="size-4" />
            Review
          </Button>
          <Button
            variant={view === "my-prs" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setView("my-prs")}
          >
            <List className="size-4" />
            My PRs
          </Button>
          <Button
            variant={view === "settings" ? "secondary" : "ghost"}
            size="sm"
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
        {view === "settings" && <SettingsView />}
      </main>
    </div>
  )
}

export default App
