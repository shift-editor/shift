declare const SHIFT_DISTRIBUTION: "release" | "nightly";

export const shiftDistribution = SHIFT_DISTRIBUTION;
export const shiftProductName = shiftDistribution === "nightly" ? "Shift Nightly" : "Shift";
