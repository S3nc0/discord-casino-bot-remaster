"""/会社 — 自分だけの会社（帝愛の子会社）を作り、事業所で製品を作って帝愛に売る。

数字と決まりは domain/company.py（catalogs/company.yaml）、処理は services/company.py（保存は infra/db/company.py）、画面の部品は cogs/company/*.py。
"""

import logging
from typing import TYPE_CHECKING, Any

import discord
from discord import app_commands
from discord.ext import commands, tasks

from cogs.company.embeds import kind_label
from cogs.company.views import CompanyPanel
from cogs.shared import ui
from cogs.shared.announce import announce_channel
from cogs.shared.messages import format_failure
from cogs.shared.tasks import run_for_allowed_guilds
from domain import company as company_mod
from domain.ports.repos import IGuildRepo
from services.company import CompanyService

if TYPE_CHECKING:
    from cogs.shared.bot import CasinoBot

_log = logging.getLogger(__name__)
NONE = discord.AllowedMentions.none()


class CompanyCog(commands.Cog):
    def __init__(
        self, bot: commands.Bot, config: dict[str, Any], company: CompanyService, guild_repo: IGuildRepo
    ) -> None:
        self.bot = bot
        self._config = config
        self._company = company
        self._guild_repo = guild_repo
        self._busy: set[int] = set()

    async def cog_load(self) -> None:
        self.tick.start()

    async def cog_unload(self) -> None:
        self.tick.cancel()

    group = app_commands.Group(name="会社", description="🏢 会社（帝愛の子会社を作って、製品を売る）", guild_only=True)

    @group.command(name="設立", description="会社を設立する（設立費と、事業所の建設費がかかります）")
    @app_commands.rename(name="社名", kind="事業所")
    @app_commands.describe(name=f"社名（{company_mod.NAME_MAX}文字まで）", kind="事業所の種類")
    @app_commands.choices(
        kind=[app_commands.Choice(name=kind.name, value=key) for key, kind in company_mod.KINDS.items()]
    )
    async def found(self, interaction: discord.Interaction, name: str, kind: app_commands.Choice[str]) -> None:
        gid = ui.guild_id_of(interaction)
        ok, result = self._company.found(gid, interaction.user.id, name, kind.value)
        if not ok:
            await interaction.response.send_message(
                embed=ui.error_embed("設立できません", format_failure(result)), ephemeral=True
            )
            return
        await interaction.response.send_message(
            embed=ui.ok_embed(
                "🏢 会社を設立しました",
                f"{interaction.user.mention} が、帝愛の子会社 **{result['name']}**（{kind_label(result['kind'])}）を設立しました。",
            ),
            allowed_mentions=NONE,
        )

    @group.command(name="状況", description="自分の会社を見る・出荷・出資・増築をする")
    async def status(self, interaction: discord.Interaction) -> None:
        panel = CompanyPanel(self._company, interaction.user.id, ui.guild_id_of(interaction))
        await interaction.response.send_message(embed=panel.embed(), view=panel, ephemeral=True)

    # ------------------------------ 定時の精算（維持費・倒産） ------------------------------ #
    @tasks.loop(minutes=10)
    async def tick(self) -> None:
        try:
            await self.run_once()
        except Exception as exc:
            _log.exception("会社の精算に失敗: %r", exc)

    @tick.before_loop
    async def _before(self) -> None:
        await self.bot.wait_until_ready()

    async def run_once(self) -> None:
        async def _handle(guild: discord.Guild) -> None:
            for gone in self._company.settle_all(guild.id):
                channel = announce_channel(guild, self._guild_repo)
                if channel is None:
                    continue
                try:
                    await ui.send_channel(
                        channel,
                        embed=ui.embed(
                            "🏚️ 倒産",
                            f"<@{gone['user_id']}> の **{gone['name']}** は、維持費を払えない日が続いたため倒産しました。",
                            ui.ERROR,
                        ),
                        allowed_mentions=NONE,
                    )
                except discord.HTTPException as exc:
                    _log.warning("倒産の告知に失敗: guild=%s: %r", guild.id, exc)

        await run_for_allowed_guilds(
            self.bot,
            self._guild_repo,
            self._config,
            _handle,
            error_label="会社を精算できません",
            busy=self._busy,
            logger=_log,
        )


async def setup(bot: "CasinoBot") -> None:
    await bot.add_cog(CompanyCog(bot, bot.config, bot.services.company, bot.repos.guild))
