#!/usr/bin/env python3
"""Builds tokens.proposal.json (same schema as ../tokens.json) and tokens.proposal.css.

Method: tones keep their CIE lightness (L*), so the contrast between any two tones is unchanged by
recolouring (luminance depends on L* only). The proposal therefore changes chroma and hue, plus
which tone each role points at, and never the lightness maths that the contrast rules rely on.

    python3 design/bitbloom/proposal/build_tokens.py
"""
import json
import math
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = HERE.parent
src = json.loads((BASE / "tokens.json").read_text())

# ---------- colour maths (sRGB <-> CIE L*a*b*, D65) ----------
WHITE = (0.95047, 1.0, 1.08883)


def to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def to_srgb(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def hex_to_lab(h):
    r, g, b = (to_lin(int(h[i : i + 2], 16) / 255) for i in (1, 3, 5))
    x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b

    def f(t):
        return t ** (1 / 3) if t > 216 / 24389 else (24389 / 27 * t + 16) / 116

    fx, fy, fz = f(x / WHITE[0]), f(y), f(z / WHITE[2])
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def lab_to_rgb(L, a, b):
    fy = (L + 16) / 116
    fx, fz = fy + a / 500, fy - b / 200

    def inv(t):
        return t ** 3 if t ** 3 > 216 / 24389 else (116 * t - 16) / (24389 / 27)

    x, y, z = inv(fx) * WHITE[0], (inv(fy) if L > 8 else L / (24389 / 27)), inv(fz) * WHITE[2]
    r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
    g = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z
    bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z
    return r, g, bl


def lch_to_hex(L, C, h):
    """Reduce chroma at constant lightness until the colour fits sRGB."""
    lo, hi = 0.0, C
    ok = lambda c: all(-0.0005 <= v <= 1.0005 for v in lab_to_rgb(L, c * math.cos(math.radians(h)), c * math.sin(math.radians(h))))
    if not ok(hi):
        for _ in range(40):
            mid = (lo + hi) / 2
            if ok(mid):
                lo = mid
            else:
                hi = mid
        hi = lo
    a, b = hi * math.cos(math.radians(h)), hi * math.sin(math.radians(h))
    rgb = [min(1, max(0, v)) for v in lab_to_rgb(L, a, b)]
    return "#" + "".join(f"{round(to_srgb(v) * 255):02x}" for v in rgb)


# ---------- palette ----------
HUES = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "magenta", "pink", "brown"]
HUE_TONES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99]

# Chroma kept per hue. Rarity hues sit lowest; primary/accent/semantic stay a little livelier.
KEEP = {
    "teal": 0.72, "amber": 0.80, "red": 0.78, "green": 0.68, "orange": 0.85, "indigo": 0.90,
    "yellow": 0.64, "blue": 0.62, "violet": 0.62,
}
KEEP_DEFAULT = 0.60
# Ceiling on chroma by tone. The pale tones (90, 95) are where the old palette was loudest
# (neon mint, neon peach); they now stay close to the surface family.
CAP = {10: 10, 20: 16, 30: 24, 40: 34, 50: 40, 60: 44, 70: 46, 80: 40, 90: 14, 95: 8, 99: 3}

# The focus ring is functional, so its two source tones keep more chroma than the rest of their hue.
RING_CAP = {"indigo-40": 62, "amber-80": 46}

# New neutral families (chroma is CIE a*b* chroma, tiny on purpose).
# name: (hue angle, chroma)
NEUTRALS = {
    "neutral": (255, 3.4),            # ink: cool, slightly blue grey for the dark theme
    "neutral-variant": (255, 7.5),    # ink, more chroma: outlines, quiet secondary
    "paper": (80, 3.2),               # warm cream for the light theme
    "paper-variant": (78, 8.0),       # warm tan: outlines, quiet secondary
}
NEUTRAL_TONES = [0, 4, 6, 8, 10, 11, 12, 14, 15, 17, 20, 21, 22, 24, 25, 30, 35, 40, 50, 60, 70, 78, 80, 87, 90, 92, 94, 95, 96, 97, 98, 99, 100]

