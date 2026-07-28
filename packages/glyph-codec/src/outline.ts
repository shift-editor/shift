import { fail } from "./error";
import { validateFrame, writeFrame } from "./frame";
import type { OutlineCommand } from "./types";

export { GlyphCodecError } from "./error";

const OUTLINE_KIND = 0x01;
const OUTLINE_VERSION = 0x01;
const HEADER_LENGTH = 16;

export const MAX_COMMAND_COUNT = 1_000_000;
export const MAX_COORDINATE_COUNT = 6_000_000;
export const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;

type Header = {
  readonly commandCount: number;
  readonly coordinateCount: number;
  readonly coordinateOffset: number;
};

type CommandState = "between" | "active-empty" | "active-drawing";

/**
 * Opaque, immutable, validated `shift.glyph-outline.v1` bytes.
 *
 * The constructor is intentionally private. Decode copies caller-owned bytes so
 * later mutation cannot invalidate the checked command/coordinate view; packed
 * bytes are allocated and retained directly. `toUint8Array()` likewise returns
 * a copy rather than exposing mutable internal storage.
 */
export class PackedGlyphOutline implements Iterable<OutlineCommand> {
  readonly #bytes: Uint8Array;
  readonly #header: Header;

  private constructor(bytes: Uint8Array, header: Header) {
    this.#bytes = bytes;
    this.#header = header;
  }

  static decode(data: Uint8Array): PackedGlyphOutline {
    checkLimit("payload byte length", data.byteLength, MAX_PAYLOAD_BYTES);
    const bytes = Uint8Array.from(data);
    const header = validate(bytes);
    return new PackedGlyphOutline(bytes, header);
  }

  static pack(commands: readonly OutlineCommand[]): PackedGlyphOutline {
    checkLimit("command count", commands.length, MAX_COMMAND_COUNT);

    let state: CommandState = "between";
    let coordinateCount = 0;
    for (const [index, command] of commands.entries()) {
      state = nextState(state, commandByte(command), index);
      coordinateCount = checkedAdd(coordinateCount, commandArity(command));
      checkLimit("coordinate count", coordinateCount, MAX_COORDINATE_COUNT);
    }

    const alignedCommands = align4(commands.length);
    const byteLength = checkedAdd(
      checkedAdd(HEADER_LENGTH, alignedCommands),
      checkedMultiply(coordinateCount, 4),
    );
    checkLimit("payload byte length", byteLength, MAX_PAYLOAD_BYTES);

    const bytes = new Uint8Array(byteLength);
    writeFrame(bytes, OUTLINE_KIND, OUTLINE_VERSION);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint32(8, commands.length, true);
    view.setUint32(12, coordinateCount, true);

    let commandOffset = HEADER_LENGTH;
    let coordinateIndex = 0;
    const coordinateOffset = HEADER_LENGTH + alignedCommands;
    for (const command of commands) {
      bytes[commandOffset] = commandByte(command);
      commandOffset += 1;
      for (const coordinate of commandCoordinates(command)) {
        view.setFloat32(
          coordinateOffset + coordinateIndex * 4,
          convertCoordinate(coordinate, coordinateIndex),
          true,
        );
        coordinateIndex += 1;
      }
    }

    return new PackedGlyphOutline(bytes, {
      commandCount: commands.length,
      coordinateCount,
      coordinateOffset,
    });
  }

  get byteLength(): number {
    return this.#bytes.byteLength;
  }

  get commandCount(): number {
    return this.#header.commandCount;
  }

  get coordinateCount(): number {
    return this.#header.coordinateCount;
  }

  /** Returns a mutable copy suitable for transport. */
  toUint8Array(): Uint8Array {
    return this.#bytes.slice();
  }

