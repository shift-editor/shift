import test from "ava";

import { FontService } from "../index.js";

test("FontService creation", (t) => {
  const fontService = new FontService();
  t.truthy(fontService);
  t.is(typeof fontService.getFontFamily, "function");
  t.is(typeof fontService.getFontStyle, "function");
  t.is(typeof fontService.getFontVersion, "function");
});

test("FontService default values", (t) => {
  const fontService = new FontService();
  t.is(fontService.getFontFamily(), "Untitled Font");
  t.is(fontService.getFontStyle(), "Regular");
  t.is(fontService.getFontVersion(), 1);
  t.is(fontService.getUnitsPerEm(), 1000);
  t.is(fontService.getAscender(), 750);
  t.is(fontService.getDescender(), -200);
  t.is(fontService.getCapHeight(), 700);
  t.is(fontService.getXHeight(), 500);
  t.is(fontService.getGlyphCount(), 0);
});
