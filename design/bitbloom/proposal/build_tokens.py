#!/usr/bin/env python3
"""Builds the proposed token sets (same schema as ../tokens.json) and their generated CSS.

    python3 design/bitbloom/proposal/build_tokens.py          # builds both rounds
    python3 design/bitbloom/proposal/build_tokens.py 2        # round 2 only

Round 1 (calm: sea teal + coin gold on grey ink)         -> tokens.proposal-r1.json / .css
Round 2 (navy base: fresh green, sunny yellow, sky blue)  -> tokens.proposal.json / .css

Method: tones keep their CIE lightness (L*), so the contrast between any two tones is unchanged by
recolouring (luminance depends on L* only). A round therefore changes chroma and hue, plus which
tone each role points at, and never the lightness maths that the contrast rules rely on.
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


HUES = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "magenta", "pink", "brown"]
HUE_TONES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99]

# ---------- round configuration ----------
ROUND1 = {
    "name": "Bitbloom (proposal)",
    "out": "tokens.proposal-r1",
    # Chroma kept per hue. Rarity hues sit lowest; primary/accent/semantic stay a little livelier.
    "keep": {"teal": 0.72, "amber": 0.80, "red": 0.78, "green": 0.68, "orange": 0.85, "indigo": 0.90, "yellow": 0.64, "blue": 0.62, "violet": 0.62},
    "keep_default": 0.60,
    # Ceiling on chroma by tone. The pale tones (90, 95) were the loudest in the old palette.
    "cap": {10: 10, 20: 16, 30: 24, 40: 34, 50: 40, 60: 44, 70: 46, 80: 40, 90: 14, 95: 8, 99: 3},
    # The focus ring is functional, so its two source tones keep more chroma than the rest of their hue.
    "ring_cap": {"indigo-40": 62, "amber-80": 46},
    # name: (hue angle, chroma, taper). Taper = how much chroma the lightest tones lose (0 = none).
    "neutrals": {"neutral": (255, 3.4, 0), "neutral-variant": (255, 7.5, 0), "paper": (80, 3.2, 0), "paper-variant": (78, 8.0, 0)},
    "neutral_tones": [0, 4, 6, 8, 10, 11, 12, 14, 15, 17, 20, 21, 22, 24, 25, 30, 35, 40, 50, 60, 70, 78, 80, 87, 90, 92, 94, 95, 96, 97, 98, 99, 100],
    "scrim": "#10131a80",
    "lip": "#00000026",
    "shadow": ("paper-variant-80", "neutral-4"),
    "roles": [
        # name, light, dark, usage
        ("primary", "teal-40", "teal-70", "Main actions, selection, active indicators. The one primary colour."),
        ("on-primary", "paper-99", "teal-10", "Text and icons on primary."),
        ("primary-container", "teal-90", "teal-30", "Tinted fill for primary chips, banners, selected items and the active nav indicator."),
        ("on-primary-container", "teal-10", "teal-90", "Text and icons on primary-container."),
        ("secondary", "paper-variant-35", "neutral-variant-80", "Quiet support colour: tonal buttons, unfilled slider track, selected rows. Low chroma on purpose."),
        ("on-secondary", "paper-99", "neutral-variant-20", "Text and icons on secondary."),
        ("secondary-container", "paper-variant-90", "neutral-variant-25", "Quiet fill for tonal buttons, slider track and selected rows."),
        ("on-secondary-container", "paper-variant-10", "neutral-variant-90", "Text and icons on secondary-container."),
        ("tertiary", "amber-40", "amber-70", "The one accent: coin gold. Balance, rewards, highlights. Use sparingly."),
        ("on-tertiary", "paper-99", "amber-10", "Text and icons on tertiary."),
        ("tertiary-container", "amber-90", "amber-30", "Gold-tinted fill for reward chips and highlights."),
        ("on-tertiary-container", "amber-10", "amber-90", "Text and icons on tertiary-container."),
        ("error", "red-40", "red-80", "Errors and destructive actions."),
        ("on-error", "paper-99", "red-20", "Text and icons on error."),
        ("error-container", "red-90", "red-30", "Tinted fill for error chips and banners."),
        ("on-error-container", "red-10", "red-90", "Text and icons on error-container."),
        ("success", "green-40", "green-80", "Completed, saved, correct."),
        ("on-success", "paper-99", "green-20", "Text and icons on success."),
        ("success-container", "green-90", "green-30", "Tinted fill for success chips and banners."),
        ("on-success-container", "green-10", "green-90", "Text and icons on success-container."),
        ("warning", "orange-40", "orange-80", "Needs attention soon. Orange now, so it is not mistaken for the gold accent."),
        ("on-warning", "paper-99", "orange-20", "Text and icons on warning."),
        ("warning-container", "orange-90", "orange-30", "Tinted fill for warning chips and banners."),
        ("on-warning-container", "orange-10", "orange-90", "Text and icons on warning-container."),
        ("surface", "paper-96", "neutral-11", "Page background. Warm cream in light, deep ink in dark."),
        ("surface-container-lowest", "paper-99", "neutral-8", "Lowest layer."),
        ("surface-container-low", "paper-94", "neutral-14", "Default card and list fill."),
        ("surface-container", "paper-92", "neutral-17", "Top bar, bottom nav, grouped areas."),
        ("surface-container-high", "paper-90", "neutral-21", "Dialogs, menus."),
        ("surface-container-highest", "paper-87", "neutral-25", "Fields, switch track, chips at rest."),
        ("on-surface", "paper-15", "neutral-90", "Body text. Never dimmed."),
        ("on-surface-variant", "paper-variant-35", "neutral-variant-80", "Supporting text. At least 4.5:1 on every surface."),
        ("outline", "paper-variant-50", "neutral-variant-60", "Borders that carry meaning: fields, buttons, switches, sliders. At least 3:1 on every surface."),
        ("outline-variant", "paper-variant-80", "neutral-variant-30", "Decorative tonal edge: cards, lists, nav, dividers. A soft step, not a line. Never the only cue for a control."),
        ("inverse-surface", "paper-20", "neutral-30", "Snackbar fill. In dark it is a lifted slate, not a bright slab."),
        ("inverse-on-surface", "paper-95", "neutral-92", "Text on inverse-surface."),
        ("inverse-primary", "teal-80", "teal-80", "Action text on inverse-surface."),
        ("disabled-container", "paper-90", "neutral-20", "Fill of disabled controls."),
        ("on-disabled", "paper-variant-40", "neutral-variant-70", "Text on disabled controls."),
        ("focus-ring", "indigo-40", "amber-80", "Keyboard focus outline, always 3px. Unchanged in purpose and still 3:1 or better."),
        ("pixel-shadow", "paper-variant-80", "neutral-4", "Hard shadow colour for elevation."),
    ],
}

ROUND2 = {
    "name": "Bitbloom (proposal, round 2)",
    "out": "tokens.proposal",
    # Brighter and friendlier: green, yellow and sky keep almost all their chroma at the mid tones.
    "keep": {"green": 0.98, "yellow": 0.95, "sky": 0.95, "indigo": 0.95, "blue": 0.80, "red": 0.85, "orange": 0.85, "amber": 0.85, "violet": 0.75, "teal": 0.80, "emerald": 0.80, "lime": 0.80},
    "keep_default": 0.70,
    # Saturated only in the mid tones (small accents, pixel art). Pale tones for fills stay soft.
    "cap": {10: 12, 20: 20, 30: 32, 40: 50, 50: 58, 60: 64, 70: 66, 80: 60, 90: 22, 95: 11, 99: 4},
    "ring_cap": {"indigo-40": 70, "yellow-80": 70},
    "neutrals": {"neutral": (278, 12.0, 0.75), "neutral-variant": (275, 18.0, 0.75), "paper": (88, 6.0, 0), "paper-variant": (85, 11.0, 0)},
    "neutral_tones": [0, 4, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 20, 21, 22, 24, 25, 30, 35, 40, 50, 60, 65, 70, 78, 80, 87, 90, 92, 94, 95, 96, 97, 98, 99, 100],
    "scrim": "#070b1f99",
    "lip": "#0000002b",
    "shadow": ("paper-variant-80", "neutral-4"),
    "roles": [
        ("primary", "green-40", "green-70", "Main actions and success. Fresh green, the one primary colour."),
        ("on-primary", "paper-99", "green-10", "Text and icons on primary."),
        ("primary-container", "green-90", "green-30", "Soft green fill for primary chips, banners and progress surroundings."),
        ("on-primary-container", "green-10", "green-90", "Text and icons on primary-container."),
        ("secondary", "sky-40", "sky-70", "Sky blue: info, links, selection."),
        ("on-secondary", "paper-99", "sky-10", "Text and icons on secondary."),
        ("secondary-container", "sky-90", "sky-30", "Soft sky fill for tonal buttons, selected chips, rows and nav, slider track."),
        ("on-secondary-container", "sky-10", "sky-90", "Text and icons on secondary-container."),
        ("tertiary", "yellow-40", "yellow-80", "Sunny yellow: Pelica, rewards, highlights, the coin."),
        ("on-tertiary", "paper-99", "yellow-10", "Text and icons on tertiary."),
        ("tertiary-container", "yellow-90", "yellow-30", "Butter fill for reward chips and the balance plate."),
        ("on-tertiary-container", "yellow-10", "yellow-90", "Text and icons on tertiary-container."),
        ("error", "red-40", "red-70", "Errors and destructive actions."),
        ("on-error", "paper-99", "red-10", "Text and icons on error."),
        ("error-container", "red-90", "red-30", "Tinted fill for error chips and banners."),
        ("on-error-container", "red-10", "red-90", "Text and icons on error-container."),
        ("success", "green-40", "green-80", "Completed, saved, correct. Same green family as primary."),
        ("on-success", "paper-99", "green-10", "Text and icons on success."),
        ("success-container", "green-90", "green-30", "Tinted fill for success chips and banners."),
        ("on-success-container", "green-10", "green-90", "Text and icons on success-container."),
        ("warning", "orange-40", "orange-80", "Needs attention soon. Orange, so it is not mistaken for the yellow accent."),
        ("on-warning", "paper-99", "orange-10", "Text and icons on warning."),
        ("warning-container", "orange-90", "orange-30", "Tinted fill for warning chips and banners."),
        ("on-warning-container", "orange-10", "orange-90", "Text and icons on warning-container."),
        ("surface", "paper-96", "neutral-10", "Page background. Warm paper in light, deep navy in dark."),
        ("surface-container-lowest", "paper-99", "neutral-7", "Lowest layer."),
        ("surface-container-low", "paper-94", "neutral-13", "Default card and list fill."),
        ("surface-container", "paper-92", "neutral-16", "Top bar, bottom nav, grouped areas."),
        ("surface-container-high", "paper-90", "neutral-20", "Dialogs, menus."),
        ("surface-container-highest", "paper-87", "neutral-24", "Fields, switch track, chips at rest."),
        ("on-surface", "neutral-15", "neutral-95", "Body text: deep navy on paper, near white on navy. Never dimmed."),
        ("on-surface-variant", "neutral-variant-35", "neutral-variant-80", "Supporting text. At least 4.5:1 on every surface."),
        ("outline", "neutral-variant-50", "neutral-variant-65", "Borders that carry meaning: fields, buttons, switches, sliders. At least 3:1 on every surface."),
        ("outline-variant", "paper-variant-80", "neutral-variant-30", "Decorative tonal edge: cards, lists, nav, dividers. Never the only cue for a control."),
        ("inverse-surface", "neutral-20", "neutral-30", "Snackbar fill. Lifted navy in dark."),
        ("inverse-on-surface", "neutral-95", "neutral-95", "Text on inverse-surface."),
        ("inverse-primary", "green-80", "green-80", "Action text on inverse-surface."),
        ("disabled-container", "paper-90", "neutral-20", "Fill of disabled controls."),
        ("on-disabled", "neutral-variant-40", "neutral-variant-70", "Text on disabled controls."),
        ("focus-ring", "indigo-40", "yellow-80", "Keyboard focus outline, always 3px. Distinct from every fill."),
        ("pixel-shadow", "paper-variant-80", "neutral-4", "Hard shadow colour for elevation."),
    ],
}


def build(cfg):
    old = {t["name"]: t for t in src["color"]["tokens"]}
    palette, usage = {}, {}
    for hue in HUES:
        for tone in HUE_TONES:
            name = f"{hue}-{tone}"
            L, a, b = hex_to_lab(old[name]["value"])
            C, h = math.hypot(a, b), math.degrees(math.atan2(b, a))
            cap = cfg["ring_cap"].get(name, cfg["cap"][tone])
            palette[name] = lch_to_hex(L, min(C * cfg["keep"].get(hue, cfg["keep_default"]), cap), h)
            usage[name] = f"Tone {tone} of the {hue} palette, re-tuned."
    for fam, (hue, chroma, taper) in cfg["neutrals"].items():
        for tone in cfg["neutral_tones"]:
            name = f"{fam}-{tone}"
            c = 0 if tone in (0, 100) else chroma
            if taper and tone > 70:  # keep the light end of a tinted family from going lilac
                c *= max(1 - taper, 1 - taper * (tone - 70) / 25)
            palette[name] = lch_to_hex(float(tone), c, hue)
            usage[name] = f"Tone {tone} of the {fam} palette."

    roles = {n: (l, d, u) for n, l, d, u in cfg["roles"]}
    for hue in HUES:  # hue roles (rarity, categories, charts): same mapping as before
        roles[f"{hue}-accent"] = (f"{hue}-40", f"{hue}-80", f"{hue.capitalize()} for icons, text and strokes on surfaces.")
        roles[f"{hue}-container"] = (f"{hue}-90", f"{hue}-30", f"{hue.capitalize()} fill for tags and chips.")
        roles[f"on-{hue}-container"] = (f"{hue}-10", f"{hue}-90", f"Text on {hue}-container.")

    tokens = [{"name": n, "value": {"light": "{" + l + "}", "dark": "{" + d + "}"}, "usage": u} for n, (l, d, u) in roles.items()]
    tokens.append({"name": "scrim", "value": cfg["scrim"], "usage": "Dims the page behind a dialog."})
    tokens.append({"name": "pixel-lip", "value": cfg["lip"], "usage": "Darker bottom lip inside filled buttons and FABs."})
    for hue in HUES:
        for tone in HUE_TONES:
            tokens.append({"name": f"{hue}-{tone}", "value": palette[f"{hue}-{tone}"], "usage": usage[f"{hue}-{tone}"]})
    for fam in cfg["neutrals"]:
        for tone in cfg["neutral_tones"]:
            tokens.append({"name": f"{fam}-{tone}", "value": palette[f"{fam}-{tone}"], "usage": usage[f"{fam}-{tone}"]})

    out = json.loads(json.dumps(src))  # deep copy keeps type/spacing/radius/opacity identical
    out["name"] = cfg["name"]
    out["color"]["tokens"] = tokens
    light_shadow, dark_shadow = cfg["shadow"]
    for tok in out["shadow"]["tokens"]:
        if isinstance(tok["value"], dict):
            px = tok["value"]["dark"].split(" ")[0]
            tok["value"] = {"light": f"{px} {px} 0 0 {palette[light_shadow]}", "dark": f"{px} {px} 0 0 {palette[dark_shadow]}"}
    (HERE / f"{cfg['out']}.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    subprocess.run([sys.executable, str(BASE / "gen_tokens.py"), str(HERE / f"{cfg['out']}.json"), str(HERE / f"{cfg['out']}.css")], check=True)
    print(f"{cfg['out']}: {len(tokens)} colour tokens")


if __name__ == "__main__":
    want = sys.argv[1:] or ["1", "2"]
    for r, cfg in (("1", ROUND1), ("2", ROUND2)):
        if r in want:
            build(cfg)
