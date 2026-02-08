export interface UnicodeCharacter {
  codepoint: number;
  char: string;
  name: string | null;
  category: string;
  script: string | null;
  block: string;
  combiningClass: string | null;
}

export interface BlockCount {
  block: string;
  count: number;
}

export interface ScriptCount {
  script: string;
  count: number;
}

export interface CategoryCount {
  category: string;
  count: number;
}