old = {t["name"]: t for t in src["color"]["tokens"]}
palette = {}  # name -> hex
usage = {}

for hue in HUES:
    for tone in HUE_TONES:
        name = f"{hue}-{tone}"
        L, a, b = hex_to_lab(old[name]["value"])
        C, h = math.hypot(a, b), math.degrees(math.atan2(b, a))
        cap = RING_CAP.get(name, CAP[tone])
        palette[name] = lch_to_hex(L, min(C * KEEP.get(hue, KEEP_DEFAULT), cap), h)
        usage[name] = f"Tone {tone} of the {hue} palette, chroma reduced to sit with the calmer surfaces."

for fam, (hue, chroma) in NEUTRALS.items():
    for tone in NEUTRAL_TONES:
        name = f"{fam}-{tone}"
        c = 0 if tone in (0, 100) else chroma
        palette[name] = lch_to_hex(float(tone), c, hue)
        usage[name] = f"Tone {tone} of the {fam} palette."

# ---------- roles: (light, dark) ----------
R = {}


def role(name, light, dark, text):
    R[name] = (light, dark, text)


role("primary", "teal-40", "teal-70", "Main actions, selection, active indicators. The one primary colour.")
role("on-primary", "paper-99", "teal-10", "Text and icons on primary.")
role("primary-container", "teal-90", "teal-30", "Tinted fill for primary chips, banners, selected items and the active nav indicator.")
role("on-primary-container", "teal-10", "teal-90", "Text and icons on primary-container.")
# Secondary is now a quiet, low-chroma support colour (tonal buttons, track fills, selected rows).
role("secondary", "paper-variant-35", "neutral-variant-80", "Quiet support colour: tonal buttons, unfilled slider track, selected rows. Low chroma on purpose.")
role("on-secondary", "paper-99", "neutral-variant-20", "Text and icons on secondary.")
role("secondary-container", "paper-variant-90", "neutral-variant-25", "Quiet fill for tonal buttons, slider track and selected rows.")
role("on-secondary-container", "paper-variant-10", "neutral-variant-90", "Text and icons on secondary-container.")
# Tertiary is the single accent: coin gold. Balance, rewards, legendary moments.
role("tertiary", "amber-40", "amber-70", "The one accent: coin gold. Balance, rewards, highlights. Use sparingly.")
role("on-tertiary", "paper-99", "amber-10", "Text and icons on tertiary.")
role("tertiary-container", "amber-90", "amber-30", "Gold-tinted fill for reward chips and highlights.")
role("on-tertiary-container", "amber-10", "amber-90", "Text and icons on tertiary-container.")
role("error", "red-40", "red-80", "Errors and destructive actions.")
role("on-error", "paper-99", "red-20", "Text and icons on error.")
role("error-container", "red-90", "red-30", "Tinted fill for error chips and banners.")
role("on-error-container", "red-10", "red-90", "Text and icons on error-container.")
role("success", "green-40", "green-80", "Completed, saved, correct.")
role("on-success", "paper-99", "green-20", "Text and icons on success.")
role("success-container", "green-90", "green-30", "Tinted fill for success chips and banners.")
role("on-success-container", "green-10", "green-90", "Text and icons on success-container.")
role("warning", "orange-40", "orange-80", "Needs attention soon. Orange now, so it is not mistaken for the gold accent.")
role("on-warning", "paper-99", "orange-20", "Text and icons on warning.")
role("warning-container", "orange-90", "orange-30", "Tinted fill for warning chips and banners.")
role("on-warning-container", "orange-10", "orange-90", "Text and icons on warning-container.")
role("surface", "paper-96", "neutral-11", "Page background. Warm cream in light, deep ink in dark.")
role("surface-container-lowest", "paper-99", "neutral-8", "Lowest layer.")
role("surface-container-low", "paper-94", "neutral-14", "Default card and list fill.")
role("surface-container", "paper-92", "neutral-17", "Top bar, bottom nav, grouped areas.")
role("surface-container-high", "paper-90", "neutral-21", "Dialogs, menus.")
role("surface-container-highest", "paper-87", "neutral-25", "Fields, switch track, chips at rest.")
role("on-surface", "paper-15", "neutral-90", "Body text. Never dimmed.")
role("on-surface-variant", "paper-variant-35", "neutral-variant-80", "Supporting text. At least 4.5:1 on every surface.")
role("outline", "paper-variant-50", "neutral-variant-60", "Borders that carry meaning: fields, buttons, switches, sliders. At least 3:1 on every surface.")
role("outline-variant", "paper-variant-80", "neutral-variant-30", "Decorative tonal edge: cards, lists, nav, dividers. A soft step, not a line. Never the only cue for a control.")
role("inverse-surface", "paper-20", "neutral-30", "Snackbar fill. In dark it is a lifted slate, not a bright slab.")
role("inverse-on-surface", "paper-95", "neutral-92", "Text on inverse-surface.")
role("inverse-primary", "teal-80", "teal-80", "Action text on inverse-surface.")
role("disabled-container", "paper-90", "neutral-20", "Fill of disabled controls.")
role("on-disabled", "paper-variant-40", "neutral-variant-70", "Text on disabled controls.")
role("focus-ring", "indigo-40", "amber-80", "Keyboard focus outline, always 3px. Unchanged in purpose and still 3:1 or better.")
role("pixel-shadow", "paper-variant-80", "neutral-4", "Hard shadow colour for elevation.")

