import type { SVG } from "@/types/common";

import ArabicIcon from "@/assets/sidebar-left/scripts/arabic.svg";
import ArmenianIcon from "@/assets/sidebar-left/scripts/armenian.svg";
import BamumIcon from "@/assets/sidebar-left/scripts/bamum.svg";
import BengaliIcon from "@/assets/sidebar-left/scripts/bengali.svg";
import BugineseIcon from "@/assets/sidebar-left/scripts/buginese.svg";
import BurmeseIcon from "@/assets/sidebar-left/scripts/burmese.svg";
import ChakmaIcon from "@/assets/sidebar-left/scripts/chakma.svg";
import CherokeeIcon from "@/assets/sidebar-left/scripts/cherokee.svg";
import ChineseIcon from "@/assets/sidebar-left/scripts/chinese.svg";
import CreeIcon from "@/assets/sidebar-left/scripts/cree.svg";
import CyrillicIcon from "@/assets/sidebar-left/scripts/cyrillic.svg";
import DevanagariIcon from "@/assets/sidebar-left/scripts/devanagari.svg";
import GeezIcon from "@/assets/sidebar-left/scripts/geez.svg";
import GeorgianIcon from "@/assets/sidebar-left/scripts/georgian.svg";
import GreekIcon from "@/assets/sidebar-left/scripts/greek.svg";
import GujaratiIcon from "@/assets/sidebar-left/scripts/gujarati.svg";
import GurmukhiIcon from "@/assets/sidebar-left/scripts/gurmukhi.svg";
import HangulIcon from "@/assets/sidebar-left/scripts/hangul.svg";
import HanjaIcon from "@/assets/sidebar-left/scripts/hanja.svg";
import HanunooIcon from "@/assets/sidebar-left/scripts/hanunoo.svg";
import HebrewIcon from "@/assets/sidebar-left/scripts/hebrew.svg";
import HiraganaIcon from "@/assets/sidebar-left/scripts/hiragana.svg";
import InuktitutSyllabicsIcon from "@/assets/sidebar-left/scripts/inuktitut-syllabics.svg";
import KanjiIcon from "@/assets/sidebar-left/scripts/kanji.svg";
import KannadaIcon from "@/assets/sidebar-left/scripts/kannada.svg";
import KatakanaIcon from "@/assets/sidebar-left/scripts/katakana.svg";
import KayahLiIcon from "@/assets/sidebar-left/scripts/kayah-li.svg";
import LaoIcon from "@/assets/sidebar-left/scripts/lao.svg";
import LatinIcon from "@/assets/sidebar-left/scripts/latin.svg";
import MalayalamIcon from "@/assets/sidebar-left/scripts/malayalam.svg";
import ModernYiIcon from "@/assets/sidebar-left/scripts/modern-yi.svg";
import OjibweSyllabicsIcon from "@/assets/sidebar-left/scripts/ojibwe-syllabics.svg";
import OriyaIcon from "@/assets/sidebar-left/scripts/oriya.svg";
import SinhalaIcon from "@/assets/sidebar-left/scripts/sinhala.svg";
import SyriacIcon from "@/assets/sidebar-left/scripts/syriac.svg";
import TaiVietIcon from "@/assets/sidebar-left/scripts/tai-viet.svg";
import TamilIcon from "@/assets/sidebar-left/scripts/tamil.svg";
import TeluguIcon from "@/assets/sidebar-left/scripts/telugu.svg";
import ThaanaIcon from "@/assets/sidebar-left/scripts/thaana.svg";
import ThaiIcon from "@/assets/sidebar-left/scripts/thai.svg";
import ThamIcon from "@/assets/sidebar-left/scripts/tham.svg";
import TibetanIcon from "@/assets/sidebar-left/scripts/tibetan.svg";
import TifinaghIcon from "@/assets/sidebar-left/scripts/tifinagh.svg";
import VaiIcon from "@/assets/sidebar-left/scripts/vai.svg";

/** Icon per Hyperglot script name, drawn from Noto Sans (Noto Serif Tibetan). */
export const SCRIPT_ICON_MAP: Readonly<Record<string, SVG>> = {
  Arabic: ArabicIcon,
  Armenian: ArmenianIcon,
  Bamum: BamumIcon,
  Bengali: BengaliIcon,
  Buginese: BugineseIcon,
  Burmese: BurmeseIcon,
  Chakma: ChakmaIcon,
  Cherokee: CherokeeIcon,
  Chinese: ChineseIcon,
  Cree: CreeIcon,
  Cyrillic: CyrillicIcon,
  Devanagari: DevanagariIcon,
  Geʽez: GeezIcon,
  Georgian: GeorgianIcon,
  Greek: GreekIcon,
  Gujarati: GujaratiIcon,
  Gurmukhi: GurmukhiIcon,
  Hangul: HangulIcon,
  Hanja: HanjaIcon,
  Hanunoo: HanunooIcon,
  Hebrew: HebrewIcon,
  Hiragana: HiraganaIcon,
  "Inuktitut Syllabics": InuktitutSyllabicsIcon,
  Kanji: KanjiIcon,
  Kannada: KannadaIcon,
  Katakana: KatakanaIcon,
  "Kayah Li": KayahLiIcon,
  Lao: LaoIcon,
  Latin: LatinIcon,
  Malayalam: MalayalamIcon,
  "Modern Yi": ModernYiIcon,
  "Ojibwe Syllabics": OjibweSyllabicsIcon,
  Oriya: OriyaIcon,
  Sinhala: SinhalaIcon,
  Syriac: SyriacIcon,
  "Tai Viet": TaiVietIcon,
  Tamil: TamilIcon,
  Telugu: TeluguIcon,
  Thaana: ThaanaIcon,
  Thai: ThaiIcon,
  Tham: ThamIcon,
  Tibetan: TibetanIcon,
  Tifinagh: TifinaghIcon,
  Vai: VaiIcon,
};

export interface ScriptIconProps {
  script: string;
}

export const ScriptIcon = ({ script }: ScriptIconProps) => {
  const Icon = SCRIPT_ICON_MAP[script];
  return Icon ? (
    <Icon className="h-4 w-4 shrink-0 text-primary" />
  ) : (
    <span className="h-4 w-4 shrink-0" />
  );
};
