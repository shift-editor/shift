import Database from "better-sqlite3";
import type { BlockCount, CategoryCount, ScriptCount, UnicodeCharacter } from "./types.js";

interface RawRow {
  codepoint: number;
  char: string;
  name: string | null;
  category: string;
  script: string | null;
  block: string;
  combining_class: string | null;
}

function toCharacter(row: RawRow): UnicodeCharacter {
  const { codepoint, char, name, category, script, block, combining_class } = row;

  return {
    codepoint,
    char,
    name,
    category,
    script,
    block,
    combiningClass: combining_class,
  };
}

export class UnicodeDB {
  #db: Database.Database;

  constructor(dbPath: string) {
    this.#db = new Database(dbPath, { readonly: true });
  }

  getByCodepoint(cp: number): UnicodeCharacter | null {
    const row = this.#db.prepare("SELECT * FROM unicode WHERE codepoint = ?").get(cp) as
      | RawRow
      | undefined;
    return row ? toCharacter(row) : null;
  }

  getByChar(char: string): UnicodeCharacter | null {
    const cp = char.codePointAt(0);
    if (cp === undefined) return null;
    return this.getByCodepoint(cp);
  }

  findByCategory(category: string): UnicodeCharacter[] {
    const rows = this.#db
      .prepare("SELECT * FROM unicode WHERE category = ? ORDER BY codepoint")
      .all(category) as RawRow[];
    return rows.map(toCharacter);
  }

  findByScript(script: string): UnicodeCharacter[] {
    const rows = this.#db
      .prepare("SELECT * FROM unicode WHERE script = ? ORDER BY codepoint")
      .all(script) as RawRow[];
    return rows.map(toCharacter);
  }

  findByBlock(block: string): UnicodeCharacter[] {
    const rows = this.#db
      .prepare("SELECT * FROM unicode WHERE block = ? ORDER BY codepoint")
      .all(block) as RawRow[];
    return rows.map(toCharacter);
  }

  searchByName(pattern: string): UnicodeCharacter[] {
    const rows = this.#db
      .prepare("SELECT * FROM unicode WHERE name LIKE ? ORDER BY codepoint")
      .all(`%${pattern}%`) as RawRow[];
    return rows.map(toCharacter);
  }

  listBlocks(): string[] {
    const rows = this.#db
      .prepare("SELECT DISTINCT block FROM unicode ORDER BY block")
      .all() as Array<Pick<BlockCount, "block">>;
    return rows.map((r) => r.block);
  }

  listScripts(): string[] {
    const rows = this.#db
      .prepare("SELECT DISTINCT script FROM unicode WHERE script IS NOT NULL ORDER BY script")
      .all() as Array<Pick<ScriptCount, "script">>;
    return rows.map((r) => r.script);
  }

  listCategories(): string[] {
    const rows = this.#db
      .prepare("SELECT DISTINCT category FROM unicode ORDER BY category")
      .all() as Array<Pick<CategoryCount, "category">>;
    return rows.map((r) => r.category);
  }

  countByBlock(): BlockCount[] {
    return this.#db
      .prepare("SELECT block, COUNT(*) as count FROM unicode GROUP BY block ORDER BY count DESC")
      .all() as BlockCount[];
  }

  countByScript(): ScriptCount[] {
    return this.#db
      .prepare(
        "SELECT script, COUNT(*) as count FROM unicode WHERE script IS NOT NULL GROUP BY script ORDER BY count DESC",
      )
      .all() as ScriptCount[];
  }

  countByCategory(): CategoryCount[] {
    return this.#db
      .prepare(
        "SELECT category, COUNT(*) as count FROM unicode GROUP BY category ORDER BY count DESC",
      )
      .all() as CategoryCount[];
  }

  close(): void {
    this.#db.close();
  }
}
