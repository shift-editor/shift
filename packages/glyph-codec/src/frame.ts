import { fail } from "./error";

const MAGIC = [0x53, 0x48, 0x46, 0x54] as const;
export const FRAME_PREFIX_LENGTH = 8;

type FrameSpec = {
  readonly headerLength: number;
  readonly kind: number;
  readonly version: number;
  readonly headerName: string;
  readonly versionName: string;
  readonly flagsName: string;
};

export function validateFrame(bytes: Uint8Array, spec: FrameSpec): void {
  if (bytes.byteLength < spec.headerLength) {
    fail(
      "header-truncated",
      `${spec.headerName} header is truncated: ${bytes.byteLength} of ${spec.headerLength} bytes`,
    );
  }
  if (MAGIC.some((byte, index) => bytes[index] !== byte)) {
    fail("wrong-magic", "wrong glyph-codec magic");
  }
  if (bytes[4] !== spec.kind) {
    fail("unsupported-kind", `unsupported glyph-codec payload kind ${hex(bytes[4])}`);
  }
  if (bytes[5] !== spec.version) {
    fail("unsupported-version", `unsupported ${spec.versionName} version ${bytes[5]}`);
  }

  const flags = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(6, true);
  if (flags !== 0) {
    fail("unknown-flags", `unknown ${spec.flagsName} flags ${hex(flags, 4)}`);
  }
}

export function writeFrame(bytes: Uint8Array, kind: number, version: number): void {
  if (bytes.byteLength < FRAME_PREFIX_LENGTH) {
    throw new Error("glyph-codec frame buffer is too short");
  }
  bytes.set(MAGIC, 0);
  bytes[4] = kind;
  bytes[5] = version;
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(6, 0, true);
}

function hex(value: number, width = 2): string {
  return `0x${value.toString(16).padStart(width, "0")}`;
}
