"""地下闘技場の掲示（出場表・結果）を組み立てる。"""

import time

import discord

from cogs.shared import ui
from domain import arena as arena_mod

FORMAT_NAME = {"duel": "🥊 1on1", "royale": "⚔️ バトルロイヤル"}
STAGE_LABEL = {
    "semi_betting": "準決勝・受付中",
    "semi_done": "準決勝・結果待ち",
    "final_betting": "決勝・受付中",
    "done": "終了",
}


def when(ts: float) -> str:
    if time.time() >= ts:
        return f"<t:{int(ts)}:t>"
    return f"<t:{int(ts)}:t>（<t:{int(ts)}:R>）"


def fighter_line(f: dict) -> str:
    bonus = arena_mod.weapon_bonus(f["bet_total"])
    mark = {"semi": "⏳", "final": "🏅", "out": "💀"}[f["stage"]]
    weapon = f" 🗡️+{bonus:.0%}" if bonus > 0 else ""
    return f"{mark} **{f['name']}**　強さ {f['base_power']}{weapon}　賭け総額 {ui.pelica(f['bet_total'])}"


def tournament_embed(t: dict, semi_hour: int, final_hour: int) -> discord.Embed:
    fmt_label = FORMAT_NAME.get(t["format"], t["format"])
    status_label = STAGE_LABEL.get(t["status"], t["status"])
    lines = [f"今日の形式: {fmt_label}　状態: **{status_label}**", ""]
    groups: dict[int, list[dict]] = {}
    finalists = []
    for f in t["fighters"]:
        if f["stage"] == "final":
            finalists.append(f)
        else:
            groups.setdefault(f["group_no"], []).append(f)
    for group_no in sorted(groups):
        lines.append(f"__準決勝 第{group_no}組__")
        lines.extend(fighter_line(f) for f in groups[group_no])
        lines.append("")
    if finalists or t["status"] in ("final_betting", "done"):
        lines.append("__決勝__")
        if finalists:
            lines.extend(fighter_line(f) for f in finalists)
        else:
            lines.append("（準決勝の結果で決まります）")
    title = "🏛️ 地下闘技場"
    return ui.embed(title, "\n".join(lines), ui.GOLD)
