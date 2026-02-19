import { useEffect, useState } from "react";
import { documentPersistence } from "@/persistence";
import { Button } from "@shift/ui";

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
    <Button
      onClick={() => onOpenFile(file.path)}
      variant="ghost"
      className="hover:bg-hover px-0.5 py-0.5 h-fit flex items-center justify-between rounded text-left"
    >
      <span className="text-primary truncate text-sm">{file.name}</span>
      <span className="text-secondary ml-4 max-w-[140px] shrink-0 truncate text-sm">
        {shortenPath(file.path)}
      </span>
    </Button>
  );
}

interface RecentFilesProps {
  onOpenFile: (path: string) => void;
}

export const RecentFiles = ({ onOpenFile }: RecentFilesProps) => {
  const [recentFiles, setRecentFiles] = useState<{ name: string; path: string }[]>([]);

  useEffect(() => {
    const fetchRecentFiles = async () => {
      const documents = await documentPersistence.getRecentDocuments();
      if (window.electronAPI) {
        const exists = await window.electronAPI.pathsExist(documents.map((d) => d.path));
        const prune = documents.filter((_, i) => !exists[i]);
        await documentPersistence.prunePaths(new Set(prune.map((d) => d.path)));
      }

      setRecentFiles(documents);
    };

    fetchRecentFiles();
  }, []);

  if (recentFiles.length === 0) return null;

  const visibleFiles = recentFiles.slice(0, VISIBLE_COUNT);

  return (
    <div className="flex w-90 flex-col gap-[1px]">
      <span className="text-sm font-medium">Recent files</span>
      {visibleFiles.map((file) => (
        <FileRow key={file.path} file={file} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
};
