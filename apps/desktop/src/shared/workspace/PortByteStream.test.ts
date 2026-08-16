import { MessageChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { nodePortTransport } from "./channel";
import { PortByteStream } from "./PortByteStream";

function stream(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk));
      controller.close();
    },
  });
}

describe("bounded byte delivery over a message port", () => {
  it("preserves ordered chunk offsets and total length", async () => {
    const lane = new MessageChannel();
    const sender = new PortByteStream(nodePortTransport(lane.port1));
    const receiver = new PortByteStream(nodePortTransport(lane.port2));
    const writes: Array<{ offset: number; bytes: number[] }> = [];

    const [sent, received] = await Promise.all([
      sender.send(stream([1, 2], [3, 4, 5])),
      receiver.receive((offset, bytes) => {
        writes.push({ offset, bytes: [...bytes] });
      }),
    ]);

    expect({ sent, received, writes }).toEqual({
      sent: 5,
      received: 5,
      writes: [
        { offset: 0, bytes: [1, 2] },
        { offset: 2, bytes: [3, 4, 5] },
      ],
    });
    sender.close();
    receiver.close();
  });

  it("re-chunks a source that exceeds the transport maximum", async () => {
    const lane = new MessageChannel();
    const sender = new PortByteStream(nodePortTransport(lane.port1));
    const receiver = new PortByteStream(nodePortTransport(lane.port2));
    const writes: number[][] = [];

    await Promise.all([
      sender.send(stream([1, 2, 3, 4, 5]), undefined, 2),
      receiver.receive((_offset, bytes) => {
        writes.push([...bytes]);
      }),
    ]);

    expect(writes).toEqual([[1, 2], [3, 4], [5]]);
    sender.close();
    receiver.close();
  });

  it("cancels the source when the receiving sink rejects a chunk", async () => {
    const lane = new MessageChannel();
    const sender = new PortByteStream(nodePortTransport(lane.port1));
    const receiver = new PortByteStream(nodePortTransport(lane.port2));

    const results = await Promise.allSettled([
      sender.send(stream([1, 2, 3])),
      receiver.receive(() => {
        throw new Error("GPU upload rejected");
      }),
    ]);

    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(
      results.map((result) => (result.status === "rejected" ? result.reason.message : "")),
    ).toEqual(["GPU upload rejected", "GPU upload rejected"]);
    sender.close();
    receiver.close();
  });
});
