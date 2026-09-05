import path from "node:path";
import messages from "../apps/desktop/src/shared/messages/en.json" with { type: "json" };

export const screenshotManifest = [
  { label: "Launcher window", fileName: "launcher.png" },
  { label: "Launcher desktop", fileName: "launcher-desktop.png" },
  { label: "Document window", fileName: "document.png" },
  { label: "Document desktop", fileName: "document-desktop.png" },
  { label: "File association window", fileName: "file-association.png" },
  { label: "File association desktop", fileName: "file-association-desktop.png" },
  { label: "Application menu", fileName: "application-menu.png" },
  { label: "Open Font", fileName: "open-font.png" },
  { label: "Save as Shift", fileName: "save-as-shift.png" },
  { label: "Export TrueType", fileName: "export-truetype.png" },
  { label: "Document create failure", fileName: "document-create-failed.png" },
  { label: "Document open failure", fileName: "document-open-failed.png" },
  { label: "Document save failure", fileName: "document-save-failed.png" },
  { label: "Document export failure", fileName: "document-export-failed.png" },
  { label: "Unsaved document", fileName: "document-unsaved.png" },
  { label: "Crashed document", fileName: "document-crashed.png" },
  { label: "Document reopen failure", fileName: "document-reopen-failed.png" },
  { label: "Update restart blocked", fileName: "update-restart-blocked.png" },
  { label: "Current version", fileName: "update-current.png" },
  { label: "Update check failure", fileName: "update-check-failed.png" },
  { label: "Update download failure", fileName: "update-download-failed.png" },
  {
    label: "Development update unavailable",
    fileName: "update-development-unavailable.png",
  },
  { label: "Manual update only", fileName: "update-manual-only.png" },
  { label: "Convertible preview", fileName: "preview-convertible.png" },
  { label: "View-only preview", fileName: "preview-view-only.png" },
  { label: "Application error", fileName: "react-app-error.png" },
  { label: "Application error details", fileName: "react-app-error-details.png" },
  { label: "Document error", fileName: "react-document-error.png" },
  { label: "Document error details", fileName: "react-document-error-details.png" },
  { label: "Update available", fileName: "update-available.png" },
  { label: "Update downloading", fileName: "update-downloading.png" },
  { label: "Update ready", fileName: "update-ready.png" },
  { label: "Settings save failure", fileName: "settings-save-failed.png" },
];

export function createFileDialogs(testRoot) {
  return [
    {
      fileName: "open-font.png",
      kind: "open",
      options: {
        title: message("file.open.title"),
        filters: [
          {
            name: message("file.open.filter.supported"),
            extensions: ["shift", "ttf", "otf", "glyphs", "glyphspackage", "ufo", "designspace"],
          },
          { name: message("file.open.filter.shift"), extensions: ["shift"] },
          { name: message("file.open.filter.outline"), extensions: ["ttf", "otf"] },
          {
            name: message("file.open.filter.glyphs"),
            extensions: ["glyphs", "glyphspackage"],
          },
          {
            name: message("file.open.filter.sources"),
            extensions: ["ufo", "designspace"],
          },
        ],
        properties: ["openFile", "openDirectory"],
      },
    },
    {
      fileName: "save-as-shift.png",
      kind: "save",
      options: {
        title: message("file.saveShift.title"),
        defaultPath: path.join(testRoot, "Example.shift"),
        filters: [{ name: message("file.saveShift.filter"), extensions: ["shift"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      },
    },
    {
      fileName: "export-truetype.png",
      kind: "save",
      options: {
        title: message("file.exportTrueType.title"),
        defaultPath: path.join(testRoot, message("file.exportTrueType.untitledFilename")),
        filters: [{ name: message("file.exportTrueType.filter"), extensions: ["ttf"] }],
        properties: ["createDirectory", "showOverwriteConfirmation"],
      },
    },
  ];
}

export function createMessageDialogs(applicationName, updateVersion) {
  const okButton = [message("action.ok")];
  const failure = (fileName, messageId, detailId) => ({
    fileName,
    kind: "message",
    options: {
      type: "error",
      buttons: okButton,
      defaultId: 0,
      title: applicationName,
      message: message(messageId, { applicationName }),
      detail: message(detailId, { applicationName }),
    },
  });

  return [
    failure(
      "document-create-failed.png",
      "document.createFailed.message",
      "document.createFailed.detail",
    ),
    failure(
      "document-open-failed.png",
      "document.openFailed.message",
      "document.openFailed.detail",
    ),
    failure(
      "document-save-failed.png",
      "document.saveFailed.message",
      "document.saveFailed.detail",
    ),
    failure(
      "document-export-failed.png",
      "document.exportFailed.message",
      "document.exportFailed.detail",
    ),
    {
      fileName: "document-unsaved.png",
      kind: "message",
      options: {
        type: "warning",
        buttons: [message("action.save"), message("action.dontSave"), message("action.cancel")],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        title: applicationName,
        message: message("document.unsaved.message", {
          documentName: "Installed app – association.shift",
        }),
        detail: message("document.unsaved.detail"),
      },
    },
    {
      fileName: "document-crashed.png",
      kind: "message",
      options: {
        type: "warning",
        buttons: [message("action.reopenDocument"), message("action.closeWindow")],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: applicationName,
        message: message("document.crashed.message"),
        detail: message("document.crashed.detail"),
      },
    },
    {
      fileName: "document-reopen-failed.png",
      kind: "message",
      options: {
        type: "error",
        buttons: [message("action.tryAgain"), message("action.closeWindow")],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: applicationName,
        message: message("document.reopenFailed.message"),
        detail: message("document.reopenFailed.detail"),
      },
    },
    failure(
      "update-restart-blocked.png",
      "update.restartBlocked.message",
      "update.restartBlocked.detail",
    ),
    {
      fileName: "update-current.png",
      kind: "message",
      options: {
        type: "info",
        buttons: okButton,
        title: applicationName,
        message: message("update.current.message", { applicationName }),
        detail: message("update.current.detail", { version: updateVersion }),
      },
    },
    {
      fileName: "update-check-failed.png",
      kind: "message",
      options: {
        type: "error",
        buttons: [message("action.viewDownloads"), message("action.ok")],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: applicationName,
        message: message("update.checkFailed.message", { applicationName }),
        detail: message("update.checkFailed.detail"),
      },
    },
    {
      fileName: "update-download-failed.png",
      kind: "message",
      options: {
        type: "error",
        buttons: [message("action.viewDownloads"), message("action.ok")],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: applicationName,
        message: message("update.downloadFailed.message", { applicationName }),
        detail: message("update.downloadFailed.detail"),
      },
    },
    {
      fileName: "update-development-unavailable.png",
      kind: "message",
      options: {
        type: "info",
        buttons: okButton,
        title: applicationName,
        message: message("update.developmentUnavailable.message"),
        detail: message("update.developmentUnavailable.detail", { applicationName }),
      },
    },
    {
      fileName: "update-manual-only.png",
      kind: "message",
      options: {
        type: "info",
        buttons: [message("action.viewDownloads"), message("action.cancel")],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: applicationName,
        message: message("update.manualOnly.message"),
        detail: message("update.manualOnly.detail"),
      },
    },
  ];
}

export function message(id, values = {}) {
  const template = messages[id];
  if (typeof template !== "string") throw new Error(`Unknown message ID: ${id}`);

  return template.replace(/\{(\w+)\}/g, (_placeholder, name) => {
    if (!(name in values)) throw new Error(`Missing message value for ${id}: ${name}`);
    return String(values[name]);
  });
}
