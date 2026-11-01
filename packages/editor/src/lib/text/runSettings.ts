import type { FeatureSetting } from "@shift/wasm/protocol";

/** A run's forced feature as the value layout takes: `1` turns it on, `0` off. */
export function featureValue(on: boolean): number {
  return on ? 1 : 0;
}

/** A run's forced features as layout settings. */
export function featureSettings(features: Readonly<Record<string, boolean>>): FeatureSetting[] {
  return Object.entries(features).map(([tag, on]) => ({ tag, value: featureValue(on) }));
}
