import { describe, expect, it, afterEach } from "vitest";
import { MessageChannel } from "node:worker_threads";
import { Channel, nodePortTransport, serveChannel, type ChannelServer } from "./channel";

type TestCalls = {
  "math.add": { request: { a: number; b: number }; response: number };
  "math.explode": { request: void; response: number };
  "port.adopt": { request: void; response: number };
  "task.slow": { request: void; response: string };
};

type TestEvents = {
  progress: { percent: number };
};

type Lane = {
  client: Channel<TestCalls, TestEvents>;
  server: ChannelServer<TestEvents>;
  releaseSlow: (value: string) => void;
};

const lanes: Lane[] = [];

function createLane(): Lane {
  const { port1, port2 } = new MessageChannel();
  const lane: Lane = {
    client: new Channel<TestCalls, TestEvents>(nodePortTransport(port1)),
    server: serveChannel<TestCalls, TestEvents>(nodePortTransport(port2), {
      "math.add": ({ a, b }) => a + b,
      "math.explode": () => {
        throw new Error("workspace exploded");
      },
      "port.adopt": (_payload, context) => context.ports.length,
      "task.slow": () =>
        new Promise<string>((resolve) => {
          lane.releaseSlow = resolve;
        }),
    }),
    releaseSlow: () => {},
  };

  lanes.push(lane);
  return lane;
}

afterEach(() => {
  for (const lane of lanes.splice(0)) {
    lane.client.dispose();
    lane.server.dispose();
  }
});

describe("channel call/response over a real MessageChannel", () => {
  it("resolves a call with the handler result", async () => {
    const { client } = createLane();

    await expect(client.call("math.add", { a: 2, b: 3 })).resolves.toBe(5);
  });

  it("rejects with the handler's error message when the handler throws", async () => {
    const { client } = createLane();

    await expect(client.call("math.explode", undefined)).rejects.toThrow("workspace exploded");
  });

  it("rejects calls the server has no handler for", async () => {
    const { port1, port2 } = new MessageChannel();
    const client = new Channel<TestCalls, TestEvents>(nodePortTransport(port1));
    const server = serveChannel<Pick<TestCalls, "math.add">, TestEvents>(nodePortTransport(port2), {
      "math.add": ({ a, b }) => a + b,
    });

    await expect(client.call("task.slow", undefined)).rejects.toThrow(
      'unknown request type "task.slow"',
    );

    client.dispose();
    server.dispose();
  });

  it("settles concurrent calls by request id, not response order", async () => {
    const lane = createLane();
    const slow = lane.client.call("task.slow", undefined);
    const fast = lane.client.call("math.add", { a: 1, b: 2 });

    await expect(fast).resolves.toBe(3);

    lane.releaseSlow("finally");
    await expect(slow).resolves.toBe("finally");
  });
});

describe("channel events", () => {
  it("delivers server events to listeners until unlistened", async () => {
    const { client, server } = createLane();
    const seen: number[] = [];
    const unlisten = client.listen("progress", ({ percent }) => seen.push(percent));

    // Port delivery is FIFO, so a round-trip call after each emit guarantees
    // the event has already been dispatched.
    server.emit("progress", { percent: 40 });
    await client.call("math.add", { a: 0, b: 0 });

    unlisten();
    server.emit("progress", { percent: 80 });
    await client.call("math.add", { a: 0, b: 0 });

    expect(seen).toEqual([40]);
  });
});

describe("channel dispose", () => {
  it("rejects in-flight calls", async () => {
    const { client } = createLane();
    const pending = client.call("task.slow", undefined);

    client.dispose();

    await expect(pending).rejects.toThrow("channel disposed");
  });

  it("rejects calls made after dispose instead of hanging", async () => {
    const { client } = createLane();

    client.dispose();

    await expect(client.call("math.add", { a: 1, b: 2 })).rejects.toThrow("channel disposed");
  });
});

describe("channel port transfer", () => {
  it("surfaces transferred ports in the handler context", async () => {
    const { client } = createLane();
    const extra = new MessageChannel();

    await expect(client.call("port.adopt", undefined, [extra.port1])).resolves.toBe(1);

    extra.port2.close();
  });

  it("passes no ports when the caller transfers none", async () => {
    const { client } = createLane();

    await expect(client.call("port.adopt", undefined)).resolves.toBe(0);
  });
});
