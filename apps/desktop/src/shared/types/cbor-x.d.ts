import "cbor-x";

declare module "cbor-x" {
  /** Runtime export in cbor-x 1.6.5; omitted from its published TypeScript declaration. */
  export function setSizeLimits(options: {
    maxArraySize: number;
    maxMapSize: number;
    maxObjectSize: number;
  }): void;
}
