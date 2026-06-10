import type { MessagePortMain } from "electron";
import { electronPortTransport, parentPortTransport } from "../shared/workspace/channel";
import { WorkspaceHost } from "./workspace/WorkspaceHost";

const documentsRoot = process.argv[2];
if (!documentsRoot) {
  throw new Error("workspace utility process requires a documents root argument");
}

new WorkspaceHost({
  documentsRoot,
  shell: parentPortTransport(),
  syncTransport: (port) => electronPortTransport(port as MessagePortMain),
}).start();
