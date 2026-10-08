import { executeShiftCode } from "@shift/sandbox";
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
  capture: (input) => host.call("shift.capture", input),
  sessions: {
    list: () => host.call("shift.sessions.list", undefined),
  },
  editor: {
    inspect: (input) => host.call("shift.editor.inspect", input),
  },
  font: {
    get: (input) => host.call("shift.font.get", input),
  },
  locations: {
    resolve: (input) => host.call("shift.locations.resolve", input),
  },
  glyphs: {
    list: (input) => host.call("shift.glyphs.list", input),
    get: (input) => host.call("shift.glyphs.get", input),
    resolve: (input) => host.call("shift.glyphs.resolve", input),
  },
  layers: {
    get: (input) => host.call("shift.layers.get", input),
    resolve: (input) => host.call("shift.layers.resolve", input),
    render: (input) => host.call("shift.layers.render", input),
  },
};
const runtime = serveChannel<SandboxCallMap, SandboxEventMap>(transport, {
  "sandbox.execute": ({ code }) => executeShiftCode(capabilities, code),
});

runtime.emit("sandbox.ready", null);
