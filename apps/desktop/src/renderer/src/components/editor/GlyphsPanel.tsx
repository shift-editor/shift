import { useMemo, useState } from "react";
import type { GlyphCategory } from "@shift/glyph-info";
import { useSignalState } from "@shift/editor/signals";
import {
  Button,
  Check,
  Input,
  Menu,
  MenuCheckboxItem,
  MenuCheckboxItemIndicator,
  MenuPopup,
  MenuPortal,
  MenuPositioner,
  MenuSeparator,
  MenuTrigger,
  Toggle,
  Tooltip,
  X,
  ListFilter,
} from "@shift/ui";
import { GlyphTiles } from "@/components/glyph-grid/GlyphTiles";
import { GlyphGridFooter } from "@/components/home/GlyphGridFooter";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { colorsInUse, filterByColor } from "@/lib/glyph-grid/colorFilter";
import { glyphSearchMatcher, NO_SEARCH } from "@/lib/glyph-grid/glyphSearch";
import { insertGlyphIntoText } from "@/lib/glyph-grid/insertGlyph";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";
import { useFontSession } from "@/workspace/WorkspaceContext";

/**
 * The canvas's Glyphs tab: every glyph of the font as small tiles, to find
 * one without leaving the canvas.
 *
 * @remarks
 * Search by name (Aa keeps case, `.*` reads a regular expression), filter by
 * category and language, and by tag colour and tile size from the footer.
 * Clicking a tile opens the glyph; ⌘-clicking it, or dragging it onto the
 * canvas, adds it to the page's text. The tab filters apart from the font
 * overview's grid, with the same filter.
 */
