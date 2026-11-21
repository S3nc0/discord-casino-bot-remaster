#!/usr/bin/env python3
"""Builds preview.html: CURRENT tokens next to round 1 and round 2, dark and light, in one file.

Self-contained: inline CSS, fonts embedded from the @fontsource packages (set FONTSOURCE_DIR when
packages/ui has no node_modules yet), no external URLs.

    FONTSOURCE_DIR=/path/to/node_modules/@fontsource python3 design/bitbloom/proposal/build_preview.py
"""
import base64
import os
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BASE = HERE.parent

# ---------------------------------------------------------------- fonts (embedded)
font_dirs = [Path(p) for p in [os.environ.get("FONTSOURCE_DIR", ""), str(ROOT / "packages/ui/node_modules/@fontsource")] if p]


def font_face(family, pkg, weight):
    for d in font_dirs:
        f = d / pkg / "files" / f"{pkg}-latin-{weight}-normal.woff2"
        if f.exists():
            b64 = base64.b64encode(f.read_bytes()).decode()
            return f'@font-face{{font-family:"{family}";font-weight:{weight};font-style:normal;font-display:swap;src:url(data:font/woff2;base64,{b64}) format("woff2")}}'
    return ""


FONTS = "\n".join(
    [font_face("Pixelify Sans", "pixelify-sans", w) for w in (400, 600)]
    + [font_face("Atkinson Hyperlegible", "atkinson-hyperlegible", w) for w in (400, 700)]
)

# ---------------------------------------------------------------- token sets, scoped
def scoped_tokens(css_path, cls):
    css = css_path.read_text()
    light = re.search(r':root, \[data-theme="light"\] \{\n(.*?)\n\}', css, re.S).group(1)
    dark = re.search(r'\n\[data-theme="dark"\] \{\n(.*?)\n\}', css, re.S).group(1)
    return f".{cls}.t-light, .{cls}.t-dark {{\n{light}\n}}\n.{cls}.t-dark {{\n{dark}\n}}\n"


type_css = "\n".join(l for l in (BASE / "tokens.css").read_text().splitlines() if l.startswith(".type-"))
TOKENS = (
    scoped_tokens(BASE / "tokens.css", "set-cur")
    + scoped_tokens(HERE / "tokens.proposal-r1.css", "set-r1")
    + scoped_tokens(HERE / "tokens.proposal.css", "set-r2")
    + type_css
)
BUNDLE = (ROOT / "packages/ui/src/styles/bundle.css").read_text()
OVERLAY_R1 = (HERE / "components.proposal-r1.css").read_text()
OVERLAY_R2 = (HERE / "components.proposal.css").read_text()

# What the owner sees today: the shell restyles some roles after the kit (apps/web/src/shell/styles.css).
CURRENT_SHELL = """
.bb-card__meta, .bb-list__support, .bb-nav-item, .bb-tab, .bb-slider__head, .bb-radio { color: var(--on-surface); }
.bb-card:not(.bb-card--filled), .bb-list, .bb-navbar, .bb-dialog, .bb-banner, .bb-avatar, .bb-progress, .bb-tag { --bc: var(--outline); }
"""

# ---------------------------------------------------------------- pixel art helpers
def pixel_svg(rows, colors, cls="bb-pixel", size=None):
    paths = {}
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                paths.setdefault(ch, []).append(f"M{x} {y}h1v1h-1z")
    w, h = len(rows[0]), len(rows)
    inner = "".join(f'<path style="fill:{colors[k]}" d="{"".join(v)}"/>' for k, v in paths.items())
    dim = f' width="{size}" height="{size}"' if size else ""
    return f'<svg class="{cls}" viewBox="0 0 {w} {h}"{dim} aria-hidden="true">{inner}</svg>'


def shadow_sprite(grid, colors, unit="var(--u)"):
    """CSS box-shadow sprite: one 1x1 element, every pixel is a hard shadow."""
    parts = []
    for y, row in enumerate(grid):
        for x, ch in enumerate(row):
            if ch != ".":
                parts.append(f"calc({unit}*{x}) calc({unit}*{y}) 0 {colors[ch]}")
    return ", ".join(parts)


def coin_grid():
    n, c, rows = 12, 5.5, []
    for y in range(n):
        r = ""
        for x in range(n):
            d = ((x - c) ** 2 + (y - c) ** 2) ** 0.5
            if d > 5.75:
                r += "."
            elif d > 4.65:
                r += "o"
            elif 5 <= x <= 6 and 3 <= y <= 8:
                r += "m"
            elif x + y <= 6:
                r += "h"
            elif x + y >= 16:
                r += "s"
            else:
                r += "y"
        rows.append(r)
    return rows


COIN = coin_grid()
COIN_COLORS = {"o": "var(--coin-o)", "y": "var(--coin-y)", "h": "var(--coin-h)", "s": "var(--coin-s)", "m": "var(--coin-s)"}
DIE = [
    "..oooooooo..",
    ".obbbbbbbbo.",
    "obbbbbbbbbbo",
    "obppbbbbppbo",
    "obppbbbbppbo",
    "obbbbppbbbbo",
    "obbbbppbbbbo",
    "obppbbbbppbo",
    "obppbbbbppbo",
    "obbbbbbbbbso",
    ".osssssssso.",
    "..oooooooo..",
]
DIE_COLORS = {"o": "var(--neutral-30)", "b": "var(--neutral-90)", "s": "var(--neutral-70)", "p": "var(--die-pip)"}
SPARK = [".#.", "###", ".#."]

