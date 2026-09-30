import releaseAppIcon from "@/assets/app-icon.png";
import nightlyAppIcon from "@/assets/app-icon-nightly.png";
import ReleaseLauncherLockup from "@/assets/launcher-lockup.svg";
import NightlyLauncherLockup from "@/assets/launcher-lockup-nightly.svg";
import { shiftDistribution } from "./release";

export const appIcon = shiftDistribution === "nightly" ? nightlyAppIcon : releaseAppIcon;
export const LauncherLockup =
  shiftDistribution === "nightly" ? NightlyLauncherLockup : ReleaseLauncherLockup;
