import { useEffect, useMemo, useRef } from 'react'
import { FileTree, useFileTree, useFileTreeSelection } from '@pierre/trees/react'
import type { GitStatus } from '@pierre/trees'
import type { PRFile } from '@/lib/github/types'

interface FileTreeSidebarProps {
  files: PRFile[]
  onSelectFile: (path: string) => void
  isOpen: boolean
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

export function FileTreeSidebar({ files, onSelectFile, isOpen }: FileTreeSidebarProps) {
  const paths = useMemo(() => files.map((f) => f.filename), [files])

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
    }
  }, [selectedPaths])

  if (!isOpen) {
    return null
  }

  return (
    <div className="w-[280px] h-full border-r overflow-hidden flex-shrink-0 flex flex-col">
      <div className="px-3 py-2 text-sm font-medium text-muted-foreground border-b">
        Files ({files.length})
      </div>
      <div className="flex-1 overflow-hidden">
        <FileTree model={model} style={{ height: '100%' }} />
      </div>
    </div>
  )
}