AVATARS = [
    (["..hhhh..", ".hhhhhh.", ".hssssh.", ".sesses.", ".ssssss.", "..smms..", ".bbbbbb.", "bbbbbbbb"],
     {"h": "var(--brown-40)", "s": "var(--orange-80)", "e": "var(--neutral-10)", "m": "var(--red-50)", "b": "var(--teal-50)"}, "var(--teal-20)"),
    (["..hhhh..", ".hhhhhh.", "hhssssh.", "hsesses.", ".ssssss.", "..smms..", ".bbbbbb.", "bbbbbbbb"],
     {"h": "var(--amber-40)", "s": "var(--orange-90)", "e": "var(--neutral-10)", "m": "var(--red-60)", "b": "var(--violet-50)"}, "var(--violet-20)"),
    (["..hhhh..", ".hhhhhh.", ".hssssh.", ".sesses.", ".ssssss.", "..smms..", ".bbbbbb.", "bbbbbbbb"],
     {"h": "var(--neutral-20)", "s": "var(--orange-70)", "e": "var(--neutral-10)", "m": "var(--red-50)", "b": "var(--amber-50)"}, "var(--amber-20)"),
]


def avatar(i):
    rows, colors, bg = AVATARS[i]
    paths = {}
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != ".":
                paths.setdefault(ch, []).append(f"M{x} {y}h1v1h-1z")
    inner = "".join(f'<path style="fill:{colors[k]}" d="{"".join(v)}"/>' for k, v in paths.items())
    return f'<span class="bb-avatar" aria-hidden="true"><svg class="bb-pixel" viewBox="0 0 8 8" style="background:{bg}">{inner}</svg></span>'


# icons: 12x12 grids, same as apps/web/src/shell/icons.tsx
NAV = {
    "Home": ["............", ".....##.....", "....####....", "...######...", "..########..", ".##########.", ".##########.", ".####..####.", ".####..####.", ".####..####."],
    "Missions": ["............", ".##..#####..", ".##..#####..", "............", ".##..#####..", ".##..#####..", "............", ".##..#####..", ".##..#####.."],
    "Ranking": ["....####....", "....####....", ".####.##.###", ".####.##.###", ".####.##.###", ".####.##.###", ".####.##.###", ".####.##.###", ".####.##.###"],
    "Inbox": ["............", ".##########.", ".###....###.", ".##.####.##.", ".##..##..##.", ".##.#..#.##.", ".##########.", ".##########."],
    "Settings": ["............", ".##########.", "......##....", "............", ".##########.", ".........##.", "............", ".##########.", "...##......."],
}


def icon(rows):
    d = "".join(f"M{x} {y}h1v1h-1z" for y, r in enumerate(rows) for x, ch in enumerate(r) if ch == "#")
    return f'<svg class="bb-icon" viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="{d}"/></svg>'


CHECK = "M10 2h1v1h-1zM9 3h2v1h-2zM8 4h2v1h-2zM2 5h1v1h-1zM7 5h2v1h-2zM2 6h2v1h-2zM6 6h2v1h-2zM3 7h4v1h-4zM4 8h2v1h-2z"
CLOSE = "M2 1h2v1h-2zM8 1h2v1h-2zM3 2h2v1h-2zM7 2h2v1h-2zM4 3h4v1h-4zM5 4h2v1h-2zM4 5h4v1h-4zM3 6h2v1h-2zM7 6h2v1h-2zM2 7h2v1h-2zM8 7h2v1h-2z"
WARN = "M5 1h2v1h-2zM4 2h4v1h-4zM4 3h1v1h-1zM7 3h1v1h-1zM3 4h2v1h-2zM6 4h1v1h-1zM8 4h2v1h-2zM3 5h2v1h-2zM6 5h1v1h-1zM8 5h2v1h-2zM2 6h3v1h-3zM7 6h3v1h-3zM2 7h3v1h-3zM7 7h3v1h-3zM1 8h10v1h-10zM1 9h10v1h-10z"
INFO = "M3 1h6v1h-6zM2 2h8v1h-8zM1 3h4v1h-4zM7 3h4v1h-4zM1 4h10v1h-10zM1 5h4v1h-4zM7 5h4v1h-4zM1 6h4v1h-4zM7 6h4v1h-4zM1 7h4v1h-4zM7 7h4v1h-4zM2 8h8v1h-8zM3 9h6v1h-6z"


def path_icon(d, cls="bb-icon"):
    return f'<svg class="{cls}" viewBox="0 0 12 12" aria-hidden="true"><path fill="currentColor" d="{d}"/></svg>'



# ---------------------------------------------------------------- round 2 pixel art
import random

