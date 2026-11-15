"""地下闘技場の賭けパネル（BetPanel）と賭け金モーダル（StakeModal）。"""

import time

import discord

from cogs.arena.embeds import tournament_embed
from cogs.shared import ui
from cogs.shared.messages import format_failure
from domain import arena as arena_mod


def bettable_fighters(t: dict) -> list:
    open_stage = "semi" if t["status"] == "semi_betting" else "final" if t["status"] == "final_betting" else None
    if open_stage is None:
        return []
    return [f for f in t["fighters"] if f["stage"] == open_stage]


class StakeModal(discord.ui.Modal):
    def __init__(self, panel: "BetPanel", fighter: dict):
        super().__init__(title=f"{fighter['name']} に賭ける")
        self.panel, self.fighter = panel, fighter
        self.stake = discord.ui.TextInput(
            label=f"賭け金（{arena_mod.MIN_STAKE:,}〜{arena_mod.MAX_STAKE:,}ペリカ）", max_length=8
        )
        self.add_item(self.stake)

    async def on_submit(self, interaction: discord.Interaction):
        raw = self.stake.value.replace(",", "").strip()
        if not raw.isdigit():
            await interaction.response.send_message(
                embed=ui.error_embed("金額が正しくありません", "半角の数字で入れてください。"), ephemeral=True
            )
            return
        eco = self.panel.bot.economy.for_guild(ui.guild_id_of(interaction))
        ok, reason = eco.arena_bet(interaction.user.id, self.fighter["id"], int(raw), time.time())
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


class FighterSelect(discord.ui.Select):
    def __init__(self, panel: "BetPanel"):
        options = [
            discord.SelectOption(label=f["name"], value=str(f["id"]), description=f"強さ {f['base_power']}")
            for f in bettable_fighters(panel.tournament)
        ]
        super().__init__(placeholder="賭ける戦士を選ぶ", options=options or [discord.SelectOption(label="（なし）")])
        self.disabled = not options
        self.panel = panel

    async def callback(self, interaction: discord.Interaction):
        fid = int(ui.selected_values(interaction)[0])
        fighter = next(f for f in self.panel.tournament["fighters"] if f["id"] == fid)
        await interaction.response.send_modal(StakeModal(self.panel, fighter))


class BetPanel(discord.ui.View):
    """地下闘技場の掲示（公開。誰でも見られ、賭けるときだけ自分のモーダルが開く）。"""

    def __init__(self, bot, tournament: dict):
        super().__init__(timeout=None)
        self.bot, self.tournament = bot, tournament
        if bettable_fighters(tournament):
            self.add_item(FighterSelect(self))

    def embed(self, semi_hour: int, final_hour: int) -> discord.Embed:
        return tournament_embed(self.tournament, semi_hour, final_hour)
