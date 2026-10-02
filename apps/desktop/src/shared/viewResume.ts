import type { GlyphId, GlyphName } from "@shift/types";

/** Stable glyph identity for remapping across preview import (IDs are re-minted). */
export type SessionViewResumeRoute = {
  glyphName: GlyphName;
  unicode: number | null;
  /** When the workspace store is resumed, the prior GlyphId may still be valid. */
  glyphId: GlyphId | null;
};

export type SessionViewResumeCategoryFilter = {
  category: string;
  subCategoryKey: string | null;
};

export type SessionViewResumeCatalog = {
  query: string;
  categoryFilters: readonly SessionViewResumeCategoryFilter[];
  selectedLanguageId: string | null;
  scrollTop: number;
};

/** Last renderer view state persisted for one font session. */
export type SessionViewResume = {
  route: SessionViewResumeRoute | null;
  catalog: SessionViewResumeCatalog;
};

export type SessionViewResumeOpenSession = {
  sessionId: string;
  documentPath: string | null;
};

export type ViewResumeFile = {
  sessions: Record<string, SessionViewResume>;
  openSessionsAtQuit: SessionViewResumeOpenSession[];
};

export function emptySessionViewResume(): SessionViewResume {
  return {
    route: null,
    catalog: {
      query: "",
      categoryFilters: [],
      selectedLanguageId: null,
      scrollTop: 0,
    },
  };
}
