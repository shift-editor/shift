import type { Transport } from "./channel";
import {
  MAX_CHANNEL_MESSAGE_BYTES,
  decodeChannelMessage,
  encodeChannelMessage,
} from "./channelCodec";

/** Browser-compatible WebSocket surface required by the channel transport. */
export type WebSocketPeer = Pick<WebSocket, "binaryType" | "send" | "close" | "addEventListener">;

/** Carries bounded MessagePack channel envelopes over one established WebSocket. */
export function webSocketTransport(peer: WebSocketPeer): Transport {
  const closeListeners = new Set<() => void>();
  let closed = false;
  peer.binaryType = "arraybuffer";

  const close = () => {
    if (closed) return;

    closed = true;
    for (const listener of closeListeners) listener();
    closeListeners.clear();
  };
  peer.addEventListener("close", close);
  peer.addEventListener("error", () => {
    close();
    peer.close(1011, "WebSocket transport error");
  });

  return {
    post: (message, transfer) => {
      if (transfer?.length) {
        throw new Error("WebSocket transport cannot transfer ports");
      }

      peer.send(encodeChannelMessage(message));
    },
    onMessage: (listener) => {
      peer.addEventListener("message", (event) => {
        const encoded = messageBytes(event.data);
        if (!encoded) {
          peer.close(1003, "binary channel messages required");
          return;
        }
        if (encoded.byteLength > MAX_CHANNEL_MESSAGE_BYTES) {
          peer.close(1009, "channel message too large");
          return;
        }

        let decoded: unknown;
        try {
          decoded = decodeChannelMessage(encoded);
        } catch {
          peer.close(1007, "invalid channel message");
          return;
        }

        listener({ data: decoded, ports: [] });
      });
    },
    onClose: (listener) => {
      if (closed) {
        listener();
        return;
      }

      closeListeners.add(listener);
    },
    close: () => {
      if (closed) return;

      peer.close(1000, "channel closed");
    },
  };
}

function messageBytes(message: unknown): ArrayBuffer | ArrayBufferView | null {
  if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) return message;

  return null;
}
