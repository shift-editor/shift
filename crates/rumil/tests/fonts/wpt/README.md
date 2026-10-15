# WPT MathML fonts

OpenType copies of the fonts in web-platform-tests' [`fonts/math`](https://github.com/web-platform-tests/wpt/tree/8834c3701b4dd272e778c8d16759c1229ad56bce/fonts/math), converted from WOFF by `scripts/fetch-wpt-fonts.py`. The script pins the WPT commit; rerun it to update.

Each font sets one or two MATH values to a distinct, large number and leaves the rest at zero, with 1000 units per em. The filename names the values: `fraction-numeratorgapmin9000-rulethickness1000.otf` has `FractionNumeratorGapMin = 9000` and `FractionRuleThickness = 1000`. The `mathvariant-*`, `math-text`, `xheight500` and `lineheight*` fonts have no MATH table.

The generators are in WPT's [`mathml/tools`](https://github.com/web-platform-tests/wpt/tree/8834c3701b4dd272e778c8d16759c1229ad56bce/mathml/tools).

Licensed under the 3-Clause BSD License; see [LICENSE.md](LICENSE.md).
