"""地下闘技場の賭けパネル（BetPanel）と賭け金モーダル（StakeModal）。賭けが入ると、掲示を自動で書き換える。"""

from typing import Any, Optional

import discord

from cogs.arena.embeds import tournament_embed
from cogs.shared import ui
from cogs.shared.messages import format_failure
from domain import arena as arena_mod
from services.arena import ArenaService


def bettable_fighters(t: dict[str, Any]) -> list[dict[str, Any]]:
    open_stage = "semi" if t["status"] == "semi_betting" else "final" if t["status"] == "final_betting" else None
    if open_stage is None:
        return []
    return [f for f in t["fighters"] if f["stage"] == open_stage]


class StakeModal(discord.ui.Modal):
    def __init__(self, panel: "BetPanel", fighter: dict[str, Any]) -> None:
        super().__init__(title=f"{fighter['name']} に賭ける")
        self.panel, self.fighter = panel, fighter
        self.stake: discord.ui.TextInput["StakeModal"] = discord.ui.TextInput(
            label=f"賭け金（{arena_mod.MIN_STAKE:,}〜{arena_mod.MAX_STAKE:,}ペリカ）", max_length=8
        )
        self.add_item(self.stake)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        raw = self.stake.value.replace(",", "").strip()
        if not raw.isdigit():
            await interaction.response.send_message(
                embed=ui.error_embed("金額が正しくありません", "半角の数字で入れてください。"), ephemeral=True
            )
            return
        ok, reason = self.panel.arena_svc.place_bet(
            ui.guild_id_of(interaction), interaction.user.id, self.fighter["id"], int(raw)
        )
        if not ok:
            await interaction.response.send_message(
                embed=ui.error_embed("賭けられませんでした", format_failure(reason)), ephemeral=True
            )
            return
        await interaction.response.send_message(
            embed=ui.ok_embed(
                "賭けました", f"**{self.fighter['name']}** に {ui.pelica(int(raw))}（的中すれば賭け金ぶん増えます）"
            ),
            ephemeral=True,
        )
        await self.panel.refresh()  # 掲示の賭け総額・内訳を、すぐ書き換える


class FighterSelect(discord.ui.Select["BetPanel"]):
    def __init__(self, panel: "BetPanel") -> None:
        options = [
            discord.SelectOption(label=f["name"], value=str(f["id"]), description=f"強さ {f['base_power']}")
            for f in bettable_fighters(panel.tournament)
        ]
        super().__init__(placeholder="賭ける戦士を選ぶ", options=options or [discord.SelectOption(label="（なし）")])
        self.disabled = not options
        self.panel = panel

    async def callback(self, interaction: discord.Interaction) -> None:
        self.panel.message = interaction.message  # 賭け後に書き換えるメッセージを覚えておく
        fid = int(ui.selected_values(interaction)[0])
        fighter = next(f for f in self.panel.tournament["fighters"] if f["id"] == fid)
        await interaction.response.send_modal(StakeModal(self.panel, fighter))


class BetPanel(discord.ui.View):
    """地下闘技場の掲示（公開。誰でも見られ、賭けるときだけ自分のモーダルが開く）。"""

    def __init__(self, arena_svc: ArenaService, tournament: dict[str, Any]) -> None:
        super().__init__(timeout=None)
        self.arena_svc, self.tournament = arena_svc, tournament
        self.message: Optional[discord.Message] = None
        if bettable_fighters(tournament):
            self.add_item(FighterSelect(self))

    def embed(self) -> discord.Embed:
        breakdown = self.arena_svc.arena.for_guild(self.tournament["guild_id"]).arena_bets_breakdown(
            self.tournament["id"]
        )
        return tournament_embed(self.tournament, arena_mod.SEMI_HOUR, arena_mod.FINAL_HOUR, breakdown)

    async def refresh(self) -> None:
        """最新のDB状態を読み直し、掲示メッセージを書き換える（賭けが入るたび・段が進むたび）。"""
        fresh = self.arena_svc.arena.for_guild(self.tournament["guild_id"]).arena_tournament_get_by_day(
            self.tournament["day"]
        )
        if fresh is not None:
            self.tournament = fresh
        self.clear_items()
        if bettable_fighters(self.tournament):
            self.add_item(FighterSelect(self))
        if self.message is not None:
            try:
                await self.message.edit(embed=self.embed(), view=self)
            except discord.HTTPException:
                pass
