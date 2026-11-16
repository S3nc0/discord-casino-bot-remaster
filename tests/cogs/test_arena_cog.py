"""地下闘技場の cog: 定時の進行（準決勝→決勝→優勝）の告知と、賭けパネル。"""

import asyncio
import datetime
from types import SimpleNamespace

import pytest

from cogs.arena import cog as arena_cog
from cogs.arena import views
from domain import arena as a
from tests.support import make_arena_cog, make_test_bot

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
    bot = make_test_bot(str(tmp_path / "t.db"))
    chan = Chan()
    guild = SimpleNamespace(id=0, me=object(), system_channel=chan, get_channel=lambda cid: chan, name="g")
    bot.guilds = [guild]
    monkeypatch.setattr("domain.approval.is_allowed", lambda *a: True)
    monkeypatch.setattr("cogs.arena.cog.announce_channel", lambda g, e: chan)

    async def nap(_):
        return None

    monkeypatch.setattr(arena_cog.asyncio, "sleep", nap)
    cog = make_arena_cog(bot)
    try:
        yield bot.repos, chan, guild, bot, cog
    finally:
        bot.repos.close()


def _at(monkeypatch, now):
    monkeypatch.setattr("cogs.arena.cog.time.time", lambda: now)


def test_run_once_creates_and_announces_then_advances_through_semis_and_final(setup, monkeypatch):
    repos, chan, guild, bot, cog = setup
    _at(monkeypatch, DAY_START)  # 1時: 大会は作られるが、準決勝はまだ
    asyncio.run(cog.run_once())
    assert "今日の大会が始まりました" in chan.sent[0]["content"]
    t = repos.arena.arena_tournament_get_by_day(repos.arena.arena_today(DAY_START))
    assert t["status"] == "semi_betting"

    _at(monkeypatch, jst(a.SEMI_HOUR + 1))  # 準決勝の時刻を過ぎた
    asyncio.run(cog.run_once())
    t = repos.arena.arena_tournament_get_by_day(t["day"])
    assert t["status"] == "final_betting"
    assert any("準決勝、決着" in s.get("embed", SimpleNamespace(title="")).title for s in chan.sent)
    assert any("開戦！" in s.get("embed", SimpleNamespace(title="")).title for s in chan.sent)  # 演出も投稿している
    asyncio.run(cog.run_once())  # 2回目は、もう準決勝を走らせない（status は変わらない）
    assert repos.arena.arena_tournament_get_by_day(t["day"])["status"] == "final_betting"

    _at(monkeypatch, jst(a.FINAL_HOUR + 1))  # 決勝の時刻を過ぎた
    asyncio.run(cog.run_once())
    t = repos.arena.arena_tournament_get_by_day(t["day"])
    assert t["status"] == "done"
    assert any("決勝、決着" in s.get("embed", SimpleNamespace(title="")).title for s in chan.sent)


def test_bet_panel_select_and_stake_modal_place_a_real_bet(setup, monkeypatch):
    repos, chan, guild, bot, cog = setup
    repos.wallet.credit(V, 10_000, "テスト")
    _at(monkeypatch, DAY_START)
    t = repos.arena.arena_tournament_ensure(DAY_START)
    panel = views.BetPanel(repos.arena, t)
    bettable = views.bettable_fighters(t)
    assert bettable  # 受付中なら、賭けられる戦士がいる
    fighter = bettable[0]
    modal = views.StakeModal(panel, fighter)
    modal.stake._value = "500"
    before = repos.wallet.balance(V)

    sent = []

    class Resp:
        async def send_message(self, **kw):
            sent.append(kw)

    it = SimpleNamespace(guild=guild, guild_id=0, user=SimpleNamespace(id=V), response=Resp())
    asyncio.run(modal.on_submit(it))
    assert repos.wallet.balance(V) == before - 500
    assert "賭けました" in sent[0]["embed"].title


def test_bet_panel_has_no_select_once_betting_is_closed(setup):
    repos, chan, guild, bot, cog = setup
    t = repos.arena.arena_tournament_ensure(DAY_START)
    repos.arena.arena_run_semis(t["id"])
    t = repos.arena.arena_tournament_get_by_day(t["day"])
    assert views.bettable_fighters(t)  # 決勝の受付中は、決勝進出の2人に賭けられる
    panel = views.BetPanel(repos.arena, t)
    assert len(panel.children) == 1  # Select が1つだけ出る


class FakeMessage:
    def __init__(self):
        self.edits = []

    async def edit(self, **kw):
        self.edits.append(kw)


def test_stake_modal_bet_refreshes_the_posted_panel_message(setup):
    repos, chan, guild, bot, cog = setup
    repos.wallet.credit(V, 10_000, "テスト")
    t = repos.arena.arena_tournament_ensure(DAY_START)
    panel = views.BetPanel(repos.arena, t)
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
    repos, chan, guild, bot, cog = setup
    repos.wallet.credit(U, 10_000, "テスト")
    repos.wallet.credit(V, 10_000, "テスト")
    t = repos.arena.arena_tournament_ensure(DAY_START)
    fighter = views.bettable_fighters(t)[0]
    repos.arena.arena_bet(U, fighter["id"], 1_500, DAY_START)
    repos.arena.arena_bet(V, fighter["id"], 700, DAY_START)
    panel = views.BetPanel(repos.arena, repos.arena.arena_tournament_get_by_day(t["day"]))
    desc = panel.embed().description
    assert f"<@{U}>" in desc and "1,500" in desc
    assert f"<@{V}>" in desc and "700" in desc


def test_run_once_refreshes_the_auto_posted_panel_after_semis(setup, monkeypatch):
    repos, chan, guild, bot, cog = setup
    _at(monkeypatch, DAY_START)
    asyncio.run(cog.run_once())
    day = repos.arena.arena_today(DAY_START)
    panel = cog._panels[(guild.id, day)]
    refreshed = []
    orig_refresh = panel.refresh

    async def spy():
        refreshed.append(True)
        await orig_refresh()

    panel.refresh = spy
    _at(monkeypatch, jst(a.SEMI_HOUR + 1))
    asyncio.run(cog.run_once())
    assert refreshed == [True]
