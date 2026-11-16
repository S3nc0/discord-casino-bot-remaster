"""/闘技場 — 地下闘技場。1日1回の大会（準決勝2試合→決勝1試合）。NPCの戦士どうしが戦い、賭ける。

形式（1on1／バトロワ）は日替わり。戦士への賭け総額に応じて武器で強くなるが、必ず勝てるとは限らない。
数字とシミュレーションは domain/arena.py、処理は infra/db/arena.py、画面の部品は cogs/arena/*.py。

既知の制限: 掲示パネルの賭けボタンは、Bot再起動をまたぐと動かなくなる（再起動後は `/闘技場 大会` で出し直す）。
"""

import asyncio
import datetime
import logging
import random
import time
from typing import TYPE_CHECKING, Any, Optional

import discord
from discord import app_commands
from discord.ext import commands, tasks

from cogs.arena.embeds import battle_embed
from cogs.arena.views import BetPanel
from cogs.shared import ui
from cogs.shared.announce import announce_channel
from domain import approval
from domain import arena as arena_mod
from domain.ports.repos import IArenaRepo, IGuildRepo
from infra import logthrottle

if TYPE_CHECKING:
    from cogs.shared.bot import CasinoBot

_log = logging.getLogger(__name__)
NONE = discord.AllowedMentions.none()
ANIM_FRAMES = 6  # 演出のコマ数
ANIM_STEP = 1.2  # 演出のコマ間隔（秒）


