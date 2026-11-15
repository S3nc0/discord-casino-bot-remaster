"""証券市場の価格更新・決算告知・ライブチャート定期更新フィード。"""

import time

import discord

from cogs.market.embeds import LIVE_MINUTES, earnings_announce_embed, earnings_result_embed
from cogs.shared import ui
from cogs.shared.announce import announce_channel
from domain import approval, earnings, market, market_events
from infra import logthrottle
from infra.clock import utc_offset_hours


def price(bot, symbol: str = market.DEFAULT) -> float:
    latest = bot.economy.market_latest(symbol)
    if latest is None:
        start = market.BY_KEY[symbol].start
        bot.economy.market_set(time.time(), start, 0, symbol)
        return start
    return latest[1]


def prices(bot) -> dict[str, float]:
    return {s.key: price(bot, s.key) for s in market.SYMBOLS}


def day_reference(bot, now: float) -> dict:
    """値幅制限の基準になる、約24時間前の価格 {銘柄: 価格}。履歴がまだ無い銘柄は含めない。"""
    out = {}
    for sym in market.SYMBOLS:
        hist = bot.economy.market_history(now - 86400, sym.key)
        if hist:
            out[sym.key] = hist[0][1]
    return out


def step_prices(bot, earnings_results: list, rng) -> tuple:
    """全銘柄の価格を1つ進めて、(新しい価格 {銘柄: 価格}, 有事の出来事) を返す。"""
    current = prices(bot)
    fair = {k: bot.economy.market_fair_get(k) or p for k, p in current.items()}
    last_ts = max((bot.economy.market_latest(k) or (0,))[0] for k in current)
    now = time.time()
    announced = bot.economy.event_step(now, rng)
    if announced is not None:
        print(
            f"ボラティリティ予告: {announced['symbol']} {market_events.LEAD_MIN}分後から{market_events.DURATION_MIN}分"
        )
    tz = utc_offset_hours(bot)
    bot.economy.earnings_ensure(now, tz)
    new_fair, event = market.next_prices(fair, rng, bot.economy.vol_multipliers(now))
    for r in bot.economy.earnings_release_due(now):
        hit = new_fair[r["symbol"]] * earnings.factor(r["direction"], r["size"])
        new_fair[r["symbol"]] = min(market.MAX_PRICE, max(market.MIN_PRICE, round(hit, 2)))
        earnings_results.append(r)
    ref = day_reference(bot, now)
    new = {k: round(v, 2) for k, v in market.limit_to_day(new_fair, ref).items()}
    pins = market.pin_states(new_fair, ref)
    ts = max(time.time(), last_ts + 0.001)
    for key, p in new.items():
        bot.economy.market_set(ts, p, event, key)
        bot.economy.market_fair_set(key, new_fair[key], pins.get(key, 0), ts)
    return new, event


async def earnings_posts(bot, earnings_results: list, *, announce_fn=announce_channel) -> None:
    """決算の予告（月曜9:00）と発表の結果を、各サーバーの告知チャンネルに投稿する。"""
    now = time.time()
    embeds = [earnings_announce_embed(r) for r in bot.economy.earnings_to_announce(now)]
    results, earnings_results[:] = list(earnings_results), []
    for r in results:
        embeds.append(earnings_result_embed(r, bot.economy.market_pin(r["symbol"])))
    if not embeds:
        return
    for guild in list(bot.guilds):
        if not approval.is_allowed(bot.economy, bot.config, guild.id, 0):
            continue
        channel = announce_fn(guild, bot.economy.for_guild(guild.id))
        if channel is None:
            continue
        for embed in embeds:
            try:
                await ui.send_channel(channel, embed=embed, allowed_mentions=discord.AllowedMentions.none())
            except discord.HTTPException as exc:
                logthrottle.warn(("earnings-post", guild.id), f"決算の投稿に失敗: guild={guild.id}: {exc!r}")


async def refresh_post(cog, post: dict, now: float, cache: dict) -> None:
    """出したチャートを、最新に書き換える。時間が来たら、最後に1回だけ書き換えて、更新を終える。"""
    ends = post["ts"] + LIVE_MINUTES * 60
    expired = now >= ends or post["guild_id"] <= 0
    channel = cog.bot.get_channel(post["channel_id"])
    if channel is None:
        if expired or cog.bot.get_guild(post["guild_id"]) is None:
            cog.bot.economy.end_chart_post(post["channel_id"])
        return
    if post["guild_id"] > 0:
        key = (post["guild_id"], post["period"], post["symbol"], expired, int(ends // 60))
        if key not in cache:
            cache[key] = cog.chart_embed(
                post["period"],
                guild_id=post["guild_id"],
                live_until=None if expired else ends,
                ended=expired,
                symbol=post["symbol"],
            )
        try:
            await ui.partial_message(channel, post["message_id"]).edit(embed=cache[key])
        except discord.NotFound:
            cog.bot.economy.delete_chart_post(post["channel_id"])
            return
        except discord.HTTPException as exc:
            logthrottle.warn(
                ("chart", post["channel_id"]), f"チャートを更新できません: channel={post['channel_id']}: {exc!r}"
            )
    if expired:
        cog.bot.economy.end_chart_post(post["channel_id"])


async def retire_old_boards(bot) -> None:
    """廃止した「チャート掲示」が残っていれば、メッセージを消して、設定も捨てる（1回だけ）。"""
    for board in bot.economy.list_chart_boards():
        channel = bot.get_channel(board["channel_id"])
        if channel is not None:
            try:
                await ui.partial_message(channel, board["message_id"]).delete()
            except discord.HTTPException as exc:
                logthrottle.warn(
                    ("chart-board", board["guild_id"]),
                    f"廃止したチャート掲示を消せません: guild={board['guild_id']}: {exc!r}",
                )
        bot.economy.delete_chart_board(board["guild_id"])
