"""地下闘技場の cog: 定時の進行（準決勝→決勝→優勝）の告知と、賭けパネル。1on1・バトロワを両方開催する。"""

import asyncio
import datetime
from types import SimpleNamespace

import pytest

from cogs.arena import cog as arena_cog
from cogs.arena import views
from domain import arena as a
from infra.db.economy import Economy

U, V = 1, 2
JST = datetime.timezone(datetime.timedelta(hours=9))


def jst(hour: float) -> float:
    """2026-11-16のJSTでその時刻にあたるエポック秒。"""
    base = datetime.datetime(2026, 11, 16, tzinfo=JST)
    return (base + datetime.timedelta(hours=hour)).timestamp()


DAY_START = jst(1.0)  # JSTで1時


class Msg:
    def __init__(self, channel):
        self.id, self.channel = 1, channel
        self.edits = []

    async def edit(self, **kw):
        self.edits.append(kw)


class Chan:
    id = 55

    def __init__(self):
        self.sent = []

    async def send(self, **kw):
        self.sent.append(kw)
        return Msg(self)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    eco = Economy(str(tmp_path / "t.db"))
    chan = Chan()
    guild = SimpleNamespace(id=0, me=object(), system_channel=chan, get_channel=lambda cid: chan, name="g")
    bot = SimpleNamespace(economy=SimpleNamespace(for_guild=lambda gid: eco), config={}, guilds=[guild])
    monkeypatch.setattr(arena_cog.approval, "is_allowed", lambda *a: True)
    monkeypatch.setattr("cogs.arena.cog.announce_channel", lambda g, e: chan)

    async def nap(_):
        return None

    monkeypatch.setattr(arena_cog.asyncio, "sleep", nap)
    return eco, chan, guild, bot, arena_cog.ArenaCog(bot)


def _at(monkeypatch, now):
    monkeypatch.setattr("cogs.arena.cog.time.time", lambda: now)


def embed_titles(chan):
    return [s["embed"].title for s in chan.sent if s.get("embed") is not None]


def test_run_once_creates_both_formats_and_announces_each(setup, monkeypatch):
    eco, chan, guild, bot, cog = setup
    _at(monkeypatch, DAY_START)  # 1時: 大会は作られるが、準決勝はまだ
    asyncio.run(cog.run_once())
    contents = [s["content"] for s in chan.sent if "content" in s]
    assert any("1on1" in c and "始まりました" in c for c in contents)
    assert any("バトルロイヤル" in c and "始まりました" in c for c in contents)
    duel = eco.arena_tournament_get_by_day(eco._arena_today(DAY_START), "duel")
    royale = eco.arena_tournament_get_by_day(eco._arena_today(DAY_START), "royale")
    assert duel["status"] == "semi_betting" and royale["status"] == "semi_betting"


def test_run_once_advances_both_formats_through_semis_and_final(setup, monkeypatch):
    eco, chan, guild, bot, cog = setup
    _at(monkeypatch, DAY_START)
    asyncio.run(cog.run_once())

    _at(monkeypatch, jst(a.SEMI_HOUR + 1))  # 準決勝の時刻を過ぎた
    asyncio.run(cog.run_once())
    day = eco._arena_today(DAY_START)
    duel = eco.arena_tournament_get_by_day(day, "duel")
    royale = eco.arena_tournament_get_by_day(day, "royale")
    assert duel["status"] == "final_betting" and royale["status"] == "final_betting"
    titles = embed_titles(chan)
    assert titles.count("🏛️ 準決勝、決着！") == 2  # 1on1・バトロワそれぞれ1回
    assert any("開戦！" in t for t in titles)  # 演出も投稿している
    asyncio.run(cog.run_once())  # 2回目は、もう準決勝を走らせない（status は変わらない）
    assert eco.arena_tournament_get_by_day(day, "duel")["status"] == "final_betting"

    _at(monkeypatch, jst(a.FINAL_HOUR + 1))  # 決勝の時刻を過ぎた
    asyncio.run(cog.run_once())
    assert eco.arena_tournament_get_by_day(day, "duel")["status"] == "done"
    assert eco.arena_tournament_get_by_day(day, "royale")["status"] == "done"
    assert embed_titles(chan).count("👑 決勝、決着！") == 2


def test_run_once_does_not_re_announce_after_a_bot_restart(setup, monkeypatch):
    eco, chan, guild, bot, cog = setup
    _at(monkeypatch, DAY_START)
    asyncio.run(cog.run_once())
    assert len(chan.sent) == 2  # 1on1・バトロワ、それぞれ1件ずつの告知
    cog2 = arena_cog.ArenaCog(bot)  # Bot再起動相当（_panels等はリセットされる）
    _at(monkeypatch, jst(2.0))  # 再起動は、少し時間が経ってから
    asyncio.run(cog2.run_once())
    assert len(chan.sent) == 2  # 再起動後、同じ大会をもう一度告知しない