# Hue roles (rarity, categories, charts): same mapping as before, over the desaturated palette.
for hue in HUES:
    R[f"{hue}-accent"] = (f"{hue}-40", f"{hue}-80", f"{hue.capitalize()} for icons, text and strokes on surfaces.")
    R[f"{hue}-container"] = (f"{hue}-90", f"{hue}-30", f"{hue.capitalize()} fill for tags and chips.")
    R[f"on-{hue}-container"] = (f"{hue}-10", f"{hue}-90", f"Text on {hue}-container.")

tokens = []
tokens_by_name = {}


def add(name, value, use):
    tokens.append({"name": name, "value": value, "usage": use})


# Keep the original token order: roles, scrim/lip, palettes.
for name, (light, dark, text) in R.items():
    add(name, {"light": "{" + light + "}", "dark": "{" + dark + "}"}, text)
add("scrim", "#10131a80", "Dims the page behind a dialog.")
add("pixel-lip", "#00000026", "Darker bottom lip inside filled buttons and FABs; softer than before.")
for hue in HUES:
    for tone in HUE_TONES:
        add(f"{hue}-{tone}", palette[f"{hue}-{tone}"], usage[f"{hue}-{tone}"])
for fam in NEUTRALS:
    for tone in NEUTRAL_TONES:
        add(f"{fam}-{tone}", palette[f"{fam}-{tone}"], usage[f"{fam}-{tone}"])

out = json.loads(json.dumps(src))  # deep copy keeps type/spacing/radius/opacity identical
out["name"] = "Bitbloom (proposal)"
out["color"]["tokens"] = tokens
for tok in out["shadow"]["tokens"]:
    if isinstance(tok["value"], dict):
        px = tok["value"]["dark"].split(" ")[0]
        tok["value"] = {
            "light": f"{px} {px} 0 0 {palette['paper-variant-80']}",
            "dark": f"{px} {px} 0 0 {palette['neutral-4']}",
        }
(HERE / "tokens.proposal.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
subprocess.run([sys.executable, str(BASE / "gen_tokens.py"), str(HERE / "tokens.proposal.json"), str(HERE / "tokens.proposal.css")], check=True)
print(f"wrote {len(tokens)} colour tokens")
