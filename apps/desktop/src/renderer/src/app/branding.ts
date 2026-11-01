import releaseAppIcon from "@/assets/app-icon.png";
import nightlyAppIcon from "@/assets/app-icon-nightly.png";
import LauncherLockupSvg from "@/assets/launcher-lockup.svg";
import { shiftDistribution } from "./release";

export const appIcon = shiftDistribution === "nightly" ? nightlyAppIcon : releaseAppIcon;
/** The ghost and "Shift." wordmark, drawn in currentColor; one lockup for every distribution. */
export const LauncherLockup = LauncherLockupSvg;
