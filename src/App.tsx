import { useState } from "react"
import { ReviewView } from "./features/review"
import { MyPRsView } from "./features/my-prs"
import { SettingsView } from "./features/settings"
import { PRUrlInput } from "./components/pr-url-input"
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
      <PRUrlInput onNavigate={handleNavigate} />
      <nav className="flex gap-2 p-2 border-b">
        <button
          className={view === "review" ? "font-bold" : ""}
          onClick={() => setView("review")}
        >
          Review
        </button>
        <button
          className={view === "my-prs" ? "font-bold" : ""}
          onClick={() => setView("my-prs")}
        >
          My PRs
        </button>
        <button
          className={view === "settings" ? "font-bold" : ""}
          onClick={() => setView("settings")}
        >
          Settings
        </button>
      </nav>
      <main className="flex-1 p-4">
        {view === "review" && <ReviewView pr={currentPR} />}
        {view === "my-prs" && <MyPRsView />}
        {view === "settings" && <SettingsView />}
      </main>
    </div>
  )
}

export default App
