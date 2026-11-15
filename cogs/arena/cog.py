"""/闘技場 — 地下闘技場。1日1回の大会（準決勝2試合→決勝1試合）。NPCの戦士どうしが戦い、賭ける。

形式（1on1／バトロワ）は日替わり。戦士への賭け総額に応じて武器で強くなるが、必ず勝てるとは限らない。
数字とシミュレーションは domain/arena.py、処理は infra/db/arena.py、画面の部品は cogs/arena/*.py。

既知の制限: 掲示パネルの賭けボタンは、Bot再起動をまたぐと動かなくなる（再起動後は `/闘技場 大会` で出し直す）。
"""

import datetime
import time

import discord
from discord import app_commands
from discord.ext import commands, tasks

from cogs.arena.views import BetPanel
from cogs.shared import ui
from cogs.shared.announce import announce_channel
from domain import approval
from domain import arena as arena_mod
from infra import logthrottle

NONE = discord.AllowedMentions.none()


class ArenaCog(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self._busy = set()
        self._announced = set()  # (guild_id, day) のうち、今日の開幕を告知済みのもの

    async def cog_load(self):
        self.tick.start()

    async def cog_unload(self):
        self.tick.cancel()

    group = app_commands.Group(
        name="闘技場", description="🏛️ 地下闘技場（1日1回の大会・NPC戦士に賭ける）", guild_only=True
    )

    def g(self, interaction: discord.Interaction):
        return self.bot.economy.for_guild(ui.guild_id_of(interaction))

    @group.command(name="大会", description="今日の大会の状況を見る・賭ける")
    async def tournament(self, interaction: discord.Interaction):
        eco = self.g(interaction)
        t = eco.arena_tournament_ensure(time.time())
        panel = BetPanel(self.bot, t)
        await interaction.response.send_message(
            embed=panel.embed(arena_mod.SEMI_HOUR, arena_mod.FINAL_HOUR), view=panel
        )

    # ------------------------------ 定時の進行 ------------------------------ #
    @tasks.loop(seconds=30)
    async def tick(self):
        try:
            await self.run_once()
        except Exception as exc:
            print(f"地下闘技場の確認に失敗: {exc!r}")

    @tick.before_loop
    async def _before(self):
        await self.bot.wait_until_ready()

    async def _channel(self, guild: discord.Guild, eco):
        return announce_channel(guild, eco)

    async def _post(self, channel, **kw):
        try:
            return await channel.send(allowed_mentions=NONE, **kw)
        except discord.HTTPException as exc:
            logthrottle.warn(("arena-post", channel.id), f"地下闘技場の投稿に失敗: channel={channel.id}: {exc!r}")
            return None

    async def run_once(self) -> None:
        now = time.time()
        for guild in list(self.bot.guilds):
            if guild.id in self._busy or not approval.is_allowed(self.bot.economy, self.bot.config, guild.id, 0):
                continue
            self._busy.add(guild.id)
            try:
                eco = self.bot.economy.for_guild(guild.id)
                t = eco.arena_tournament_ensure(now)
                day_key = (guild.id, t["day"])
                tz = datetime.timezone(datetime.timedelta(hours=9))
                tz_hour = datetime.datetime.fromtimestamp(now, tz).hour
                if day_key not in self._announced:
                    self._announced.add(day_key)
                    channel = await self._channel(guild, eco)
                    if channel is not None:
                        panel = BetPanel(self.bot, t)
                        await self._post(
                            channel,
                            content="🏛️ **地下闘技場** 今日の大会が始まりました！",
                            embed=panel.embed(arena_mod.SEMI_HOUR, arena_mod.FINAL_HOUR),
                            view=panel,
                        )
                if t["status"] == "semi_betting" and tz_hour >= arena_mod.SEMI_HOUR:
                    result = eco.arena_run_semis(t["id"])
                    if result:
                        channel = await self._channel(guild, eco)
                        if channel is not None:
                            lines = [
                                f"第{g}組: **{r['winner']}** が勝利（敗: {'・'.join(r['losers'])}）"
                                for g, r in result["groups"].items()
                            ]
                            await self._post(
                                channel,
                                embed=ui.embed(
                                    "🏛️ 準決勝、決着！",
                                    "\n".join(lines) + f"\n\n決勝は **{' vs '.join(result['finalists'])}**",
                                    ui.GOLD,
                                ),
                            )
                t = eco.arena_tournament_ensure(now)  # 準決勝の決着を反映して読み直す
                if t["status"] == "final_betting" and tz_hour >= arena_mod.FINAL_HOUR:
                    result = eco.arena_run_final(t["id"])
                    if result:
                        channel = await self._channel(guild, eco)
                        if channel is not None:
                            await self._post(
                                channel,
                                embed=ui.embed(
                                    "👑 決勝、決着！",
                                    f"優勝: **{result['champion']}**（準優勝: {result['runner_up']}）",
                                    ui.GOLD,
                                ),
                            )
            except Exception as exc:  # 1サーバーの失敗で、ほかを止めない
                print(f"地下闘技場を処理できません: guild={guild.id}: {exc!r}")
            finally:
                self._busy.discard(guild.id)


async def setup(bot):
    await bot.add_cog(ArenaCog(bot))
