"""会社の画面（Embed）の組み立て。数字は domain/company.py、文言は cogs/company/texts.py。"""

from typing import Any

import discord

from cogs.company.texts import CONDITION_TEXT, KIND_BLURB, KIND_MARK, PANEL_HINT
from cogs.shared import ui
from domain import company as company_mod


def kind_label(kind: str) -> str:
    return f"{KIND_MARK.get(kind, '🏭')} {company_mod.KIND_NAMES[kind]}"


def meter(ratio: float, width: int = 10) -> str:
    filled = max(0, min(width, round(ratio * width)))
    return "█" * filled + "░" * (width - filled)


def company_embed(c: dict[str, Any]) -> discord.Embed:
    """自分の会社の状況。"""
    full = c["stock"] / c["storage_cap"] if c["storage_cap"] else 0.0
    color = ui.ERROR if c["unpaid_days"] else ui.GOLD if full >= 0.999 else ui.INFO
    e = ui.embed(f"🏢 {c['name']}", f"帝愛の子会社　{kind_label(c['kind'])} **Lv{c['level']}**", color)
    e.add_field(
        name="💰 会社資金",
        value=f"**{ui.pelica(c['funds'])}**　（これまでの売上 {ui.pelica(c['sold_total'])}）",
        inline=False,
    )
    condition = CONDITION_TEXT.get(c["condition"], c["condition"])
    e.add_field(
        name="📦 倉庫",
        value=(
            f"`{meter(full)}` {full:.0%}"
            + ("　**満杯（これ以上は捨てられます）**" if full >= 0.999 else "")
            + f"\n今日: {condition}　生産 ×{c['yield_mult']:.1f}　買取価格 **×{c['price']:.2f}**"
            f"\nいま出荷すると **{ui.pelica(c['stock_value'])}**"
            f"（ピンハネ {company_mod.PINHANE_RATE:.0%} を引く前）"
        ),
        inline=False,
    )
    cost = c["upgrade_cost"]
    e.add_field(
        name="🏗️ 事業所",
        value=(
            f"ふつうの日の生産 {ui.pelica(int(c['daily_output']))}／日　倉庫は {company_mod.STORAGE_DAYS} 日分\n"
            f"維持費 {ui.pelica(c['upkeep'])}／日"
            + (
                f"　⚠️ **未払い {c['unpaid_days']}日**（{company_mod.BANKRUPT_DAYS}日で倒産）"
                if c["unpaid_days"]
                else ""
            )
            + "\n"
            + (f"増築（Lv{c['level'] + 1}）: {ui.pelica(cost)}" if cost is not None else "増築: 最大です")
        ),
        inline=False,
    )
    e.add_field(name="🕴️ 帝愛の買取予算", value=ui.pelica(c["budget"]), inline=False)
    e.set_footer(text=PANEL_HINT)
    return e


def guide_embed() -> discord.Embed:
    """会社を持っていない人に出す案内。"""
    cost = company_mod.FOUND_FEE + company_mod.BUILD_COSTS[0]
    lines = [
        f"`/会社 設立` で、自分だけの会社を作れます（**{ui.pelica(cost)}**："
        f"設立費 {ui.pelica(company_mod.FOUND_FEE)}＋事業所の建設費 {ui.pelica(company_mod.BUILD_COSTS[0])}）。",
        "",
    ]
    for key, kind in company_mod.KINDS.items():
        lines.append(f"{kind_label(key)}（1日の生産 {kind.yield_rate:.1%}）: {KIND_BLURB.get(key, '')}")
    lines += [
        "",
        f"維持費は、建設費の {company_mod.UPKEEP_RATE:.1%}／日。売上からは、帝愛のピンハネ {company_mod.PINHANE_RATE:.0%} が引かれます。",
    ]
    return ui.embed("🏢 会社", "\n".join(lines), ui.INFO)
