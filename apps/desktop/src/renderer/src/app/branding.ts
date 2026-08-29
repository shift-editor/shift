import releaseAppIcon from "@/assets/app-icon.png";
import nightlyAppIcon from "@/assets/app-icon-nightly.png";
import ReleaseLauncherLogo from "@/assets/launcher-logo.svg";
import NightlyLauncherLogo from "@/assets/launcher-logo-nightly.svg";
import { shiftDistribution } from "./release";

export const appIcon = shiftDistribution === "nightly" ? nightlyAppIcon : releaseAppIcon;
export const LauncherLogo =
  shiftDistribution === "nightly" ? NightlyLauncherLogo : ReleaseLauncherLogo;
