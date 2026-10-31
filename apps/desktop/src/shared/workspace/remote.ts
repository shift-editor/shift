import {
  serveChannel,
  type CallMap,
  type Channel,
  type ChannelHandlers,
  type ChannelServer,
  type EventMap,
  type HandlerContext,
  type Transport,
} from "./channel";

/**
 * An interface a lane can carry: every member is a method returning a promise.
 *
 * @remarks
 * Arguments and results cross by structured clone, so they are plain data,
 * typed arrays and `null`, never functions or class instances with behavior.
 */
type LaneInterface<T> = { [K in keyof T]: (...args: never[]) => Promise<unknown> };

/**
 * The methods one lane serves, checked by the compiler against its interface.
 *
 * @remarks
 * TypeScript interfaces do not exist at runtime, so {@link serve} needs the
 * method names. A `LaneMethods<T>` literal fails to compile when it misses a
 * method of `T` or names one `T` does not declare, so the interface stays the
 * single declaration. It also keeps an implementation's other methods (its
 * second lane, its lifecycle) out of reach of this lane's callers.
 */
export type LaneMethods<T> = Record<keyof T & string, true>;

/**
 * Serves `impl` on `transport`: each request calls the named method with its
 * arguments and posts back the result or the error.
 *
 * @remarks
 * A request names a method of `methods` and carries its positional arguments
 * as an array. Methods run with `impl` as `this`. A rejection reaches the
 * caller with its message, name and code, as on {@link serveChannel}; a method
 * outside `methods` rejects as an unknown request.
 *
 * `ported` serves the calls whose transferred ports (stream response ports,
 * a lane's own port) must reach the handler: they keep the channel's
 * request-object form and receive the {@link HandlerContext}.
 *
 * @param transport - The lane's server end.
 * @param impl - The object whose methods answer calls.
 * @param methods - The methods of `impl` this lane exposes.
 * @param ported - Port-carrying calls served beside the interface.
 * @returns `emit` for the lane's events and `dispose` to close it.
 * @throws {Error} when a listed method is missing from `impl`, or a ported
 *   call shares a name with an interface method.
 */
export function serve<
  T extends LaneInterface<T>,
  Events extends EventMap = Record<never, never>,
  Ported extends CallMap = Record<never, never>,
>(
  transport: Transport,
  impl: T,
  methods: LaneMethods<T>,
  ported?: ChannelHandlers<Ported>,
): ChannelServer<Events> {
  const handlers: Record<string, (payload: unknown, context: HandlerContext) => unknown> = {
    ...ported,
  };

  for (const method of Object.keys(methods)) {
    if (Object.hasOwn(handlers, method)) {
      throw new Error(`lane method "${method}" is also served as a ported call`);
    }

    const target: unknown = impl[method as keyof T];
    if (typeof target !== "function") {
      throw new Error(`lane method "${method}" is not implemented`);
    }

    handlers[method] = (args) => {
      if (!Array.isArray(args)) {
        throw new Error(`lane method "${method}" expects an argument list`);
      }

      return Reflect.apply(target, impl, args);
    };
  }

  return serveChannel<CallMap, Events>(transport, handlers as ChannelHandlers<CallMap>);
}

/**
 * Returns a typed proxy for an interface served by {@link serve} on the other
 * end of `channel`.
 *
 * @remarks
 * `remote.saveAs(path)` posts the method name with `[path]` and returns the
 * reply's promise. The proxy has no state of its own: calls fail as the
 * channel's do (the remote error, or closure), and listening for events or
 * making ported calls goes through `channel` directly.
 *
 * @param channel - The client end of the lane; it keeps owning the transport.
 * @returns An object whose methods call the remote implementation.
 */
export function client<
  T extends LaneInterface<T>,
  Calls extends CallMap = CallMap,
  Events extends EventMap = EventMap,
>(channel: Channel<Calls, Events>): T {
  // Interface calls are untyped on the channel: the method name is the
  // request type and the argument list its payload; `T` types them instead.
  const lane = channel as unknown as Channel<CallMap, Events>;
  return new Proxy(Object.create(null) as T, {
    get(_target, method) {
      // A promise resolving with the proxy probes `then`; it is not a lane method.
      if (typeof method !== "string" || method === "then") return undefined;

      return (...args: unknown[]) => lane.call(method, args);
    },
  });
}
