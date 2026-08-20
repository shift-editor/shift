declare const SHIFT_DISTRIBUTION: "release" | "nightly";
declare const SHIFT_PRODUCT_VERSION: string;
declare const SHIFT_UPDATE_BASE_URL: string;

export const shiftDistribution = SHIFT_DISTRIBUTION;
export const shiftProductVersion = SHIFT_PRODUCT_VERSION;
export const shiftProductName = shiftDistribution === "nightly" ? "Shift Nightly" : "Shift";
export const shiftUpdateBaseUrl = SHIFT_UPDATE_BASE_URL;
