"""Generates a one-master .glyphs fixture: a-z with ring-like outlines, u with
anchors, combining marks with _top/top, and composites on u (incl. udieresismacron)."""
import math, sys

out = sys.argv[1]

def ring(cx, cy, rx, ry, segments=8, reverse=False):
    """A closed cubic ellipse approximated with `segments` curves (3 nodes each)."""
    nodes = []
    k = 4 / 3 * math.tan(math.pi / (2 * segments))
    pts = []
    for i in range(segments):
        a0 = 2 * math.pi * i / segments
        a1 = 2 * math.pi * (i + 1) / segments
        p0 = (cx + rx * math.cos(a0), cy + ry * math.sin(a0))
        p3 = (cx + rx * math.cos(a1), cy + ry * math.sin(a1))
        c1 = (p0[0] - k * rx * math.sin(a0), p0[1] + k * ry * math.cos(a0))
        c2 = (p3[0] + k * rx * math.sin(a1), p3[1] - k * ry * math.cos(a1))
        pts.append((c1, c2, p3))
    for c1, c2, p3 in pts:
        nodes.append(f'"{round(c1[0])} {round(c1[1])} OFFCURVE"')
        nodes.append(f'"{round(c2[0])} {round(c2[1])} OFFCURVE"')
        nodes.append(f'"{round(p3[0])} {round(p3[1])} CURVE SMOOTH"')
    if reverse:
        nodes = list(reversed(nodes))
    return "{\nclosed = 1;\nnodes = (\n" + ",\n".join(nodes) + "\n);\n}"

def rect(x0, y0, x1, y1):
    nodes = [f'"{x0} {y0} LINE"', f'"{x1} {y0} LINE"', f'"{x1} {y1} LINE"', f'"{x0} {y1} LINE"']
    return "{\nclosed = 1;\nnodes = (\n" + ",\n".join(nodes) + "\n);\n}"

def anchors(items):
    return "anchors = (\n" + ",\n".join(
        f'{{\nname = "{n}";\nposition = "{{{x}, {y}}}";\n}}' for n, x, y in items
    ) + "\n);\n"

def glyph(name, unicode, width, paths=(), anchor_items=(), components=()):
    body = f"layerId = m01;\nwidth = {width};\n"
    if anchor_items:
        body += anchors(anchor_items)
    if components:
        body += "components = (\n" + ",\n".join(
            f'{{\nname = "{n}";\ntransform = "{{1, 0, 0, 1, {dx}, {dy}}}";\n}}' for n, dx, dy in components
        ) + "\n);\n"
    if paths:
        body += "paths = (\n" + ",\n".join(paths) + "\n);\n"
    uni = f"unicode = {unicode:04X};\n" if unicode is not None else ""
    return f'{{\nglyphname = "{name}";\n{uni}layers = (\n{{\n{body}}}\n);\n}}'

glyphs = []
# Base letters: outer ring + counter ring (2 contours x 24 points), plus a stem.
for i, ch in enumerate("abcdefghijklmnopqrstvwxyz"):
    w = 480 + (i % 5) * 20
    glyphs.append(glyph(ch, ord(ch), w,
        paths=[ring(w / 2, 250, w / 2 - 40, 250), ring(w / 2, 250, w / 2 - 110, 180, reverse=True),
               rect(w - 90, 0, w - 40, 500)],
        anchor_items=[("top", round(w / 2), 500), ("bottom", round(w / 2), 0)]))
# u: like the others; top at (250, 500).
glyphs.append(glyph("u", 0x75, 500,
    paths=[ring(250, 250, 210, 250), ring(250, 250, 140, 180, reverse=True), rect(410, 0, 460, 500)],
    anchor_items=[("top", 250, 500), ("bottom", 250, 0), ("ogonek", 420, 0)]))
glyphs.append(glyph("space", 0x20, 250))
glyphs.append(glyph("period", 0x2E, 250, paths=[ring(125, 50, 50, 50)]))
glyphs.append(glyph("comma", 0x2C, 250, paths=[ring(125, 30, 45, 70)]))

# Marks, all with _top at x=150, y=500 and a top above.
glyphs.append(glyph("dieresiscomb", 0x308, 0,
    paths=[ring(90, 580, 40, 40), ring(210, 580, 40, 40)],
    anchor_items=[("_top", 150, 500), ("top", 150, 650)]))
glyphs.append(glyph("macroncomb", 0x304, 0,
    paths=[rect(40, 560, 260, 610)],
    anchor_items=[("_top", 150, 500), ("top", 150, 640)]))
glyphs.append(glyph("acutecomb", 0x301, 0,
    paths=[rect(130, 540, 200, 690)],
    anchor_items=[("_top", 150, 500), ("top", 150, 700)]))
glyphs.append(glyph("gravecomb", 0x300, 0,
    paths=[rect(100, 540, 170, 690)],
    anchor_items=[("_top", 150, 500), ("top", 150, 700)]))
glyphs.append(glyph("caroncomb", 0x30C, 0,
    paths=[rect(60, 540, 240, 600), rect(120, 600, 180, 680)],
    anchor_items=[("_top", 150, 500), ("top", 150, 690)]))

# Composites on u, components placed on their anchors.
# u.top (250,500) - mark._top (150,500) => (100, 0); second mark sits on first mark's top.
on_u = (100, 0)
def stacked(first_top_y):
    # second mark's _top (150,500) onto first mark's top (150+100, first_top_y)
    return (100, first_top_y - 500)
glyphs.append(glyph("udieresismacron", 0x1D6, 500,
    components=[("u", 0, 0), ("dieresiscomb", *on_u), ("macroncomb", *stacked(650))]))
glyphs.append(glyph("udieresisacute", 0x1D8, 500,
    components=[("u", 0, 0), ("dieresiscomb", *on_u), ("acutecomb", *stacked(650))]))
glyphs.append(glyph("udieresiscaron", 0x1DA, 500,
    components=[("u", 0, 0), ("dieresiscomb", *on_u), ("caroncomb", *stacked(650))]))
glyphs.append(glyph("udieresis", 0xFC, 500, components=[("u", 0, 0), ("dieresiscomb", *on_u)]))
glyphs.append(glyph("uacute", 0xFA, 500, components=[("u", 0, 0), ("acutecomb", *on_u)]))
glyphs.append(glyph("ugrave", 0xF9, 500, components=[("u", 0, 0), ("gravecomb", *on_u)]))
glyphs.append(glyph("umacron", 0x16B, 500, components=[("u", 0, 0), ("macroncomb", *on_u)]))

font = f"""{{
.appVersion = "1225";
familyName = "Anchor Drag Bench";
fontMaster = (
{{
ascender = 800;
capHeight = 700;
descender = -200;
id = m01;
xHeight = 500;
}}
);
glyphs = (
{",\n".join(glyphs)}
);
unitsPerEm = 1000;
versionMajor = 1;
versionMinor = 0;
}}
"""
open(out, "w").write(font)
print("wrote", out, len(glyphs), "glyphs")
