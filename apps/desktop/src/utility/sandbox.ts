import { executeShiftCode } from "@shift/mcp/runtime";
import type { ShiftCapabilities } from "@shift/runtime";
import { Channel, parentPortTransport, serveChannel } from "../shared/workspace/channel";
import type {
  SandboxCallMap,
  SandboxEventMap,
  SandboxHostCallMap,
  SandboxHostEventMap,
} from "../shared/sandbox/protocol";

const transport = parentPortTransport();
const host = new Channel<SandboxHostCallMap, SandboxHostEventMap>(transport);
const capabilities: ShiftCapabilities = {
  sessions: {
    list: () => host.call("shift.sessions.list", undefined),
  },
  editor: {
    inspect: (input) => host.call("shift.editor.inspect", input),
  },
};
const runtime = serveChannel<SandboxCallMap, SandboxEventMap>(transport, {
  "sandbox.execute": ({ code }) => executeShiftCode(capabilities, code),
});

runtime.emit("sandbox.ready", null);
