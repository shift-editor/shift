import type { OpenDialogOptions } from "electron";
import { message } from "../../shared/messages";
import { FONT_FOLDER_EXTENSIONS, OPEN_FONT_EXTENSIONS } from "../../shared/openFontExtensions";

/**
 * Builds the Open dialog for font files.
 *
 * macOS shows one panel that accepts files and folders, so it also selects UFO
 * and Glyphs packages. Windows and Linux show a folder-only picker for that
 * combination, so there the dialog selects files and folder formats use
 * {@link openFontFolderDialogOptions}.
 */
export function openFontDialogOptions(platform: NodeJS.Platform): OpenDialogOptions {
  const acceptsFolders = platform === "darwin";
  const selectable = (extensions: string[]) =>
    acceptsFolders
      ? extensions
      : extensions.filter((extension) => !FONT_FOLDER_EXTENSIONS.includes(extension));

  return {
    title: message("file.open.title"),
    filters: [
      { name: message("file.open.filter.supported"), extensions: selectable(OPEN_FONT_EXTENSIONS) },
      { name: message("file.open.filter.shift"), extensions: ["shift"] },
      { name: message("file.open.filter.outline"), extensions: ["ttf", "otf"] },
      {
        name: message("file.open.filter.glyphs"),
        extensions: selectable(["glyphs", "glyphspackage"]),
      },
      { name: message("file.open.filter.sources"), extensions: selectable(["ufo", "designspace"]) },
    ],
    properties: acceptsFolders ? ["openFile", "openDirectory"] : ["openFile"],
  };
}

/** Builds the Open dialog for font formats stored as folders: UFO and Glyphs packages. */
export function openFontFolderDialogOptions(): OpenDialogOptions {
  return {
    title: message("file.openFolder.title"),
    properties: ["openDirectory"],
  };
}
