import { useEffect, useMemo, useRef } from 'react'
import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react'
import type { GitStatus } from '@pierre/trees'
import type { PRFile } from '@/lib/github/types'

interface FileTreeSidebarProps {
  files: PRFile[]
  onSelectFile: (path: string) => void
  isOpen: boolean
  activeFile?: string | null
  viewedFiles: Set<string>
  onMarkViewed: (path: string) => void
}

const STATUS_MAP: Record<string, GitStatus> = {
  added: 'added',
  removed: 'deleted',
  modified: 'modified',
  renamed: 'renamed',
}

function mapPRStatusToGitStatus(status: string): GitStatus {
  return STATUS_MAP[status] ?? 'modified'
}

export function FileTreeSidebar({
  files,
  onSelectFile,
  isOpen,
  activeFile,
  viewedFiles,
  onMarkViewed,
}: FileTreeSidebarProps) {
  const paths = useMemo(() => files.map((f) => f.filename), [files])

  const totalAdditions = useMemo(
    () => files.reduce((sum, f) => sum + f.additions, 0),
    [files],
  )
  const totalDeletions = useMemo(
    () => files.reduce((sum, f) => sum + f.deletions, 0),
    [files],
  )

  const activeFileStats = useMemo(() => {
    if (!activeFile) return null
    return files.find((f) => f.filename === activeFile) ?? null
  }, [files, activeFile])

  const { model } = useFileTree({
    paths,
    initialExpansion: 'open',
    flattenEmptyDirectories: true,
    search: true,
  })

  const selectedPaths = useFileTreeSelection(model)
  const onSelectFileRef = useRef(onSelectFile)
  onSelectFileRef.current = onSelectFile

  useEffect(() => {
    const gitStatus = files.map((f) => ({
      path: f.filename,
      status: mapPRStatusToGitStatus(f.status),
    }))
    model.setGitStatus(gitStatus)
  }, [files, model])

  useEffect(() => {
    if (selectedPaths.length > 0) {
      const selected = selectedPaths[selectedPaths.length - 1]
      onSelectFileRef.current(selected)
      onMarkViewed(selected)
    }
  }, [selectedPaths, onMarkViewed])

  useEffect(() => {
    if (!activeFile) return
    const item = model.getItem(activeFile)
    if (item && !item.isSelected) {
      item.select()
      model.scrollToPath(activeFile, { focus: false })
    }
  }, [activeFile, model])

  if (!isOpen) {
    return null
  }

  const viewedCount = viewedFiles.size
  const reviewProgress =
    files.length > 0 ? Math.round((viewedCount / files.length) * 100) : 0

  return (
    <div className="w-[220px] md:w-[280px] max-w-[45vw] h-full border-r overflow-hidden flex-shrink-0 flex flex-col">
      <div className="px-3 py-2 border-b space-y-1">
        <div className="text-sm font-medium text-muted-foreground">
          Files ({viewedCount}/{files.length} reviewed)
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="text-green-600">+{totalAdditions}</span>
          <span className="text-red-600">-{totalDeletions}</span>
        </div>
        <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-green-600 transition-all duration-300"
            style={{ width: `${reviewProgress}%` }}
          />
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <FileTree model={model} style={{ height: '100%' }} />
      </div>
      {activeFileStats && (
        <div className="px-3 py-2 border-t text-xs text-muted-foreground">
          <div className="truncate font-medium">
            {activeFileStats.filename.split('/').pop()}
          </div>
          <div className="flex gap-2 mt-0.5">
            <span className="text-green-600">+{activeFileStats.additions}</span>
            <span className="text-red-600">-{activeFileStats.deletions}</span>
            <span className="capitalize">{activeFileStats.status}</span>
          </div>
        </div>
      )}
    </div>
  )
}
