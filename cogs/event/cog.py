"""突発イベントの告知。1日1回、1つのゲームで30分だけ勝ち分が増える（中身は domain/events.py）。

開始と終了を、ランキング掲示のチャンネル（無ければシステムチャンネル）に投稿する。メンションは付けない。
Bot が止まっていて開始を逃しても、告知はやり直さない（終了後に起動したときは、何も投稿しない）。
"""

import datetime
import time
from typing import TYPE_CHECKING, Any, Optional

import discord
from discord.ext import commands, tasks

from cogs.event.texts import event_copy
from cogs.shared import ui
from cogs.shared.announce import announce_channel
from cogs.shared.bridges import BotBridges, IEventAdminBridge
from domain import approval, events
from domain.ports.clock import IClock
from domain.ports.repos import IEventRepo, IGuildRepo
from infra import logthrottle
from infra.clock import ConfigClock

if TYPE_CHECKING:
    from cogs.shared.bot import CasinoBot


def _event_channel(guild: discord.Guild, m: dict) -> Optional[discord.abc.GuildChannel]:
    """特別イベントの開始を告知したチャンネル（消えていれば None → 告知チャンネルに出す）。"""
    return guild.get_channel(m["channel_id"]) if m.get("channel_id") else None


class EventCog(commands.Cog, IEventAdminBridge):
    def __init__(
        self,
        bot: commands.Bot,
        config: dict[str, Any],
        events_repo: IEventRepo,
        guild_repo: IGuildRepo,
        clock: Optional[IClock] = None,
    ) -> None:
        self.bot = bot
        self._config = config
        self._events = events_repo
        self._guild_repo = guild_repo
        self._clock: IClock = clock if clock is not None else ConfigClock(config)

    async def cog_load(self) -> None:
        self.tick.start()

    async def cog_unload(self) -> None:
        self.tick.cancel()
        bridges = getattr(self.bot, "bridges", None)
        if isinstance(bridges, BotBridges):
            bridges.unregister(IEventAdminBridge, self)

    @tasks.loop(minutes=1)
    async def tick(self) -> None:
        try:
            await self.run_once()
        except Exception as exc:
            print(f"突発イベントの確認に失敗: {exc!r}")

    @tick.before_loop
    async def _before(self) -> None:
        await self.bot.wait_until_ready()

    def build_embed(self, ev: events.Event, ended: bool) -> discord.Embed:
        title, blurb = event_copy(ev.game)
        if ended:
            return ui.embed(f"{title} は終了しました", "また次のイベントをお楽しみに！", ui.INFO)
        text = (
            f"{blurb}\n\n**{ev.clock(ev.start_min)} 〜 {ev.clock(ev.end_min)}**（{events.DURATION_MIN}分間）の間、"
            f"`/カジノ {ev.game}` で勝つと、**勝ち分が{1 + events.BOOST:g}倍**になります。\n"
            f"（上乗せは1回につき最大 {ui.pelica(events.BONUS_CAP)} まで）"
        )
        return ui.embed(f"🔥 突発イベント発生！ {title}", text, ui.GOLD)

    def manual_embed(self, m: dict, ended: bool) -> discord.Embed:
        title, blurb = event_copy(m["game"])  # 廃止したゲームのイベントが残っていても落ちない
        if ended:
            return ui.embed(f"{title} は終了しました", "また次のイベントをお楽しみに！", ui.INFO)
        text = (
            f"{blurb}\n\n<t:{int(m['starts'])}:t> 〜 <t:{int(m['ends'])}:t>（<t:{int(m['ends'])}:R>に終了）の間、"
            f"`/カジノ {m['game']}` で勝つと、**勝ち分が{1 + m['boost'] / 100:g}倍**になります。\n"
            f"（上乗せは1回につき最大 {ui.pelica(events.BONUS_CAP)} まで）"
        )
        return ui.embed(f"🔥 特別イベント発生！ {title}", text, ui.GOLD)

    async def start_manual(
        self,
        guild: discord.Guild,
        game: str,
        boost_pct: int,
        minutes: int,
        channel: Optional[discord.abc.Messageable] = None,
    ) -> tuple[bool, str]:
        """持ち主が開く特別イベント。いま開催中のものがあれば置き換える。channel を渡すと、そこに告知する（終了の告知も同じ所）。"""
        eco = self._events.for_guild(guild.id)
        now = time.time()
        replaced = eco.manual_event_get(now) is not None
        eco.manual_event_start(game, boost_pct, now, now + minutes * 60, getattr(channel, "id", 0) or 0)
        started = eco.manual_event_get(now)
        if started is not None:
            await self._post(guild, self.manual_embed(started, False), channel)
        title, _ = event_copy(game)
        return True, f"{guild.name}: {title}を{minutes}分間、勝ち分+{boost_pct}%で開きました" + (
            "（前のイベントは置き換えました）" if replaced else ""
        )

    async def stop_manual(self, guild: discord.Guild) -> tuple[bool, str]:
        eco = self._events.for_guild(guild.id)
        m = eco.manual_event_stop(time.time())
        if m is None:
            return False, f"{guild.name}: 開催中の特別イベントはありません"
        await self._post(guild, self.manual_embed(m, True), _event_channel(guild, m))
        title, _ = event_copy(m["game"])
        return True, f"{guild.name}: {title}を終わらせました"

    async def run_once(self) -> None:
        now = self._clock.now()
        for guild in list(self.bot.guilds):
            if not approval.is_allowed(self._guild_repo, self._config, guild.id, 0):
                continue
            try:
                await self._run_guild(guild, now)
            except Exception as exc:  # 1サーバーの失敗で、ほかのサーバーを止めない
                print(f"イベントの進行に失敗: guild={guild.id}: {exc!r}")

    async def _run_guild(self, guild: discord.Guild, now: datetime.datetime) -> None:
        minutes = now.hour * 60 + now.minute
        eco = self._events.for_guild(guild.id)
        done = eco.manual_event_finish_due(time.time())  # 時間が来た特別イベントの終了を、1回だけ告知する
        if done is not None:
            await self._post(guild, self.manual_embed(done, True), _event_channel(guild, done))
        ev = events.schedule(guild.id, now.date())
        phase = eco.event_phase(now.date())
        if phase == 0 and ev.start_min <= minutes < ev.end_min:
            eco.set_event_phase(now.date(), 1)
            await self._post(guild, self.build_embed(ev, False))
        elif phase < 2 and minutes >= ev.end_min:
            eco.set_event_phase(now.date(), 2)
            if phase == 1:  # 開始を告知した分だけ、終了も告知する
                await self._post(guild, self.build_embed(ev, True))

    async def _post(
        self,
        guild: discord.Guild,
        embed: discord.Embed,
        channel: object = None,
    ) -> None:
        target = channel or announce_channel(guild, self._guild_repo)
        if target is None:
            return
        try:
            await ui.send_channel(target, embed=embed, allowed_mentions=discord.AllowedMentions.none())
        except discord.HTTPException as exc:
            logthrottle.warn(("event", guild.id), f"突発イベントを投稿できません: guild={guild.id}: {exc!r}")


async def setup(bot: "CasinoBot") -> None:
    cog = EventCog(bot, bot.config, bot.repos.events, bot.repos.guild)
    bot.bridges.register(IEventAdminBridge, cog)
    await bot.add_cog(cog)