def test_host_now_creates_and_posts_without_waiting_for_the_scheduled_hour(setup, monkeypatch):
    eco, chan, guild, bot, cog = setup
    _at(monkeypatch, jst(3.0))  # 準決勝の時刻(SEMI_HOUR)より前
    status = asyncio.run(cog.host_now(guild, None, advance=False, fmt="duel"))
    assert status == "🥊 1on1: 準決勝・受付中"
    assert "今日の🥊 1on1の大会です" in chan.sent[0]["content"]
    t = eco.arena_tournament_get_by_day(eco._arena_today(jst(3.0)), "duel")
    assert t is not None and t["status"] == "semi_betting"  # まだ決着させていない


def test_host_now_with_no_format_handles_both(setup, monkeypatch):
    eco, chan, guild, bot, cog = setup
    _at(monkeypatch, jst(3.0))
    status = asyncio.run(cog.host_now(guild, None, advance=False))
    assert "1on1" in status and "バトルロイヤル" in status
    assert len(chan.sent) == 2


def test_host_now_with_advance_settles_the_current_stage_right_away(setup, monkeypatch):
    eco, chan, guild, bot, cog = setup
    _at(monkeypatch, jst(3.0))  # 準決勝の時刻より前でも、advance なら決着させる
    status = asyncio.run(cog.host_now(guild, None, advance=True, fmt="duel"))
    assert status == "🥊 1on1: 終了"  # 準決勝・決勝とも、間を置かず決着させる
    titles = embed_titles(chan)
    assert "🏛️ 準決勝、決着！" in titles
    assert "👑 決勝、決着！" in titles
    assert any("開戦！" in t for t in titles)


def test_bet_panel_select_and_stake_modal_place_a_real_bet(setup, monkeypatch):
    eco, chan, guild, bot, cog = setup
    eco.credit(V, 10_000, "テスト")
    _at(monkeypatch, DAY_START)
    t = eco.arena_tournament_ensure("duel", DAY_START)
    panel = views.BetPanel(bot, t)
    bettable = views.bettable_fighters(t)
    assert bettable  # 受付中なら、賭けられる戦士がいる
    fighter = bettable[0]
    modal = views.StakeModal(panel, fighter)
    modal.stake._value = "500"
    before = eco.balance(V)

    sent = []

    class Resp:
        async def send_message(self, **kw):
            sent.append(kw)

    it = SimpleNamespace(guild=guild, guild_id=0, user=SimpleNamespace(id=V), response=Resp())
    asyncio.run(modal.on_submit(it))
    assert eco.balance(V) == before - 500
    assert "賭けました" in sent[0]["embed"].title


def test_bet_panel_has_no_select_once_betting_is_closed(setup):
    eco, chan, guild, bot, cog = setup
    t = eco.arena_tournament_ensure("duel", DAY_START)
    eco.arena_run_semis(t["id"])
    t = eco.arena_tournament_get_by_day(t["day"], "duel")
    assert views.bettable_fighters(t)  # 決勝の受付中は、決勝進出の2人に賭けられる
    panel = views.BetPanel(bot, t)
    assert len(panel.children) == 1  # Select が1つだけ出る


class FakeMessage:
    def __init__(self):
        self.edits = []

    async def edit(self, **kw):
        self.edits.append(kw)


def test_stake_modal_bet_refreshes_the_posted_panel_message(setup):
    eco, chan, guild, bot, cog = setup
    eco.credit(V, 10_000, "テスト")
    t = eco.arena_tournament_ensure("duel", DAY_START)
    panel = views.BetPanel(bot, t)
    panel.message = FakeMessage()
    fighter = views.bettable_fighters(t)[0]
    modal = views.StakeModal(panel, fighter)
    modal.stake._value = "500"

    class Resp:
        async def send_message(self, **kw):
            pass

    it = SimpleNamespace(guild=guild, guild_id=0, user=SimpleNamespace(id=V), response=Resp())
    asyncio.run(modal.on_submit(it))
    assert len(panel.message.edits) == 1  # 賭けた直後に、掲示を書き換えている
    assert f"{fighter['name']}" in panel.message.edits[0]["embed"].description


def test_tournament_embed_shows_who_bet_how_much_on_each_fighter(setup):
    eco, chan, guild, bot, cog = setup
    eco.credit(U, 10_000, "テスト")
    eco.credit(V, 10_000, "テスト")
    t = eco.arena_tournament_ensure("duel", DAY_START)
    fighter = views.bettable_fighters(t)[0]
    eco.arena_bet(U, fighter["id"], 1_500, DAY_START)
    eco.arena_bet(V, fighter["id"], 700, DAY_START)
    panel = views.BetPanel(bot, eco.arena_tournament_get_by_day(t["day"], "duel"))
    desc = panel.embed().description
    assert f"<@{U}>" in desc and "1,500" in desc
    assert f"<@{V}>" in desc and "700" in desc


def test_run_once_refreshes_the_auto_posted_panel_after_semis(setup, monkeypatch):
    eco, chan, guild, bot, cog = setup
    _at(monkeypatch, DAY_START)
    asyncio.run(cog.run_once())
    day = eco._arena_today(DAY_START)
    panel = cog._panels[(guild.id, day, "duel")]
    refreshed = []
    orig_refresh = panel.refresh

    async def spy():
        refreshed.append(True)
        await orig_refresh()

    panel.refresh = spy
    _at(monkeypatch, jst(a.SEMI_HOUR + 1))
    asyncio.run(cog.run_once())
    assert refreshed == [True]
