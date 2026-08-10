import type { MessagePortMain } from "electron";
import { electronPortTransport, parentPortTransport } from "../shared/workspace/localTransports";
import { WorkspaceHost } from "./workspace/WorkspaceHost";

const documentsRoot = process.argv[2];
const atlasCacheRoot = process.argv[3];
if (!documentsRoot || !atlasCacheRoot) {
  throw new Error("workspace utility process requires document and atlas cache root arguments");
}

new WorkspaceHost({
  documentsRoot,
  atlasCacheRoot,
  shell: parentPortTransport(),
  portTransport: (port) => electronPortTransport(port as MessagePortMain),
}).start();
