# FontTools VARC fixtures

These binary test fonts are copied from FontTools commit
[`6b407ba72a81af6f41830c096b777646d635364d`](https://github.com/fonttools/fonttools/tree/6b407ba72a81af6f41830c096b777646d635364d/Tests/ttLib/data).
They exercise compiled OpenType `VARC` behavior without representing an editable
Shift source graph.

| File | Purpose | SHA-256 |
|---|---|---|
| `varc-ac00-ac01.ttf` | Basic variable components and transforms | `a268fa68d4c05e31e428ce120ce0ac46e0127bd7fc51d680613d0565219bfad7` |
| `varc-ac01-conditional.ttf` | Conditional component participation | `4a8c24be88b838e144caa86b99e11d5f3913a50f724726d0b815cdf3ef43fc19` |
| `varc-6868.ttf` | Component axis variation | `59e844907884dd20caca0ef4534041de29421ecc5a2aed3fcf7457d640fb2a3c` |

FontTools uses these in its
[`ttGlyphSet` VARC tests](https://github.com/fonttools/fonttools/blob/6b407ba72a81af6f41830c096b777646d635364d/Tests/ttLib/ttGlyphSet_test.py)
and [`VARC` table tests](https://github.com/fonttools/fonttools/blob/6b407ba72a81af6f41830c096b777646d635364d/Tests/ttLib/tables/V_A_R_C_test.py).

The fixtures are distributed under the FontTools MIT license copied in
[`LICENSE`](LICENSE).
