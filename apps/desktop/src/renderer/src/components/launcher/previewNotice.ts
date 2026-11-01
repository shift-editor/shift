import type { RecentPreview } from "@shared/recents";

/** What a recent file's tile says in place of a preview it can't draw. */
export interface PreviewNotice {
  title: string;
  detail: string;
}

/**
 * The notice for a preview that can't be drawn: the font draws nothing, or
 * reading it failed. Null while the preview is being built or once it is.
 */
export function previewNotice(preview: RecentPreview): PreviewNotice | null {
  switch (preview.status) {
    case "pending":
    case "ready":
      return null;
    case "empty":
      return { title: "No preview", detail: "This font draws no glyphs yet" };
    case "failed":
      return {
        title: "No preview",
        detail: /schema version \d+ is newer/i.test(preview.error)
          ? "Made with a newer version of Shift"
          : "Shift couldn't read this font",
      };
  }
}
