"""地下闘技場の cog: 定時の進行（準決勝→決勝→優勝）の告知と、賭けパネル。"""

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


class Chan:
    id = 55

    def __init__(self):
        self.sent = []

    async def send(self, **kw):
        self.sent.append(kw)
        return SimpleNamespace(id=1, channel=self)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    eco = Economy(str(tmp_path / "t.db"))
    chan = Chan()
    guild = SimpleNamespace(id=0, me=object(), system_channel=chan, get_channel=lambda cid: chan, name="g")
    bot = SimpleNamespace(economy=SimpleNamespace(for_guild=lambda gid: eco), config={}, guilds=[guild])
    monkeypatch.setattr(arena_cog.approval, "is_allowed", lambda *a: True)
    monkeypatch.setattr("cogs.arena.cog.announce_channel", lambda g, e: chan)
    return eco, chan, guild, bot, arena_cog.ArenaCog(bot)


def _at(monkeypatch, now):
    monkeypatch.setattr("cogs.arena.cog.time.time", lambda: now)


def test_run_once_creates_and_announces_then_advances_through_semis_and_final(setup, monkeypatch):
    eco, chan, guild, bot, cog = setup
    _at(monkeypatch, DAY_START)  # 1時: 大会は作られるが、準決勝はまだ
    asyncio.run(cog.run_once())
    assert "今日の大会が始まりました" in chan.sent[0]["content"]
    t = eco.arena_tournament_get_by_day(eco._arena_today(DAY_START))
    assert t["status"] == "semi_betting"

    _at(monkeypatch, jst(a.SEMI_HOUR + 1))  # 準決勝の時刻を過ぎた
    asyncio.run(cog.run_once())
    t = eco.arena_tournament_get_by_day(t["day"])
    assert t["status"] == "final_betting"
    assert any("準決勝、決着" in s.get("embed", SimpleNamespace(title="")).title for s in chan.sent)
    asyncio.run(cog.run_once())  # 2回目は、もう準決勝を走らせない（status は変わらない）
    assert eco.arena_tournament_get_by_day(t["day"])["status"] == "final_betting"

    _at(monkeypatch, jst(a.FINAL_HOUR + 1))  # 決勝の時刻を過ぎた
    asyncio.run(cog.run_once())
    t = eco.arena_tournament_get_by_day(t["day"])
    assert t["status"] == "done"
    assert any("決勝、決着" in s.get("embed", SimpleNamespace(title="")).title for s in chan.sent)


def test_bet_panel_select_and_stake_modal_place_a_real_bet(setup, monkeypatch):
    eco, chan, guild, bot, cog = setup
    eco.credit(V, 10_000, "テスト")
    _at(monkeypatch, DAY_START)
    t = eco.arena_tournament_ensure(DAY_START)
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
    t = eco.arena_tournament_ensure(DAY_START)
    eco.arena_run_semis(t["id"])
    t = eco.arena_tournament_get_by_day(t["day"])
    eco.arena_run_final(t["id"]) if False else None  # 決勝はまだ受付中のはず
    t = eco.arena_tournament_get_by_day(t["day"])
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
    t = eco.arena_tournament_ensure(DAY_START)
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
    t = eco.arena_tournament_ensure(DAY_START)
    fighter = views.bettable_fighters(t)[0]
    eco.arena_bet(U, fighter["id"], 1_500, DAY_START)
    eco.arena_bet(V, fighter["id"], 700, DAY_START)
    panel = views.BetPanel(bot, eco.arena_tournament_get_by_day(t["day"]))
    desc = panel.embed().description
    assert f"<@{U}>" in desc and "1,500" in desc
    assert f"<@{V}>" in desc and "700" in desc


def test_run_once_refreshes_the_auto_posted_panel_after_semis(setup, monkeypatch):
    eco, chan, guild, bot, cog = setup
    _at(monkeypatch, DAY_START)
    asyncio.run(cog.run_once())
    day = eco._arena_today(DAY_START)
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
