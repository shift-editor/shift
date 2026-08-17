import { dialog, type MessageBoxOptions } from "electron";
import { errorToMessage } from "../../shared/errors";
import type { Window } from "../windows/Window";
import type { Update, UpdateDisabledReason, UpdatePhase } from "./types";

export async function showUpdateCurrent(
  owner: Window | null,
  applicationName: string,
  version: string,
): Promise<void> {
  await showMessage(owner, {
    type: "info",
    buttons: ["OK"],
    defaultId: 0,
    title: applicationName,
    message: `${applicationName} is up to date.`,
    detail: `You are running ${applicationName} ${version}.`,
  });
}

export async function showUpdateDownloading(
  owner: Window | null,
  applicationName: string,
  update: Update,
): Promise<void> {
  await showMessage(owner, {
    type: "info",
    buttons: ["OK"],
    defaultId: 0,
    title: applicationName,
    message: `Downloading ${applicationName} ${update.version}…`,
    detail: "You can keep working. Shift will let you know when the update is ready.",
  });
}

export async function showUpdateReady(
  owner: Window | null,
  applicationName: string,
  update: Update,
): Promise<boolean> {
  const result = await showMessage(owner, {
    type: "info",
    buttons: ["Restart", "Later"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: applicationName,
    message: `${applicationName} ${update.version} is ready to install.`,
    detail: "Restart to finish updating. Shift will ask about any unsaved documents first.",
  });

  return result.response === 0;
}

export async function showUpdateFailure(
  owner: Window | null,
  applicationName: string,
  phase: UpdatePhase,
  error: unknown,
): Promise<boolean> {
  const canRetry = phase !== "restart";
  const result = await showMessage(owner, {
    type: "error",
    buttons: canRetry ? ["Retry", "Cancel"] : ["OK"],
    defaultId: 0,
    cancelId: canRetry ? 1 : 0,
    noLink: true,
    title: applicationName,
    message: updateFailureMessage(phase),
    detail: errorToMessage(error),
  });

  return canRetry && result.response === 0;
}

export async function showUpdateUnavailable(
  owner: Window | null,
  applicationName: string,
  reason: UpdateDisabledReason,
): Promise<boolean> {
  const canOpenDownloads = reason !== "development";
  const result = await showMessage(owner, {
    type: "info",
    buttons: canOpenDownloads ? ["View Downloads", "Cancel"] : ["OK"],
    defaultId: 0,
    cancelId: canOpenDownloads ? 1 : 0,
    noLink: true,
    title: applicationName,
    message: updateUnavailableMessage(reason),
    detail: updateUnavailableDetail(reason),
  });

  return canOpenDownloads && result.response === 0;
}

function showMessage(owner: Window | null, options: MessageBoxOptions) {
  return owner ? dialog.showMessageBox(owner.window, options) : dialog.showMessageBox(options);
}

function updateFailureMessage(phase: UpdatePhase): string {
  switch (phase) {
    case "check":
      return "Shift couldn't check for updates.";
    case "download":
      return "Shift couldn't download the update.";
    case "restart":
      return "Shift couldn't restart to install the update.";
  }
}

function updateUnavailableMessage(reason: UpdateDisabledReason): string {
  switch (reason) {
    case "development":
      return "Updates aren't available in development builds.";
    case "unsupported-platform":
      return "Automatic updates aren't available for this Linux build.";
    case "missing-configuration":
      return "Updates aren't configured for this build.";
    case "unsigned-windows":
      return "Automatic updates aren't enabled for this Windows build.";
  }
}

function updateUnavailableDetail(reason: UpdateDisabledReason): string {
  switch (reason) {
    case "development":
      return "Package the application to exercise the update flow.";
    case "unsupported-platform":
      return "Download the latest package for your Shift distribution from GitHub Releases.";
    case "missing-configuration":
      return "This build does not contain a trusted update-feed public key.";
    case "unsigned-windows":
      return "Download the latest installer manually until signed Windows updates are available.";
  }
}
