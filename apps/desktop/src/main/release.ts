declare const SHIFT_DISTRIBUTION: "release" | "nightly";
declare const SHIFT_PRODUCT_VERSION: string;
declare const SHIFT_UPDATE_BASE_URL: string;
declare const SHIFT_UPDATE_PUBLIC_KEY: string;
declare const SHIFT_WINDOWS_UPDATES_ENABLED: boolean;

export const shiftDistribution = SHIFT_DISTRIBUTION;
export const shiftProductVersion = SHIFT_PRODUCT_VERSION;
export const shiftProductName = shiftDistribution === "nightly" ? "Shift Nightly" : "Shift";
export const shiftUpdateBaseUrl = SHIFT_UPDATE_BASE_URL;
export const shiftUpdatePublicKey = SHIFT_UPDATE_PUBLIC_KEY;
export const shiftWindowsUpdatesEnabled = SHIFT_WINDOWS_UPDATES_ENABLED;
