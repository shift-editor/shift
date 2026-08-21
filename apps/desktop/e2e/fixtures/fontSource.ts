import { createBridge } from "@shift/bridge";
import fs from "node:fs";
import * as path from "node:path";

export function createAuthoredDocument(sourcePath: string, workspaceDirectory: string): string {
  fs.mkdirSync(workspaceDirectory, { recursive: true });

  const documentPath = path.join(workspaceDirectory, "font.shift");
  if (path.extname(sourcePath) === ".shift") {
    fs.copyFileSync(sourcePath, documentPath, fs.constants.COPYFILE_FICLONE);
    return documentPath;
  }

  const bridge = createBridge();
  const storePath = path.join(workspaceDirectory, "conversion.sqlite");
  const recoveryPath = path.join(workspaceDirectory, "conversion-recovery.sqlite");

  try {
    bridge.openWorkspace(sourcePath, storePath);
    bridge.saveWorkspaceAsDocument(documentPath, recoveryPath);
  } finally {
    bridge.closeWorkspace();
  }

  return documentPath;
}

export function copyImportedSource(sourcePath: string, workspaceDirectory: string): string {
  if (path.extname(sourcePath) === ".designspace") {
    fs.cpSync(path.dirname(sourcePath), workspaceDirectory, { recursive: true });
    return path.join(workspaceDirectory, path.basename(sourcePath));
  }

  fs.mkdirSync(workspaceDirectory, { recursive: true });
  const retainedPath = path.join(workspaceDirectory, path.basename(sourcePath));

  if (fs.statSync(sourcePath).isDirectory()) {
    fs.cpSync(sourcePath, retainedPath, { recursive: true });
  } else {
    fs.copyFileSync(sourcePath, retainedPath, fs.constants.COPYFILE_FICLONE);
  }

  return retainedPath;
}
