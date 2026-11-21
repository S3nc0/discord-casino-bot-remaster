#!/usr/bin/env python3
"""Contrast gate for the proposed Bitbloom theme.

    python3 design/bitbloom/proposal/contrast_check.py            # prints every rule, exits 1 on failure
    python3 design/bitbloom/proposal/contrast_check.py --table    # prints the role table used in the doc

Rules (WCAG 2.x relative-luminance ratio, same formula as packages/ui/src/styles/contrast.test.ts):
  text       >= 4.5   body, supporting text, text on fills, coloured text/icons on every surface
  meaningful >= 3.0   --outline (control borders), focus ring, primary fills against surfaces
  decorative  none    --outline-variant is a tonal step; it must stay visible as a step (>= 1.3:1
                      against the surface it sits on) and must be softer than --outline.
  not dim            on-surface >= 10:1 and on-surface-variant >= 5.5:1 on --surface.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SURFACES = ["surface-container-lowest", "surface", "surface-container-low", "surface-container", "surface-container-high", "surface-container-highest"]
HUES = ["red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "magenta", "pink", "brown"]
RARITY = {"common": "neutral", "uncommon": "green", "rare": "blue", "epic": "violet", "legendary": "yellow"}
FILLS = ["primary", "secondary", "tertiary", "error", "success", "warning"]


def load(path):
    toks = {t["name"]: t["value"] for t in json.loads(Path(path).read_text())["color"]["tokens"]}

    def resolve(name, theme):
        v = toks[name]
        if isinstance(v, dict):
            v = v[theme]
        m = re.fullmatch(r"\{([^}]+)\}", v)
        return resolve(m.group(1), theme) if m else v

    return lambda name, theme: resolve(name, theme)


def lum(h):
    ch = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = (c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in ch)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def pairs(get, theme, hue_roles=True):
    """(rule, label, fg, bg, minimum) for every pair under test."""
    out = []
    g = lambda n: get(n, theme)
    for f in FILLS:
        out.append(("text", f"on-{f} on {f}", g(f"on-{f}"), g(f), 4.5))
        out.append(("text", f"on-{f}-container on {f}-container", g(f"on-{f}-container"), g(f"{f}-container"), 4.5))
        for s in SURFACES:
            out.append(("text", f"{f} (text/icon) on {s}", g(f), g(s), 4.5))
    for s in SURFACES:
        out.append(("text", f"on-surface on {s}", g("on-surface"), g(s), 4.5))
        out.append(("text", f"on-surface-variant on {s}", g("on-surface-variant"), g(s), 4.5))
        out.append(("meaningful", f"outline on {s}", g("outline"), g(s), 3.0))
        out.append(("meaningful", f"focus-ring on {s}", g("focus-ring"), g(s), 3.0))
    out.append(("meaningful", "outline on secondary-container (slider track)", g("outline"), g("secondary-container"), 3.0))
    out.append(("text", "inverse-on-surface on inverse-surface", g("inverse-on-surface"), g("inverse-surface"), 4.5))
    out.append(("text", "inverse-primary on inverse-surface", g("inverse-primary"), g("inverse-surface"), 4.5))
    out.append(("text", "on-disabled on disabled-container", g("on-disabled"), g("disabled-container"), 4.5))
    out.append(("not dim", "on-surface on surface", g("on-surface"), g("surface"), 10.0))
    out.append(("not dim", "on-surface-variant on surface", g("on-surface-variant"), g("surface"), 5.5))
    out.append(("decorative", "outline-variant on surface (visible step)", g("outline-variant"), g("surface"), 1.3))
    out.append(("decorative", "outline-variant on surface-container-low (visible step)", g("outline-variant"), g("surface-container-low"), 1.3))
    if hue_roles:
        for h in HUES:
            out.append(("text", f"on-{h}-container on {h}-container", g(f"on-{h}-container"), g(f"{h}-container"), 4.5))
            for s in SURFACES:
                out.append(("text", f"{h}-accent on {s}", g(f"{h}-accent"), g(s), 4.5))
    return out


def run(path, label):
    get = load(path)
    failures, total = [], 0
    for theme in ("dark", "light"):
        for rule, name, fg, bg, need in pairs(get, theme):
            total += 1
            r = ratio(fg, bg)
            if r < need:
                failures.append(f"{label} {theme}: [{rule}] {name} {fg} on {bg} = {r:.2f}:1 (need {need})")
        # Decorative edge must be softer than the meaningful one, on the surface it is drawn on.
        s = get("surface", theme)
        if not ratio(get("outline-variant", theme), s) < ratio(get("outline", theme), s):
            failures.append(f"{label} {theme}: [decorative] outline-variant is not softer than outline")
        total += 1
        # Layers must stay distinguishable but gentle (calm).
        for a, b in zip(SURFACES, SURFACES[1:]):
            total += 1
            step = ratio(get(a, theme), get(b, theme))
            if step < 1.04:
                failures.append(f"{label} {theme}: [layers] {a} -> {b} is only {step:.3f}:1 (need >= 1.04)")
    return total, failures


def table():
    """Compact before/after table for the doc: role colour old -> new, and the pair ratio old -> new."""
    old, new = load(HERE.parent / "tokens.json"), load(HERE / "tokens.proposal.json")
    rows = [  # (label, role, role it is read against; None = swatch only)
        ("Page background", "surface", None),
        ("Card fill", "surface-container-low", None),
        ("Field / chip fill", "surface-container-highest", None),
        ("Body text", "on-surface", "surface"),
        ("Supporting text", "on-surface-variant", "surface-container-highest"),
        ("Primary (text/icon)", "primary", "surface"),
        ("Text on primary", "on-primary", "primary"),
        ("Tonal fill, text on it", "on-secondary-container", "secondary-container"),
        ("Accent: old `secondary`, new `tertiary`", None, "surface"),
        ("Control border (`outline`)", "outline", "surface-container-highest"),
        ("Card / list / nav edge (`outline-variant`)", "outline-variant", "surface"),
        ("Focus ring", "focus-ring", "surface"),
        ("Snackbar text", "inverse-on-surface", "inverse-surface"),
        ("Disabled text", "on-disabled", "disabled-container"),
    ]
    print("| Role | Dark: old → new | Light: old → new | Ratio dark | Ratio light |")
    print("| --- | --- | --- | --- | --- |")
    for label, fg, bg in rows:
        cells, ratios = [], []
        for theme in ("dark", "light"):
            ofg, nfg = (old("secondary", theme), new("tertiary", theme)) if fg is None else (old(fg, theme), new(fg, theme))
            cells.append(f"`{ofg}` → `{nfg}`")
            if bg:
                ratios.append(f"{ratio(ofg, old(bg, theme)):.1f} → {ratio(nfg, new(bg, theme)):.1f}")
            else:
                ratios.append("")
        print(f"| {label} | {cells[0]} | {cells[1]} | {ratios[0]} | {ratios[1]} |")
    print()
    print("| Rarity | Dark tag: old → new | Light tag: old → new |")
    print("| --- | --- | --- |")
    for r, h in RARITY.items():
        cells = []
        for theme in ("dark", "light"):
            def tag(gt):
                if h == "neutral":
                    return ratio(gt("on-surface", theme), gt("surface-container-highest", theme)), ratio(gt("on-surface-variant", theme), gt("surface", theme))
                return ratio(gt(f"on-{h}-container", theme), gt(f"{h}-container", theme)), ratio(gt(f"{h}-accent", theme), gt("surface", theme))
            (a1, a2), (b1, b2) = tag(old), tag(new)
            cells.append(f"text {a1:.1f} → {b1:.1f}, accent {a2:.1f} → {b2:.1f}")
        print(f"| {r} ({h}) | {cells[0]} | {cells[1]} |")


if __name__ == "__main__":
    if "--table" in sys.argv:
        table()
        sys.exit(0)
    total, fails = run(HERE / "tokens.proposal.json", "proposal")
    print(f"proposal: {total} checks, {len(fails)} failing")
    for f in fails:
        print("  FAIL", f)
    ototal, ofails = run(HERE.parent / "tokens.json", "current")
    print(f"current (for reference, same rules): {ototal} checks, {len(ofails)} failing")
    for f in ofails[:12]:
        print("  note", f)
    sys.exit(1 if fails else 0)