class ArenaCog(commands.Cog):
    def __init__(
        self,
        bot: commands.Bot,
        config: dict[str, Any],
        arena_repo: IArenaRepo,
        guild_repo: IGuildRepo,
    ) -> None:
        self.bot = bot
        self._config = config
        self._arena = arena_repo
        self._guild_repo = guild_repo
        self._busy: set[int] = set()
        self._announced: set[tuple[int, str]] = set()  # (guild_id, day) のうち、今日の開幕を告知済みのもの
        self._panels: dict[tuple[int, str], BetPanel] = {}  # (guild_id, day) → 自動投稿した掲示のBetPanel

    async def cog_load(self) -> None:
        self.tick.start()

    async def cog_unload(self) -> None:
        self.tick.cancel()

    group = app_commands.Group(
        name="闘技場", description="🏛️ 地下闘技場（1日1回の大会・NPC戦士に賭ける）", guild_only=True
    )

    def g(self, interaction: discord.Interaction) -> IArenaRepo:
        return self._arena.for_guild(ui.guild_id_of(interaction))

    @group.command(name="大会", description="今日の大会の状況を見る・賭ける")
    async def tournament(self, interaction: discord.Interaction) -> None:
        arena = self.g(interaction)
        t = arena.arena_tournament_ensure(time.time())
        panel = BetPanel(self._arena, t)
        await interaction.response.send_message(embed=panel.embed(), view=panel)
        try:
            panel.message = await interaction.original_response()
        except discord.HTTPException:
            pass

    # ------------------------------ 定時の進行 ------------------------------ #
    @tasks.loop(seconds=30)
    async def tick(self) -> None:
        try:
            await self.run_once()
        except Exception as exc:
            _log.exception("地下闘技場の確認に失敗: %r", exc)

    @tick.before_loop
    async def _before(self) -> None:
        await self.bot.wait_until_ready()

    async def _channel(self, guild: discord.Guild) -> Optional[discord.abc.GuildChannel]:
        return announce_channel(guild, self._guild_repo)

    async def _post(self, channel: object, **kw: Any) -> Optional[discord.Message]:
        try:
            return await ui.send_channel(channel, allowed_mentions=NONE, **kw)
        except discord.HTTPException as exc:
            cid = getattr(channel, "id", 0)
            logthrottle.warn(("arena-post", cid), f"地下闘技場の投稿に失敗: channel={cid}: {exc!r}")
            return None

    async def _animate_match(
        self, channel: object, fighters: list[dict[str, Any]], winner_idx: int, title: str
    ) -> None:
        """戦闘演出（HPバーのメッセージ書き換え）。勝敗はすでに決まっており、見た目だけ。"""
        frames = arena_mod.battle_frames(len(fighters), winner_idx, random.Random(), ANIM_FRAMES)
        msg = await self._post(channel, embed=battle_embed(fighters, frames[0], title))
        if msg is None:
            return
        try:
            for hp in frames[1:]:
                await asyncio.sleep(ANIM_STEP)
                await msg.edit(embed=battle_embed(fighters, hp, title))
        except discord.HTTPException as exc:
            cid = getattr(channel, "id", 0)
            logthrottle.warn(("arena-anim", cid), f"闘技場の演出を表示できません: {exc!r}")

    async def run_once(self) -> None:
        now = time.time()
        for guild in list(self.bot.guilds):
            if guild.id in self._busy or not approval.is_allowed(self._guild_repo, self._config, guild.id, 0):
                continue
            self._busy.add(guild.id)
            try:
                arena = self._arena.for_guild(guild.id)
                t = arena.arena_tournament_ensure(now)
                day_key = (guild.id, t["day"])
                tz = datetime.timezone(datetime.timedelta(hours=9))
                tz_hour = datetime.datetime.fromtimestamp(now, tz).hour
                if day_key not in self._announced:
                    self._announced.add(day_key)
                    channel = await self._channel(guild)
                    if channel is not None:
                        panel = BetPanel(self._arena, t)
                        msg = await self._post(
                            channel,
                            content="🏛️ **地下闘技場** 今日の大会が始まりました！",
                            embed=panel.embed(),
                            view=panel,
                        )
                        panel.message = msg
                        self._panels[day_key] = panel
                if t["status"] == "semi_betting" and tz_hour >= arena_mod.SEMI_HOUR:
                    pre_fighters = t["fighters"]
                    result = arena.arena_run_semis(t["id"])
                    if result:
                        channel = await self._channel(guild)
                        if channel is not None:
                            for group_no, info in result["groups"].items():
                                group_fighters = [f for f in pre_fighters if f["group_no"] == group_no]
                                winner_idx = next(
                                    i for i, f in enumerate(group_fighters) if f["name"] == info["winner"]
                                )
                                await self._animate_match(
                                    channel, group_fighters, winner_idx, f"⏳ 準決勝 第{group_no}組、開戦！"
                                )
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
                        if day_key in self._panels:
                            await self._panels[day_key].refresh()
                t = arena.arena_tournament_ensure(now)  # 準決勝の決着を反映して読み直す
                if t["status"] == "final_betting" and tz_hour >= arena_mod.FINAL_HOUR:
                    pre_finalists = [f for f in t["fighters"] if f["stage"] == "final"]
                    result = arena.arena_run_final(t["id"])
                    if result:
                        channel = await self._channel(guild)
                        if channel is not None and len(pre_finalists) == 2:
                            winner_idx = 0 if result["champion"] == pre_finalists[0]["name"] else 1
                            await self._animate_match(channel, pre_finalists, winner_idx, "👑 決勝、開戦！")
                        if channel is not None:
                            await self._post(
                                channel,
                                embed=ui.embed(
                                    "👑 決勝、決着！",
                                    f"優勝: **{result['champion']}**（準優勝: {result['runner_up']}）",
                                    ui.GOLD,
                                ),
                            )
                        if day_key in self._panels:
                            await self._panels[day_key].refresh()
                            del self._panels[day_key]  # 大会は終わったので、以後は書き換えない
            except Exception as exc:  # 1サーバーの失敗で、ほかを止めない
                _log.exception("地下闘技場を処理できません: guild=%s: %r", guild.id, exc)
            finally:
                self._busy.discard(guild.id)


async def setup(bot: "CasinoBot") -> None:
    await bot.add_cog(ArenaCog(bot, bot.config, bot.repos.arena, bot.repos.guild))
