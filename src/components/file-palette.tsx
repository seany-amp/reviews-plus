import {
  CommandDialog,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import type { PRFile } from '@/lib/github/types'
import { FileIcon, FilePlusIcon, FileMinusIcon, FileEditIcon } from 'lucide-react'

interface FilePaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  files: PRFile[]
  onSelectFile: (filename: string) => void
}

function getFileIcon(status: string) {
  switch (status) {
    case 'added':
      return <FilePlusIcon className="size-4 text-green-600" />
    case 'removed':
      return <FileMinusIcon className="size-4 text-red-600" />
    case 'modified':
      return <FileEditIcon className="size-4 text-yellow-600" />
    default:
      return <FileIcon className="size-4 text-muted-foreground" />
  }
}

export function FilePalette({ open, onOpenChange, files, onSelectFile }: FilePaletteProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to file"
      description="Search files in this pull request"
    >
      <Command>
        <CommandInput placeholder="Search files..." />
        <CommandList>
          <CommandEmpty>No files found.</CommandEmpty>
          <CommandGroup heading="Changed files">
            {files.map((file) => (
              <CommandItem
                key={file.filename}
                value={file.filename}
                onSelect={() => {
                  onSelectFile(file.filename)
                  onOpenChange(false)
                }}
              >
                {getFileIcon(file.status)}
                <span className="flex-1 truncate">{file.filename}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="text-green-600">+{file.additions}</span>
                  <span className="text-red-600">-{file.deletions}</span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
