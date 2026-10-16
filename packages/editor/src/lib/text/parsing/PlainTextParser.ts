import { characterTextItem, lineBreakTextItem, type TextItem } from "../layout";
import type { TextParser } from "./TextParser";

/** Parses text as characters and line breaks, with no syntax. */
export class PlainTextParser implements TextParser {
  parse(source: string): TextItem[] {
    const items: TextItem[] = [];
    for (const char of source.replaceAll("\r\n", "\n")) {
      items.push(char === "\n" ? lineBreakTextItem() : characterTextItem(char.codePointAt(0)!));
    }
    return items;
  }
}