  /** Iterates validated commands without allocating a point-object graph. */
  *commands(): IterableIterator<OutlineCommand> {
    const view = new DataView(this.#bytes.buffer, this.#bytes.byteOffset, this.#bytes.byteLength);
    let coordinateOffset = this.#header.coordinateOffset;
    const next = (): number => {
      const value = view.getFloat32(coordinateOffset, true);
      coordinateOffset += 4;
      return value;
    };

    for (let index = 0; index < this.#header.commandCount; index += 1) {
      switch (this.#bytes[HEADER_LENGTH + index]) {
        case 0:
          yield { kind: "move", x: next(), y: next() };
          break;
        case 1:
          yield { kind: "line", x: next(), y: next() };
          break;
        case 2:
          yield { kind: "quad", cx: next(), cy: next(), x: next(), y: next() };
          break;
        case 3:
          yield {
            kind: "cubic",
            c1x: next(),
            c1y: next(),
            c2x: next(),
            c2y: next(),
            x: next(),
            y: next(),
          };
          break;
        case 4:
          yield { kind: "close" };
          break;
        default:
          throw new Error("PackedGlyphOutline command invariant violated");
      }
    }
  }

  /** Iterates all finite f32 values in command-stream order. */
  *coordinates(): IterableIterator<number> {
    const view = new DataView(this.#bytes.buffer, this.#bytes.byteOffset, this.#bytes.byteLength);
    for (let index = 0; index < this.#header.coordinateCount; index += 1) {
      yield view.getFloat32(this.#header.coordinateOffset + index * 4, true);
    }
  }

  [Symbol.iterator](): IterableIterator<OutlineCommand> {
    return this.commands();
  }
}

/** Canonically encodes drawing commands into an opaque outline payload. */
export function packOutline(commands: readonly OutlineCommand[]): PackedGlyphOutline {
  return PackedGlyphOutline.pack(commands);
}

/** Strictly validates and copies an outline payload. */
export function decodeOutline(data: Uint8Array): PackedGlyphOutline {
  return PackedGlyphOutline.decode(data);
}

function validate(bytes: Uint8Array): Header {
  validateFrame(bytes, {
    headerLength: HEADER_LENGTH,
    kind: OUTLINE_KIND,
    version: OUTLINE_VERSION,
    headerName: "outline",
    versionName: "glyph-outline",
    flagsName: "glyph-outline",
  });
  checkLimit("payload byte length", bytes.byteLength, MAX_PAYLOAD_BYTES);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const commandCount = view.getUint32(8, true);
  const coordinateCount = view.getUint32(12, true);
  checkLimit("command count", commandCount, MAX_COMMAND_COUNT);
  checkLimit("coordinate count", coordinateCount, MAX_COORDINATE_COUNT);

  const alignedCommands = align4(commandCount);
  const expectedLength = checkedAdd(
    checkedAdd(HEADER_LENGTH, alignedCommands),
    checkedMultiply(coordinateCount, 4),
  );
  checkLimit("payload byte length", expectedLength, MAX_PAYLOAD_BYTES);
  if (bytes.byteLength !== expectedLength) {
    fail(
      "length-mismatch",
      `outline payload length mismatch: expected ${expectedLength} bytes, got ${bytes.byteLength}`,
    );
  }

  let state: CommandState = "between";
  let expectedCoordinateCount = 0;
  for (let index = 0; index < commandCount; index += 1) {
    const command = bytes[HEADER_LENGTH + index];
    const arity = byteArity(command, index);
    state = nextState(state, command, index);
    expectedCoordinateCount = checkedAdd(expectedCoordinateCount, arity);
  }
  if (expectedCoordinateCount !== coordinateCount) {
    fail(
      "coordinate-count-mismatch",
      `outline command arity requires ${expectedCoordinateCount} coordinates, header declares ${coordinateCount}`,
    );
  }

  const commandsEnd = HEADER_LENGTH + commandCount;
  const coordinateOffset = HEADER_LENGTH + alignedCommands;
  for (let offset = commandsEnd; offset < coordinateOffset; offset += 1) {
    if (bytes[offset] !== 0) {
      fail("non-zero-padding", `non-zero outline alignment padding at byte ${offset}`);
    }
  }

  for (let index = 0; index < coordinateCount; index += 1) {
    const coordinate = view.getFloat32(coordinateOffset + index * 4, true);
    if (!Number.isFinite(coordinate)) {
      fail("non-finite-coordinate", `non-finite outline coordinate at index ${index}`);
    }
  }

  return { commandCount, coordinateCount, coordinateOffset };
}

function nextState(state: CommandState, command: number, index: number): CommandState {
  switch (command) {
    case 0:
      return "active-empty";
    case 1:
    case 2:
    case 3:
      if (state === "between") {
        fail(
          "invalid-command-order",
          `invalid outline command ordering at index ${index}: drawing command requires an active contour`,
        );
      }
      return "active-drawing";
    case 4:
      if (state === "between") {
        fail(
          "invalid-command-order",
          `invalid outline command ordering at index ${index}: close requires an active contour`,
        );
      }
      if (state === "active-empty") {
        fail(
          "invalid-command-order",
          `invalid outline command ordering at index ${index}: close requires at least one drawing segment`,
        );
      }
      return "between";
    default:
      fail("unknown-command", `unknown outline command ${hex(command)} at index ${index}`);
  }
}

function commandByte(command: OutlineCommand): number {
  switch (command.kind) {
    case "move":
      return 0;
    case "line":
      return 1;
    case "quad":
      return 2;
    case "cubic":
      return 3;
    case "close":
      return 4;
  }
}

function commandArity(command: OutlineCommand): number {
  switch (command.kind) {
    case "move":
    case "line":
      return 2;
    case "quad":
      return 4;
    case "cubic":
      return 6;
    case "close":
      return 0;
  }
}

function byteArity(command: number, index: number): number {
  switch (command) {
    case 0:
    case 1:
      return 2;
    case 2:
      return 4;
    case 3:
      return 6;
    case 4:
      return 0;
    default:
      fail("unknown-command", `unknown outline command ${hex(command)} at index ${index}`);
  }
}

function commandCoordinates(command: OutlineCommand): readonly number[] {
  switch (command.kind) {
    case "move":
    case "line":
      return [command.x, command.y];
    case "quad":
      return [command.cx, command.cy, command.x, command.y];
    case "cubic":
      return [command.c1x, command.c1y, command.c2x, command.c2y, command.x, command.y];
    case "close":
      return [];
  }
}

function convertCoordinate(value: number, index: number): number {
  if (!Number.isFinite(value)) {
    fail("non-finite-input-coordinate", `non-finite input coordinate at index ${index}`);
  }

  const converted = Math.fround(value);
  if (!Number.isFinite(converted)) {
    fail(
      "coordinate-out-of-f32-range",
      `input coordinate at index ${index} is outside finite f32 range`,
    );
  }
  return converted;
}

function align4(value: number): number {
  return checkedMultiply(Math.ceil(value / 4), 4);
}

function checkedAdd(left: number, right: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    fail("length-overflow", "outline payload length arithmetic overflowed");
  }
  return value;
}

function checkedMultiply(left: number, right: number): number {
  const value = left * right;
  if (!Number.isSafeInteger(value)) {
    fail("length-overflow", "outline payload length arithmetic overflowed");
  }
  return value;
}

function checkLimit(field: string, actual: number, limit: number): void {
  if (actual > limit) {
    fail("limit-exceeded", `outline ${field} exceeds implementation limit ${limit}: got ${actual}`);
  }
}

function hex(value: number, width = 2): string {
  return `0x${value.toString(16).padStart(width, "0")}`;
}