export const GlyphsPanel = () => {
  const session = useFontSession();
  const {
    filterGlyphs,
    categories,
    languageScripts,
    location,
    metrics,
    glyphPreviews,
    observeAtlasInvalidation,
    openGlyph,
  } = useGlyphCatalog();
  const view = session.tabs.canvasGlyphsView;
  const tileSize = useSignalState(view.tileSizeCell);
  const colorFilter = useSignalState(view.colorFilterCell);
  const [search, setSearch] = useState(NO_SEARCH);
  const [chosenCategories, setChosenCategories] = useState<readonly GlyphCategory[]>([]);
  const [languageId, setLanguageId] = useState<string | null>(null);
  const languages = languageScripts.flatMap((script) =>
    script.languages.map((coverage) => coverage.language),
  );
  const language = languages.find((candidate) => candidate.id === languageId) ?? null;
  const matcher = useMemo(() => glyphSearchMatcher(search), [search]);

  // Categories and language go through the window's one filter; the search here adds Aa and `.*`.
  const filtered = useMemo(() => {
    const categoryFilters = chosenCategories.map((category) => ({
      category,
      subCategoryKey: null,
    }));
    const inFilters = filterGlyphs({ query: "", categoryFilters, languageId });
    return matcher.kind === "matcher" ? inFilters.filter(matcher.matches) : [];
  }, [chosenCategories, filterGlyphs, languageId, matcher]);
  const shown = useMemo(() => filterByColor(filtered, colorFilter), [colorFilter, filtered]);
  const colors = useMemo(() => colorsInUse(filtered, colorFilter), [colorFilter, filtered]);

  const toggleCategory = (category: GlyphCategory) =>
    setChosenCategories((chosen) =>
      chosen.includes(category)
        ? chosen.filter((candidate) => candidate !== category)
        : [...chosen, category],
    );
  const pick = async (glyph: GlyphCatalogItem, withCommand: boolean) => {
    try {
      if (!withCommand) {
        await openGlyph(glyph);
        return;
      }
      await session.editor.font.loadGlyphs([glyph.id]);
      insertGlyphIntoText(session.editor, glyph.id);
    } catch (error) {
      console.error("could not open or insert the glyph", glyph.name, error);
    }
  };
  const chips = [
    ...chosenCategories.map((category) => ({
      key: `category:${category}`,
      label: category,
      remove: () => toggleCategory(category),
    })),
    ...(language
      ? [
          {
            key: `language:${language.id}`,
            label: language.name,
            remove: () => setLanguageId(null),
          },
        ]
      : []),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The gap below keeps scrolled tiles, the search field's grey, from meeting it. */}
      <div className="flex shrink-0 flex-col gap-1 px-2 pt-2 pb-2">
        <div className="flex items-center gap-1">
          <Input
            aria-label="Search glyphs"
            aria-invalid={matcher.kind === "invalid"}
            placeholder="Search"
            value={search.text}
            onChange={(event) => setSearch({ ...search, text: event.target.value })}
          />
          {/* Fixed beside the search field, so each button stays a 24px square. */}
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip content="Match case">
              <Toggle
                aria-label="Match case"
                pressed={search.caseSensitive}
                onPressedChange={(caseSensitive) => setSearch({ ...search, caseSensitive })}
              >
                <span aria-hidden="true" className="text-ui">
                  Aa
                </span>
              </Toggle>
            </Tooltip>
            <Tooltip content="Regular expression">
              <Toggle
                aria-label="Regular expression"
                pressed={search.regex}
                onPressedChange={(regex) => setSearch({ ...search, regex })}
              >
                <span aria-hidden="true" className="font-mono text-ui">
                  .*
                </span>
              </Toggle>
            </Tooltip>
            <Menu>
              <Tooltip content="Filter">
                <MenuTrigger
                  render={<Button variant="ghost" size="icon-sm" aria-label="Filter glyphs" />}
                >
                  <ListFilter aria-hidden className="h-3.5 w-3.5" />
                </MenuTrigger>
              </Tooltip>
              <MenuPortal>
                <MenuPositioner side="right" align="start" sideOffset={8}>
                  <MenuPopup
                    aria-label="Filter glyphs"
                    className="max-h-80 min-w-44 overflow-y-auto"
                  >
                    {categories.map(({ category }) => (
                      <MenuCheckboxItem
                        key={category}
                        className="gap-2"
                        checked={chosenCategories.includes(category)}
                        onCheckedChange={() => toggleCategory(category)}
                      >
                        <MenuCheckboxItemIndicator
                          keepMounted
                          className="data-[unchecked]:invisible"
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </MenuCheckboxItemIndicator>
                        <span>{category}</span>
                      </MenuCheckboxItem>
                    ))}
                    {languages.length > 0 ? <MenuSeparator /> : null}
                    {languages.map(({ id, name }) => (
                      <MenuCheckboxItem
                        key={id}
                        className="gap-2"
                        checked={languageId === id}
                        onCheckedChange={(checked) => setLanguageId(checked ? id : null)}
                      >
                        <MenuCheckboxItemIndicator
                          keepMounted
                          className="data-[unchecked]:invisible"
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
                        </MenuCheckboxItemIndicator>
                        <span>{name}</span>
                      </MenuCheckboxItem>
                    ))}
                  </MenuPopup>
                </MenuPositioner>
              </MenuPortal>
            </Menu>
          </div>
        </div>
        {matcher.kind === "invalid" ? (
          <span role="status" className="text-xs text-error">
            {matcher.problem}
          </span>
        ) : null}
        {chips.length > 0 ? (
          <ul aria-label="Filters" className="flex flex-wrap gap-1">
            {chips.map((chip) => (
              <li
                key={chip.key}
                className="flex h-5 items-center gap-0.5 rounded bg-input pl-1.5 text-ui text-primary"
              >
                <span className="max-w-24 truncate" title={chip.label}>
                  {chip.label}
                </span>
                <Tooltip content="Remove filter">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${chip.label} filter`}
                    onClick={chip.remove}
                  >
                    <X aria-hidden className="h-3 w-3" />
                  </Button>
                </Tooltip>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 text-primary" data-filtered-glyph-count={shown.length}>
        <GlyphTiles
          glyphs={shown}
          location={location}
          metrics={metrics}
          tileSize={tileSize}
          glyphPreviews={glyphPreviews}
          observeAtlasInvalidation={observeAtlasInvalidation}
          onPick={(glyph, withCommand) => void pick(glyph, withCommand)}
        />
      </div>
      <GlyphGridFooter
        colors={colors}
        colorFilter={colorFilter}
        filterColor={(color, add) => view.filterColor(color, add)}
        tileSize={tileSize}
        setTileSize={(size) => view.setTileSize(size)}
      />
    </div>
  );
};
