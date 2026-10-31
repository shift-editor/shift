import { afterEach, describe, expect, it } from "vitest";
import { MessageChannel } from "node:worker_threads";
import { Channel, nodePortTransport, type CallMap, type ChannelServer } from "./channel";
import { client, serve, type LaneMethods } from "./remote";

interface Calculator {
  subtract(a: number, b: number): Promise<number>;
  reverse(bytes: Uint8Array): Promise<Uint8Array>;
  explode(): Promise<never>;
  total(): Promise<number>;
}

const calculatorMethods: LaneMethods<Calculator> = {
  subtract: true,
  reverse: true,
  explode: true,
  total: true,
};

class Accumulator implements Calculator {
  #total = 0;

  async subtract(a: number, b: number): Promise<number> {
    this.#total += a - b;
    return a - b;
  }

  async reverse(bytes: Uint8Array): Promise<Uint8Array> {
    return bytes.toReversed();
  }

  async explode(): Promise<never> {
    throw Object.assign(new Error("no such file"), { code: "ENOENT" });
  }

  async total(): Promise<number> {
    return this.#total;
  }

  /** Lives on the implementation but is not part of the lane. */
  async reset(): Promise<void> {
    this.#total = 0;
  }
}

type PortedCalls = {
  adopt: { request: { label: string }; response: string };
};

type Lane = {
  channel: Channel<PortedCalls, Record<never, never>>;
  remote: Calculator;
  server: ChannelServer<Record<never, never>>;
};

const lanes: Lane[] = [];

function createLane(): Lane {
  const { port1, port2 } = new MessageChannel();
  const server = serve<Calculator, Record<never, never>, PortedCalls>(
    nodePortTransport(port2),
    new Accumulator(),
    calculatorMethods,
    { adopt: ({ label }, context) => `${label}:${context.ports.length}` },
  );
  const channel = new Channel<PortedCalls, Record<never, never>>(nodePortTransport(port1));
  const lane = {
    channel,
    remote: client<Calculator, PortedCalls, Record<never, never>>(channel),
    server,
  };
  lanes.push(lane);
  return lane;
}

afterEach(() => {
  for (const lane of lanes.splice(0)) {
    lane.channel.dispose();
    lane.server.dispose();
  }
});

describe("an interface served over a real MessageChannel", () => {
  it("calls the named method with its arguments in order", async () => {
    const { remote } = createLane();

    await expect(remote.subtract(10, 3)).resolves.toBe(7);
  });

  it("runs methods on the implementation, so its state persists across calls", async () => {
    const { remote } = createLane();

    await remote.subtract(10, 3);
    await remote.subtract(5, 1);

    await expect(remote.total()).resolves.toBe(11);
  });

  it("carries Uint8Array arguments and results intact", async () => {
    const { remote } = createLane();

    const reversed = await remote.reverse(new Uint8Array([1, 2, 3]));

    expect(reversed).toBeInstanceOf(Uint8Array);
    expect([...reversed]).toEqual([3, 2, 1]);
  });

  it("rejects with the implementation's error message and code", async () => {
    const { remote } = createLane();

    await expect(remote.explode()).rejects.toMatchObject({
      message: "no such file",
      code: "ENOENT",
    });
  });

  it("rejects a method the lane does not list, even when the implementation has it", async () => {
    const { channel } = createLane();
    const untyped = channel as unknown as Channel<CallMap, Record<never, never>>;

    await expect(untyped.call("reset", [])).rejects.toThrow('unknown request type "reset"');
    await expect(untyped.call("toString", [])).rejects.toThrow('unknown request type "toString"');
  });

  it("serves ported calls beside the interface, with their transferred ports", async () => {
    const { channel } = createLane();
    const { port1 } = new MessageChannel();

    await expect(channel.call("adopt", { label: "stream" }, [port1])).resolves.toBe("stream:1");
  });

  it("rejects every call once the channel is disposed", async () => {
    const { channel, remote } = createLane();

    channel.dispose();

    await expect(remote.total()).rejects.toThrow("channel disposed");
  });

  it("is not mistaken for a promise when an async function returns it", async () => {
    const { remote } = createLane();

    const resolved = await Promise.resolve(remote);

    await expect(resolved.subtract(2, 1)).resolves.toBe(1);
  });
});