SPR = {
    "o": "var(--neutral-10)", "w": "var(--neutral-95)", "g": "var(--neutral-70)", "G": "var(--neutral-50)",
    "y": "var(--yellow-80)", "Y": "var(--yellow-60)", "h": "var(--yellow-95)",
    "r": "var(--red-60)", "R": "var(--red-40)", "b": "var(--sky-70)", "B": "var(--sky-50)",
    "n": "var(--green-60)", "N": "var(--green-40)", "k": "var(--brown-60)", "K": "var(--brown-30)",
    "e": "var(--neutral-10)", "p": "var(--orange-60)",
}


def auto_outline(rows, size=16):
    """Centre a mask on a size x size canvas and add a 1px outline ('o') around it."""
    h, w = len(rows), len(rows[0])
    assert all(len(r) == w for r in rows), rows
    ox, oy = (size - w) // 2, (size - h) // 2
    g = [["."] * size for _ in range(size)]
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c != ".":
                g[oy + y][ox + x] = c
    out = [r[:] for r in g]
    for y in range(size):
        for x in range(size):
            if g[y][x] == "." and any(0 <= y + dy < size and 0 <= x + dx < size and g[y + dy][x + dx] != "." for dy in (-1, 0, 1) for dx in (-1, 0, 1)):
                out[y][x] = "o"
    return ["".join(r) for r in out]


def canvas(n=14):
    return [["."] * n for _ in range(n)]


def to_rows(g):
    return ["".join(r) for r in g]


def icon_dice():
    g = [["w"] * 14 for _ in range(14)]
    for i in range(14):
        g[i][13] = "g"
        g[13][i] = "g"
    for x, y in ((0, 0), (13, 0), (0, 13), (13, 13)):
        g[y][x] = "."
    for px, py in ((2, 2), (10, 2), (6, 6), (2, 10), (10, 10)):
        for dx in (0, 1):
            for dy in (0, 1):
                g[py + dy][px + dx] = "B"
    return auto_outline(to_rows(g))


def icon_slots():
    return [
        ".oooooooooooooo.",
        "orrrrrrrrrrrrrro",
        "orryyrryyrryyrro",
        "orrrrrrrrrrrrrro",
        "oroooooooooooooo"[:14] + "ro",
        "orowwwwwwwwwworo",
        "orowRRwyywBBworo",
        "orowRRwyywBBworo",
        "orowRRwyywBBworo",
        "orowwwwwwwwwworo",
        "orooooooooooooro",
        "orrrrrrrrrrrrrro",
        "orrrrroooorrrrro",
        "orrrrrrrrrrrrrro",
        ".oooooooooooooo.",
        "................",
    ]


def icon_cards():
    g = canvas()
    for y in range(2, 14):
        for x in range(0, 9):
            g[y][x] = "B"
    for y in range(0, 12):
        for x in range(5, 14):
            g[y][x] = "w"
    for y in range(2, 12):
        g[y][4] = "o"
    for x in range(4, 9):
        g[12][x] = "o"
    for k, row in enumerate((".R.R.", "RRRRR", ".RRR.", "..R..")):
        for j, ch in enumerate(row):
            if ch != ".":
                g[3 + k][7 + j] = ch
    for y in (4, 6, 8, 10):
        for x in (1, 3):
            g[y][x] = "b"
    return auto_outline(to_rows(g))


