import type { ShiftEditorReader } from "./ShiftEditorReader";
import type { ShiftFontReader } from "./ShiftFontReader";
import type { ShiftKerningReader } from "./ShiftKerningReader";

/** The agent readers one window serves, by the name an `agent.read` call gives each. */
export interface AgentReaders {
  font: ShiftFontReader;
  kerning: ShiftKerningReader;
  editor: ShiftEditorReader;
}

export type AgentReaderName = keyof AgentReaders;

/** The methods of the reader named `R`. */
export type AgentReadMethod<R extends AgentReaderName> = {
  [M in keyof AgentReaders[R]]: AgentReaders[R][M] extends (...args: never[]) => unknown
    ? M
    : never;
}[keyof AgentReaders[R]];

type ReadFunction<R extends AgentReaderName, M extends AgentReadMethod<R>> = Extract<
  AgentReaders[R][M],
  (...args: never[]) => unknown
>;

/** The arguments `reader.method` takes. */
export type AgentReadArgs<R extends AgentReaderName, M extends AgentReadMethod<R>> = Parameters<
  ReadFunction<R, M>
>;

/** What `reader.method` returns, awaited. */
export type AgentReadResult<R extends AgentReaderName, M extends AgentReadMethod<R>> = Awaited<
  ReturnType<ReadFunction<R, M>>
>;
