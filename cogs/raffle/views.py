"""抽選の参加ボタン。"""

from typing import TYPE_CHECKING

import discord

if TYPE_CHECKING:
    from cogs.raffle.cog import RaffleCog

JOIN_ID = "raffle:join"


class JoinView(discord.ui.View):
    """参加ボタン。再起動しても動くように、タイムアウトなし・固定の custom_id にしている。"""

    def __init__(self, cog: "RaffleCog"):
        super().__init__(timeout=None)
        self.cog = cog

    @discord.ui.button(label="参加する", emoji="🎟️", style=discord.ButtonStyle.success, custom_id=JOIN_ID)
    async def join(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.cog.on_join(interaction)