def icon_roulette():
    n, c = 14, 6.5
    g = canvas(n)
    import math
    for y in range(n):
        for x in range(n):
            d = math.hypot(x - c, y - c)
            if d > 6.9:
                continue
            if d > 6.0:
                g[y][x] = "k"
            elif d > 4.2:
                ang = (math.degrees(math.atan2(y - c, x - c)) + 360) % 360
                g[y][x] = "r" if int(ang // 45) % 2 == 0 else "G"
            elif d > 2.4:
                g[y][x] = "Y"
            elif d > 1.0:
                g[y][x] = "y"
            else:
                g[y][x] = "h"
    g[3][10] = "w"
    return auto_outline(to_rows(g))


def icon_horse():
    rows = [
        "....kk........",
        "...kkkk.mmm...",
        "...kkkkmmmmm..",
        "..kkkkkkmmmmm.",
        "..kekkkkkmmmm.",
        ".kkkkkkkkkmmm.",
        ".kkkkkkkkkkmm.",
        "kkkkkkkkkkkm..",
        "kknkkkkkkkk...",
        "kkkkkkkkkk....",
        ".kkkkkkkkk....",
        "..kkkkkkk.....",
        "...kkkkkk.....",
        "....kkkk......",
    ]
    rows = [r.replace("m", "K").replace("n", "K").replace("e", "w") for r in rows]
    return auto_outline(rows)


def icon_chart():
    g = canvas()
    for x in range(14):
        g[13][x] = "g"
    for (x0, h, a, b) in ((1, 4, "b", "B"), (4, 6, "b", "B"), (7, 9, "n", "N"), (10, 12, "n", "N")):
        for y in range(13 - h, 13):
            g[y][x0] = a
            g[y][x0 + 1] = b
    for x, y in ((10, 0), (11, 0), (10, 1), (11, 1)):
        g[y][x] = "y"
    return auto_outline(to_rows(g))


def icon_pickaxe():
    g = canvas()
    for x in range(1, 10):
        g[13 - x][x] = "k"
    for x in range(2, 10):
        g[14 - x][x] = "K"
    for x in range(7, 14):
        if 0 <= x - 7 < 14:
            g[x - 7][x] = "w"
    for x in range(7, 14):
        if x - 6 < 14:
            g[x - 6][x] = "g"
    for y, x in ((1, 6), (2, 6), (3, 7), (7, 12), (8, 13)):
        pass
    return auto_outline(to_rows(g))


def icon_sword():
    g = canvas()
    for x in range(6, 13):
        g[13 - x][x] = "w"
    g[0][13] = "w"
    for x in range(7, 14):
        if 14 - x < 14:
            g[14 - x][x] = "g"
    for x in range(2, 8):
        g[x + 3][x] = "y"
        g[x + 4][x] = "Y"
    for x in range(2, 5):
        g[13 - x][x] = "k"
    g[12][1] = "y"
    g[13][0] = "y"
    return auto_outline(to_rows(g))


def icon_coin():
    n, c = 14, 6.5
    import math
    g = canvas(n)
    for y in range(n):
        for x in range(n):
            d = math.hypot(x - c, y - c)
            if d > 6.9:
                continue
            if 6 <= x <= 7 and 3 <= y <= 10:
                g[y][x] = "Y"
            elif d > 4.8 and x + y >= 15:
                g[y][x] = "Y"
            elif d > 4.8 and x + y <= 9:
                g[y][x] = "h"
            else:
                g[y][x] = "y"
    return auto_outline(to_rows(g))


GAMES = [("Dice", icon_dice), ("Slots", icon_slots), ("Cards", icon_cards), ("Roulette", icon_roulette), ("Horses", icon_horse),
         ("Stocks", icon_chart), ("Mining", icon_pickaxe), ("Arena", icon_sword), ("Pelica", icon_coin)]
GAME_SVG = {}
for _name, _fn in GAMES:
    _rows = _fn()
    assert len(_rows) == 16 and all(len(r) == 16 for r in _rows), (_name, [len(r) for r in _rows])
    GAME_SVG[_name] = pixel_svg(_rows, SPR)


def game_tile(name):
    return f'<button class="bb-card bb-game" type="button">{GAME_SVG[name]}<span>{name}</span></button>'


def scene_svg(w=96, h=14):
    rnd = random.Random(11)
    cells = {}

    def put(x, y, k):
        if 0 <= x < w and 0 <= y < h:
            cells[(x, y)] = k

    for _ in range(16):  # stars, upper sky only
        put(rnd.randrange(0, w), rnd.randrange(0, 5), "s")
    for sx in (14, 47, 71):  # three small sparkles
        sy = rnd.randrange(1, 4)
        for dx, dy in ((0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)):
            put(sx + dx, sy + dy, "s")
    for dx, dy in ((0, 0), (1, 0), (2, 0), (0, 1), (1, 1), (2, 1), (0, 2), (1, 2), (2, 2)):  # moon / sun
        put(84 + dx, 1 + dy, "m")
    x = 0
    while x < w:  # far skyline
        bw, bh = rnd.randrange(4, 8), rnd.randrange(4, 9)
        for xx in range(x, min(w, x + bw)):
            for yy in range(h - bh, h):
                put(xx, yy, "f")
        x += bw
    x = -2
    while x < w:  # near skyline with lit windows
        bw, bh = rnd.randrange(5, 10), rnd.randrange(3, 7)
        for xx in range(max(0, x), min(w, x + bw)):
            for yy in range(h - bh, h):
                put(xx, yy, "n")
        for xx in range(x + 1, x + bw - 1, 2):
            for yy in range(h - bh + 1, h - 1, 2):
                if rnd.random() < 0.55:
                    put(xx, yy, "v")
        if rnd.random() < 0.4:
            put(x + bw // 2, h - bh - 1, "n")
        x += bw + rnd.randrange(0, 2)
    paths = {}
    for (px, py), k in cells.items():
        paths.setdefault(k, []).append(f"M{px} {py}h1v1h-1z")
    inner = "".join(f'<path class="sc-{k}" d="{"".join(v)}"/>' for k, v in paths.items())
    return f'<svg viewBox="0 0 {w} {h}" aria-hidden="true">{inner}</svg>'


SCENE = scene_svg()

# ---------------------------------------------------------------- markup
def stage(setname, theme, label):
    nav = ""
    for n in NAV:
        cur = ' aria-current="page"' if n == "Home" else ""
        badge = '<span class="bb-badge">3</span>' if n == "Inbox" else ""
        nav += f'<button class="bb-nav-item" type="button"{cur}><span class="bb-nav-item__ind">{icon(NAV[n])}{badge}</span>{n}</button>'

    rich = setname == "r2"
    scene = f'<div class="hero__scene" aria-hidden="true">{SCENE}</div>' if rich else ""
    tiles = (
        '<section aria-label="Games"><p class="bb-eyebrow" style="margin-bottom:12px">Games</p><div class="tiles">'
        + "".join(game_tile(n) for n in ("Dice", "Slots", "Cards", "Horses"))
        + "</div></section>"
        if rich
        else ""
    )
    games_block = (
        '<div class="block"><p class="bb-eyebrow">Game icons (pixel art, 16 by 16)</p><div class="games">'
        + "".join(game_tile(n) for n, _ in GAMES)
        + "</div></div>"
        if rich
        else ""
    )

    return f"""
<section class="col set-{setname} t-{theme}" aria-label="{label}, {theme}">
  <h2 class="col__head"><span class="col__tag">{label}</span><span class="col__theme">{theme}</span></h2>
  <div class="phone" role="img" aria-label="App shell at 390 pixels wide">
    <header class="topbar">
      <span class="topbar__avatar">{avatar(0)}</span>
      <span class="type-title-medium topbar__title">Casino</span>
      <span class="topbar__balance"><span class="spr" style="--u:2px" aria-hidden="true"><span class="coin"></span></span>3,000</span>
    </header>
    <main class="screen">
      <section class="hero bb-card">
        {scene}
        <p class="bb-eyebrow">Your balance</p>
        <p class="hero__amount type-display-small"><span class="accent">3,000</span> <span class="hero__unit">Pelica</span></p>
        <div class="bb-progress-wrap hero__streak"><div class="bb-progress-wrap__head"><span>Daily streak</span><span>3 / 7</span></div><div class="bb-progress" role="progressbar" aria-valuenow="3" aria-valuemin="0" aria-valuemax="7" aria-label="Daily streak"><div class="bb-progress__fill" style="width:43%"></div></div></div>
        <div class="hero__actions"><button class="bb-btn" type="button">Claim bonus</button><button class="bb-btn bb-btn--text" type="button">History</button></div>
        <div class="hero__art" aria-hidden="true"><span class="spr spr--die" style="--u:3px"><span class="die"></span></span><span class="spr spr--coin bob" style="--u:4px"><span class="coin"></span></span><span class="spr spr--a tw" style="--u:3px"><span class="spark"></span></span><span class="spr spr--b tw" style="--u:3px"><span class="spark"></span></span></div>
      </section>
      {tiles}
      <article class="bb-card">
        <p class="bb-eyebrow">Slots</p>
        <h3 class="bb-card__title">Lucky Sprout</h3>
        <p class="bb-card__meta">Three reels, five lines. Bet from 10 Pelica.</p>
        <div class="bb-chips"><span class="bb-tag bb-tag--violet">Epic</span><span class="bb-tag bb-tag--yellow">Jackpot 12,400</span></div>
        <div class="bb-card__actions"><button class="bb-btn bb-btn--text" type="button">Rules</button><button class="bb-btn bb-btn--tonal" type="button">Play</button></div>
      </article>
    </main>
    <nav class="bb-navbar shell-nav" aria-label="Main">{nav}</nav>
  </div>

  <div class="sheet">
    {games_block}
    <div class="block"><p class="bb-eyebrow">Buttons</p>
      <div class="row"><button class="bb-btn" type="button">Filled</button><button class="bb-btn bb-btn--tonal" type="button">Tonal</button><button class="bb-btn bb-btn--outlined" type="button">Outlined</button><button class="bb-btn bb-btn--text" type="button">Text</button></div>
      <div class="row"><button class="bb-btn is-pressed" type="button">Pressed</button><button class="bb-btn bb-btn--tonal is-pressed" type="button">Pressed</button><button class="bb-btn bb-btn--outlined is-pressed" type="button">Pressed</button></div>
      <div class="row"><button class="bb-btn" type="button" disabled>Disabled</button><button class="bb-btn bb-btn--tonal" type="button" disabled>Disabled</button><button class="bb-btn bb-btn--outlined" type="button" disabled>Disabled</button><button class="bb-btn bb-btn--danger" type="button">Cash out</button></div>
    </div>

    <div class="block"><p class="bb-eyebrow">Chips and rarity tags</p>
      <div class="bb-chips" role="group" aria-label="Filter"><button class="bb-chip bb-state" type="button" aria-pressed="true">{path_icon(CHECK)} Slots</button><button class="bb-chip bb-state" type="button" aria-pressed="false">Cards</button><button class="bb-chip bb-state" type="button" aria-pressed="true">{path_icon(CHECK)} Dice</button><button class="bb-chip bb-state" type="button" aria-pressed="false">Horses</button></div>
      <div class="bb-chips"><span class="bb-tag">Common</span><span class="bb-tag bb-tag--green">Uncommon</span><span class="bb-tag bb-tag--blue">Rare</span><span class="bb-tag bb-tag--violet">Epic</span><span class="bb-tag bb-tag--yellow">Legendary</span></div>
      <div class="bb-chips"><span class="bb-tag bb-tag--green solid-off">{path_icon(CHECK, "bb-icon")} Won +250</span><span class="bb-tag bb-tag--orange">Low funds</span><span class="bb-tag bb-tag--red">Bust</span></div>
    </div>

    <div class="block"><p class="bb-eyebrow">Banners</p>
      <div class="bb-banner bb-banner--success" role="status">{path_icon(CHECK)}<div><strong>Saved</strong>Your balance is up to date.</div></div>
      <div class="bb-banner bb-banner--warning" role="status">{path_icon(WARN)}<div><strong>Low balance</strong>Add funds before the next round.</div></div>
      <div class="bb-banner bb-banner--error" role="alert">{path_icon(CLOSE)}<div><strong>Couldn't connect</strong>Check your internet, then try again.</div></div>
    </div>

    <div class="block"><p class="bb-eyebrow">List</p>
      <ul class="bb-list" aria-label="Table">
        <li class="bb-list__item bb-state">{avatar(0)}<div><span class="bb-list__headline">Mika</span><span class="bb-list__support">Joined table 4</span></div><span class="bb-list__trail">1,200</span></li>
        <li class="bb-list__item bb-state" aria-selected="true">{avatar(1)}<div><span class="bb-list__headline">Ren</span><span class="bb-list__support">Your seat</span></div><span class="bb-list__trail">3,000</span></li>
        <li class="bb-list__item bb-state">{avatar(2)}<div><span class="bb-list__headline">Sora</span><span class="bb-list__support">Waiting to bet</span></div><span class="bb-list__trail">640</span></li>
      </ul>
    </div>

    <div class="block"><p class="bb-eyebrow">Settings row</p>
      <div class="setting"><label class="bb-switch"><input type="checkbox" role="switch" checked><span>Sound effects</span><span class="bb-switch__state">On</span></label></div>
      <div class="setting"><label class="bb-switch"><input type="checkbox" role="switch"><span>Haptics</span><span class="bb-switch__state">Off</span></label></div>
      <div class="bb-slider" style="width:100%"><div class="bb-slider__head"><label for="vol-{setname}-{theme}">Volume</label><span>60%</span></div><input id="vol-{setname}-{theme}" type="range" min="0" max="100" value="60" style="--val:60%"></div>
    </div>

    <div class="block"><p class="bb-eyebrow">Dialog and snackbar</p>
      <div class="bb-scrim scrim-static"><div class="bb-dialog" role="alertdialog" aria-labelledby="dt-{setname}-{theme}">
        <div class="bb-dialog__icon">{path_icon(INFO)}</div>
        <h3 class="bb-dialog__title" id="dt-{setname}-{theme}">Cash out now?</h3>
        <p class="bb-dialog__body">You keep 3,000 Pelica. The current round ends and its bet is lost.</p>
        <div class="bb-dialog__actions"><button class="bb-btn bb-btn--text" type="button">Keep playing</button><button class="bb-btn" type="button">Cash out</button></div>
      </div></div>
      <div class="bb-snackbar" role="status" style="width:100%"><span class="bb-snackbar__text">Bet placed: 50 Pelica</span><button class="bb-btn bb-btn--text" type="button">Undo</button></div>
    </div>

    <div class="block"><p class="bb-eyebrow">Pixel art and palette</p>
      <div class="art"><span class="spr" style="--u:6px" aria-hidden="true"><span class="coin"></span></span><span class="spr" style="--u:5px" aria-hidden="true"><span class="die"></span></span><ul class="swatches" aria-label="Palette">
        <li style="background:var(--surface-container-lowest)" title="surface-container-lowest"></li><li style="background:var(--surface)" title="surface"></li><li style="background:var(--surface-container-low)" title="surface-container-low"></li><li style="background:var(--surface-container)" title="surface-container"></li><li style="background:var(--surface-container-high)" title="surface-container-high"></li><li style="background:var(--surface-container-highest)" title="surface-container-highest"></li>
        <li style="background:var(--primary)" title="primary"></li><li style="background:var(--primary-container)" title="primary-container"></li><li style="background:var(--secondary-container)" title="secondary-container"></li><li style="background:var(--accent)" title="accent"></li><li style="background:var(--outline)" title="outline"></li><li style="background:var(--outline-variant)" title="outline-variant"></li></ul></div>
    </div>
  </div>
</section>"""


PAGE_CSS = """
*,*::before,*::after{box-sizing:border-box}
html{background:#17191c;color:#e9eaec;font:400 16px/24px "Atkinson Hyperlegible",system-ui,-apple-system,"Segoe UI",sans-serif}
body{margin:0}
.page{max-width:1400px;margin:0 auto;padding:24px 16px 64px}
.intro h1{font:600 28px/36px "Pixelify Sans",system-ui,sans-serif;margin:0 0 8px}
.intro p{margin:0 0 12px;max-width:62ch;color:#c9ccd1}
.switcher{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0 24px}
.switcher a{min-height:48px;display:inline-flex;align-items:center;padding:0 16px;color:#e9eaec;text-decoration:none;font-weight:700;background:#2a2d32;box-shadow:0 -2px 0 #6b7078,0 2px 0 #6b7078,-2px 0 0 #6b7078,2px 0 0 #6b7078;margin:2px}
.switcher a:focus-visible{outline:3px solid #f3c06a;outline-offset:4px}
html[data-show=all] a[href="#all"],html[data-show=dark] a[href="#dark"],html[data-show=light] a[href="#light"]{background:#3b4a58}
.pair{display:grid;grid-template-columns:repeat(3,minmax(0,422px));gap:24px;justify-content:center;margin-bottom:40px}
html[data-show=dark] .pair--light,html[data-show=light] .pair--dark{display:none}
.col{background:var(--surface-container-lowest);color:var(--on-surface);font:400 16px/24px var(--font-body);padding:16px 16px 24px;display:grid;gap:24px;align-content:start;min-width:0}
.col__head{margin:0;display:flex;gap:12px;align-items:baseline;font:600 20px/28px var(--font-display)}
.col__tag{color:var(--on-surface)}
.col__theme{font:700 14px/20px var(--font-body);letter-spacing:.08em;text-transform:uppercase;color:var(--on-surface-variant)}
.set-cur{--accent:var(--secondary)}
.set-r1,.set-r2{--accent:var(--tertiary)}
.set-cur,.set-r1{--coin-o:var(--amber-30);--coin-y:var(--amber-70);--coin-h:var(--amber-90);--coin-s:var(--amber-50);--die-pip:var(--teal-30)}
.set-r2{--coin-o:var(--yellow-30);--coin-y:var(--yellow-80);--coin-h:var(--yellow-95);--coin-s:var(--yellow-60);--die-pip:var(--blue-40)}
.set-r2.t-dark{--scene-sky:var(--neutral-16);--scene-far:var(--neutral-10);--scene-near:var(--neutral-7);--scene-win:var(--yellow-80);--scene-star:var(--yellow-90);--scene-moon:var(--yellow-90)}
.set-r2.t-light{--scene-sky:var(--sky-90);--scene-far:var(--sky-80);--scene-near:var(--sky-60);--scene-win:var(--yellow-90);--scene-star:var(--paper-99);--scene-moon:var(--yellow-80)}
.accent{color:var(--accent)}
.phone{width:390px;max-width:100%;min-height:760px;margin:0 auto;display:grid;grid-template-rows:auto 1fr auto;background:var(--surface);overflow:hidden;position:relative;box-shadow:0 0 0 4px var(--surface-container-highest)}
.topbar{display:flex;align-items:center;gap:12px;min-height:56px;padding:4px 16px;background:var(--surface-container)}
.topbar__avatar .bb-avatar{margin:0}
.topbar__balance{margin-left:auto;display:inline-flex;gap:8px;align-items:center;font-weight:700;font-variant-numeric:tabular-nums}
.screen{display:grid;gap:16px;align-content:start;padding:16px}
.phone .bb-card{width:100%;max-width:none;margin:0}
.phone .bb-navbar{margin:0;width:100%;max-width:none;padding-bottom:16px}
.hero{position:relative;padding:24px 16px;gap:12px;overflow:hidden}
.hero p{margin:0}
.hero__amount{display:flex;align-items:baseline;gap:8px}
.hero__unit{font:700 16px/24px var(--font-body);color:var(--on-surface-variant)}
.hero__streak{width:100%}
.hero__actions{display:flex;gap:8px;flex-wrap:wrap;position:relative;z-index:1}
.hero__art{position:absolute;right:16px;top:20px;width:96px;height:64px}
.spr{display:inline-block;position:relative;flex:none;width:calc(var(--u)*12);height:calc(var(--u)*12)}
.coin,.die,.spark{display:block;position:absolute;left:0;top:0;width:var(--u);height:var(--u)}
.hero__art .spr{position:absolute}
.spr--coin{right:0;top:0}
.spr--die{left:0;top:26px}
.spr--a{right:60px;top:0;width:calc(var(--u)*3);height:calc(var(--u)*3)}
.spr--b{right:4px;top:54px;width:calc(var(--u)*3);height:calc(var(--u)*3)}
.bob{animation:bob 1.2s steps(2) infinite}
.tw{animation:twinkle 1.6s steps(2) infinite}
.spr--b{animation-delay:.8s}
@keyframes bob{50%{transform:translateY(-4px)}}
@keyframes twinkle{0%{opacity:1}50%{opacity:.25}}
.sheet{display:grid;gap:24px}
.block{display:grid;gap:12px;align-content:start}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.sheet .bb-list,.sheet .bb-banner,.sheet .bb-snackbar,.sheet .bb-dialog{width:calc(100% - 4px)}
.setting{min-height:48px;display:flex;align-items:center}
.scrim-static{padding:24px 16px;background:var(--scrim)}
.scrim-static .bb-dialog{margin:0}
.art{display:flex;gap:24px;align-items:center;flex-wrap:wrap}
.swatches{display:grid;grid-template-columns:repeat(6,32px);gap:8px;list-style:none;margin:0;padding:0}
.swatches li{width:32px;height:32px;box-shadow:0 0 0 2px var(--outline-variant)}
.bb-btn.is-pressed{transform:translateY(2px);box-shadow:var(--pb),inset 0 -2px 0 0 var(--pixel-lip)}
.bb-btn--outlined.is-pressed{box-shadow:var(--pb);background:color-mix(in srgb,currentColor 12%,transparent)}
.bb-slider input{width:100%}
@media (max-width:1360px){.pair{grid-template-columns:repeat(2,minmax(0,422px))}}
@media (max-width:900px){.pair{grid-template-columns:minmax(0,422px)}}
@media (max-width:430px){.page{padding:16px 0 48px}.intro,.switcher{padding:0 16px}.col{padding:16px 0 24px}.col__head,.sheet{padding:0 16px}.pair{gap:16px}.phone{width:100%}}
@media (prefers-reduced-motion:reduce){.bob,.tw{animation:none}}
.bb-card__meta,.bb-list__support,.bb-nav-item{font-size:16px;line-height:24px}
.set-r1 .screen,.set-r2 .screen{gap:24px}
.set-r2 .hero{padding:0 16px 24px}
.set-r2 .hero__art{top:76px}
.hero__scene{display:flex;justify-content:center;height:56px;margin:0 -16px;overflow:hidden;background:var(--scene-sky)}
.hero__scene svg{flex:none;width:384px;height:56px;display:block;shape-rendering:crispEdges}
.sc-s{fill:var(--scene-star)}.sc-f{fill:var(--scene-far)}.sc-n{fill:var(--scene-near)}.sc-v{fill:var(--scene-win)}.sc-m{fill:var(--scene-moon)}
.set-r2.t-light .hero__amount .accent{background:var(--tertiary-container);color:var(--on-tertiary-container);padding:0 8px;box-shadow:0 -2px 0 0 var(--yellow-70),0 2px 0 0 var(--yellow-70),-2px 0 0 0 var(--yellow-70),2px 0 0 0 var(--yellow-70)}
.tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.games{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.bb-card.bb-game{padding:12px 4px;width:100%;gap:4px;justify-items:center;text-align:center;font:700 16px/24px var(--font-body);color:var(--on-surface);margin:0}
.bb-game svg{width:48px;height:48px;image-rendering:pixelated;shape-rendering:crispEdges}
html[data-show^=home] .intro,html[data-show^=home] .switcher,html[data-show^=home] .col__head,html[data-show^=home] .sheet,html[data-show^=home] .col:not(.set-r2){display:none}
html[data-show=home-dark] .pair.pair--light,html[data-show=home-light] .pair.pair--dark{display:none}
html[data-show^=home] .page{padding:0;max-width:none}
html[data-show^=home] .pair{margin:0;display:block}
html[data-show^=home] .col{padding:0;background:transparent}
.bb-eyebrow{margin:0;font:700 14px/20px var(--font-body);letter-spacing:.08em;text-transform:uppercase;color:var(--on-surface-variant)}
"""

SPRITE_CSS = f"""
.coin{{box-shadow:{shadow_sprite(COIN, COIN_COLORS)};background:transparent}}
.die{{box-shadow:{shadow_sprite(DIE, DIE_COLORS)};background:transparent}}
.spark{{box-shadow:{shadow_sprite(SPARK, {"#": "var(--accent)"})}}}
"""

SCRIPT = """
(function(){
  function apply(){var h=(location.hash||'#all').slice(1);if(['dark','light','home-dark','home-light'].indexOf(h)<0)h='all';document.documentElement.setAttribute('data-show',h);}
  window.addEventListener('hashchange',apply);apply();
})();
"""

INTRO = """
<div class="page">
  <div class="intro">
    <h1>Bitbloom theme re-tune: preview</h1>
    <p>Three columns: the tokens in the app today, round 1 (calm, teal and gold on grey ink), and round 2 (navy base with fresh green, sunny yellow and sky blue, more pixel art). Same components and pixel structure (square 2px notched edges, hard offset shadows, stepped motion). Nothing here is wired into the app.</p>
    <p>Round 2: surfaces are navy tonal steps, green means act and succeed, yellow means Pelica and rewards, blue means info and selection. Fills are soft tints; the bright hues are kept for small accents and pixel art. Text and meaningful borders keep their contrast.</p>
  </div>
  <nav class="switcher" aria-label="Theme filter"><a href="#all">Both themes</a><a href="#dark">Dark only</a><a href="#light">Light only</a></nav>
  <div class="pair pair--dark">%DARK%</div>
  <div class="pair pair--light">%LIGHT%</div>
</div>
"""

html = f"""<!doctype html>
<html lang="en" data-show="all">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bitbloom theme re-tune preview</title>
<style>
{FONTS}
{TOKENS}
{BUNDLE}
.set-cur {{
{CURRENT_SHELL}
}}
.set-r1 {{
{OVERLAY_R1}
}}
.set-r2 {{
{OVERLAY_R2}
}}
{SPRITE_CSS}
{PAGE_CSS}
</style>
</head>
<body>
{INTRO.replace("%DARK%", stage("cur", "dark", "Current") + stage("r1", "dark", "Round 1") + stage("r2", "dark", "Round 2")).replace("%LIGHT%", stage("cur", "light", "Current") + stage("r1", "light", "Round 1") + stage("r2", "light", "Round 2"))}
<script>{SCRIPT}</script>
</body>
</html>
"""
(HERE / "preview.html").write_text(html)
print(f"wrote preview.html ({len(html) // 1024} KB)")
