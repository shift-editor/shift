import { useState } from "react";
import { documentPersistence } from "@/persistence";
import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@shift/ui";

const VISIBLE_COUNT = 5;

function shortenPath(path: string): string {
  const home = window.electronAPI?.homePath ?? "";
  if (home && path.startsWith(home)) {
    return "~" + path.slice(home.length);
  }
  return path;
}

function FileRow({
  file,
  onOpenFile,
}: {
  file: { name: string; path: string };
  onOpenFile: (path: string) => void;
}) {
  return (
    <button
      onClick={() => onOpenFile(file.path)}
      className="hover:bg-hover flex items-center justify-between rounded px-2 py-1 text-left"
    >
      <span className="text-primary truncate text-xs">{file.name}</span>
      <span className="text-secondary ml-4 max-w-[140px] shrink-0 truncate text-xs">
        {shortenPath(file.path)}
      </span>
    </button>
  );
}

interface RecentFilesProps {
  onOpenFile: (path: string) => void;
}

export const RecentFiles = ({ onOpenFile }: RecentFilesProps) => {
  const recentFiles = documentPersistence.getRecentDocuments();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (recentFiles.length === 0) return null;
  console.log(recentFiles);

  const visibleFiles = recentFiles.slice(0, VISIBLE_COUNT);
  const hasMore = recentFiles.length > VISIBLE_COUNT;

  return (
    <div className="flex w-72 flex-col gap-1">
      <span className="text-secondary text-xs font-medium">Recent files</span>
      {visibleFiles.map((file) => (
        <FileRow key={file.path} file={file} onOpenFile={onOpenFile} />
      ))}
      {hasMore && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <Button variant="ghost" size="sm" onClick={() => setDialogOpen(true)}>
            Show all ({recentFiles.length})
          </Button>
          <DialogPortal>
            <DialogBackdrop />
            <DialogPopup className="max-h-[60vh] overflow-y-auto p-4">
              <DialogTitle className="text-primary mb-3 text-sm font-medium">
                Recent files
              </DialogTitle>
              <div className="flex flex-col gap-1">
                {recentFiles.map((file) => (
                  <FileRow
                    key={file.path}
                    file={file}
                    onOpenFile={(path) => {
                      setDialogOpen(false);
                      onOpenFile(path);
                    }}
                  />
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                <DialogClose
                  render={(props) => (
                    <Button {...props} variant="ghost" size="sm">
                      Close
                    </Button>
                  )}
                />
              </div>
            </DialogPopup>
          </DialogPortal>
        </Dialog>
      )}
    </div>
  );
};
