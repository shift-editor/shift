import type { GlyphCategory } from "@shift/glyph-info";
import type { SVG } from "@/types/common";
import LetterIcon from "@/assets/sidebar-left/letters.svg";
import MarkIcon from "@/assets/sidebar-left/marks.svg";
import NumberIcon from "@/assets/sidebar-left/numbers.svg";
import PunctuationIcon from "@/assets/sidebar-left/punctuation.svg";
import SeparatorIcon from "@/assets/sidebar-left/separator.svg";
import SymbolIcon from "@/assets/sidebar-left/symbol.svg";
import OtherIcon from "@/assets/sidebar-left/other.svg";

export const CATEGORY_ICON_MAP: Record<GlyphCategory, SVG | null> = {
  Letter: LetterIcon,
  Mark: MarkIcon,
  Number: NumberIcon,
  Punctuation: PunctuationIcon,
  Separator: SeparatorIcon,
  Symbol: SymbolIcon,
  Other: OtherIcon,
};

export interface CategoryIconProps {
  category: GlyphCategory;
}
export const CategoryIcon = ({ category }: CategoryIconProps) => {
  const Icon = CATEGORY_ICON_MAP[category];
  return Icon ? <Icon className="w-4 h-4" /> : null;
};
