import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { Channel, serveChannel } from "./channel";
import { webSocketTransport, type WebSocketPeer } from "./webSocketTransport";

type TestCalls = {
  "values.echo": {
    request: { values: Float64Array };
    response: { values: Float64Array };
  };
};

type SocketPair = {
  client: WebSocket;
  server: WebSocket;
  listener: WebSocketServer;
};

const pairs: SocketPair[] = [];

afterEach(async () => {
  for (const pair of pairs.splice(0)) {
    pair.client.terminate();
    pair.server.terminate();
    await new Promise<void>((resolve) => pair.listener.close(() => resolve()));
  }
});

describe("typed channels cross a WebSocket boundary", () => {
  it("round trips typed values through a real socket", async () => {
    const pair = await openSocketPair();
    serveChannel<TestCalls, Record<string, never>>(webSocketTransport(peer(pair.server)), {
      "values.echo": ({ values }) => ({ values }),
    });
    const client = new Channel<TestCalls, Record<string, never>>(
      webSocketTransport(peer(pair.client)),
    );

    const result = await client.call("values.echo", { values: new Float64Array([1.5, -2]) });

    expect(result.values).toBeInstanceOf(Float64Array);
    expect([...result.values]).toEqual([1.5, -2]);
    client.dispose();
  });

  it("rejects port transfer without poisoning later requests", async () => {
    const pair = await openSocketPair();
    serveChannel<TestCalls, Record<string, never>>(webSocketTransport(peer(pair.server)), {
      "values.echo": ({ values }) => ({ values }),
    });
    const client = new Channel<TestCalls, Record<string, never>>(
      webSocketTransport(peer(pair.client)),
    );

    await expect(
      client.call("values.echo", { values: new Float64Array([1]) }, [{}]),
    ).rejects.toThrow("cannot transfer ports");
    const result = await client.call("values.echo", { values: new Float64Array([2]) });
    expect([...result.values]).toEqual([2]);
  });

  it("closes the socket when a peer sends malformed binary", async () => {
    const pair = await openSocketPair();
    new Channel<Record<string, never>, Record<string, never>>(
      webSocketTransport(peer(pair.server)),
    );
    const closed = once(pair.client, "close");

    pair.client.send(Uint8Array.of(0xff));

    const [code] = await closed;
    expect(code).toBe(1007);
  });
});

async function openSocketPair(): Promise<SocketPair> {
  const listener = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(listener, "listening");
  const address = listener.address();
  if (typeof address === "string" || address === null) throw new Error("missing WebSocket address");

  const accepted = once(listener, "connection");
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`);
  const [[server]] = await Promise.all([accepted, once(client, "open")]);
  const pair = { client, server: server as WebSocket, listener };
  pairs.push(pair);
  return pair;
}

function peer(socket: WebSocket): WebSocketPeer {
  return socket as unknown as WebSocketPeer;
}
