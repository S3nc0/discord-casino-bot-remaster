"""週間ランキングの自動発表。毎週月曜0時（設定の時差）に、先週の稼ぎ1位へ限定称号を贈り、結果を投稿する。

発表の場所は、ランキング掲示をしているチャンネル。無ければサーバーのシステムチャンネル。
Bot が止まっていて月曜0時を逃しても、次に起動したときに1回だけ発表する（二重には発表しない）。
"""

from typing import TYPE_CHECKING, Any, Optional

import discord
from discord.ext import commands, tasks

from cogs.shared import ui
from cogs.shared.announce import announce_channel
from cogs.shared.bridges import DeferredShopTitleBridge, IShopTitleBridge
from cogs.shared.messages import format_standings_lines
from cogs.shared.tasks import run_for_allowed_guilds
from domain import shop, weekly
from domain.ports import get_catalogs
from domain.ports.clock import IClock
from domain.ports.repos import IGuildRepo, IRecordRepo
from infra import logthrottle
from services.economy import EconomyService

if TYPE_CHECKING:
    from cogs.shared.bot import CasinoBot

CHECK_MINUTES = get_catalogs().economy().weekly.check_minutes
KING = shop.BY_ID[shop.WEEKLY_KING]


class WeeklyCog(commands.Cog):
    def __init__(
        self,
        bot: commands.Bot,
        config: dict[str, Any],
        economy_svc: EconomyService,
        records: IRecordRepo,
        guild_repo: IGuildRepo,
        shop_bridge: Optional[IShopTitleBridge] = None,
        clock: Optional[IClock] = None,
    ) -> None:
        self.bot = bot
        self._config = config
        self._economy_svc = economy_svc
        self._records = records
        self._guild_repo = guild_repo
        self._shop_bridge: IShopTitleBridge = shop_bridge if shop_bridge is not None else DeferredShopTitleBridge(bot)
        self._clock: IClock = clock if clock is not None else economy_svc.clock

    async def cog_load(self) -> None:
        done = self._economy_svc.backfill_weekly()  # この機能の前に遊んだ分を、台帳から補う（初回だけ）
        if done:
            print(f"週間ランキング: 過去の {done} ゲーム分を台帳から補いました")
        self.check_weeks.start()

    async def cog_unload(self) -> None:
        self.check_weeks.cancel()

    @tasks.loop(minutes=CHECK_MINUTES)
    async def check_weeks(self) -> None:
        try:
            await self.run_once()
        except Exception as exc:
            print(f"週間ランキングの確認に失敗: {exc!r}")

    @check_weeks.before_loop
    async def _before(self) -> None:
        await self.bot.wait_until_ready()

    async def run_once(self) -> None:
        today = self._clock.today()
        prev_week = weekly.previous_week_id(today)

        async def _handle(guild: discord.Guild) -> None:
            eco = self._records.for_guild(guild.id)
            last = eco.weekly_last_announced()
            if last is None:
                eco.set_weekly_announced(
                    prev_week
                )  # 初めて動いたときは、先週までを発表済みとして、次の月曜から発表する
            elif last < prev_week:
                await self.announce(guild, eco, prev_week)

        await run_for_allowed_guilds(
            self.bot,
            self._guild_repo,
            self._config,
            _handle,
            error_label="週間ランキングの発表に失敗",
        )

    def _channel(self, guild: discord.Guild):
        return announce_channel(guild, self._guild_repo)

    def build_embed(self, week: str, result: dict) -> discord.Embed:
        lines = format_standings_lines(result["standings"], ui.MEDALS)
        champ = result["champion"]
        if champ:
            lines += [
                "",
                f"👑 **<@{champ[0]}>** が **{KING.name}** を獲得しました！（通算{result['wins']}回目）",
                f"今週の稼ぎ **{champ[1]:+,}ペリカ**（{champ[2]}戦）。`/ショップ` の「持ち物」の画面で身につけられます（次の発表まで）。",
            ]
        else:
            lines += [
                "",
                f"今週は、{weekly.MIN_PLAYS}ゲーム以上遊んでプラスだった人がいませんでした。王者はお休みです。",
            ]
        if result["previous"]:
            lines.append("前の王者 " + "・".join(f"<@{u}>" for u in result["previous"]) + " の称号は外れました。")
        e = ui.embed(f"🏆 週間ランキング 発表！（{weekly.week_label(week)}）", "\n".join(lines), ui.GOLD)
        e.set_footer(text="毎週月曜0時に発表 ｜ 稼ぎ = その週のゲームの損益の合計")
        return e

    async def announce(self, guild: discord.Guild, records_scoped: IRecordRepo, week: str) -> None:
        result = records_scoped.weekly_award(week)
        if result is None or not result["standings"]:
            return  # 発表済み、またはその週は誰も遊んでいない
        channel = self._channel(guild)
        if channel is not None:
            champ = result["champion"]
            mentions = discord.AllowedMentions(
                users=[discord.Object(id=champ[0])] if champ else [], roles=False, everyone=False
            )
            try:
                await ui.send_channel(
                    channel,
                    content=f"🎉 <@{champ[0]}>" if champ else None,
                    embed=self.build_embed(week, result),
                    allowed_mentions=mentions,
                )
            except discord.HTTPException as exc:
                logthrottle.warn(("weekly", guild.id), f"週間ランキングを投稿できません: guild={guild.id}: {exc!r}")
        for uid in result["previous"]:  # 外れた称号をニックネームからも消す
            try:
                await self._shop_bridge.sync_title_nick(uid, guild)
            except Exception as exc:
                print(f"称号の取り消しをニックネームに反映できません: guild={guild.id} user={uid}: {exc!r}")


async def setup(bot: "CasinoBot") -> None:
    await bot.add_cog(
        WeeklyCog(
            bot,
            bot.config,
            bot.services.economy,
            bot.repos.records,
            bot.repos.guild,
            clock=bot.services.clock,
        )
    )
