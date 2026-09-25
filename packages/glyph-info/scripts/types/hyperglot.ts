export type HyperglotAttribute =
  | "base"
  | "auxiliary"
  | "marks"
  | "punctuation"
  | "numerals"
  | "currency";

export type HyperglotOrthographyStatus = "primary" | "secondary" | "historical" | "transliteration";

export interface HyperglotOrthography {
  autonym?: string;
  base?: string;
  auxiliary?: string;
  marks?: string;
  punctuation?: string;
  numerals?: string;
  currency?: string;
  script: string;
  status?: HyperglotOrthographyStatus;
}

export interface HyperglotLanguage {
  name: string;
  preferred_name?: string;
  orthographies?: HyperglotOrthography[];
  status?: "living" | "historical" | "constructed";
  validity?: "todo" | "draft" | "preliminary" | "verified";
}
