"""/会社 の Cog と画面: 設立の告知・状況パネルのボタン・倒産の告知。"""

import asyncio
from types import SimpleNamespace

import pytest

from cogs.company import cog as company_cog
from cogs.company import views
from domain import company as co
from tests.fakes import as_bot, as_interaction, invoke, must
from tests.support import make_test_bot

U = 1
DAY = 86400
NOON = co.day_start("2026-11-17") + DAY / 2


class _Resp:
    def __init__(self, owner):
        self.owner = owner

    async def send_message(self, *a, **kw):
        self.owner.sent.append({**kw, "content": a[0]} if a else kw)

    async def edit_message(self, **kw):
        self.owner.edited.append(kw)

    async def send_modal(self, modal):
        self.owner.modals.append(modal)


class _It:
    def __init__(self, uid, guild_id=0, values=None):
        self.user = SimpleNamespace(id=uid, mention=f"<@{uid}>")
        self.guild_id = guild_id
        self.guild = SimpleNamespace(id=guild_id)
        self.data = {"values": values or []}
        self.sent, self.edited, self.modals = [], [], []
        self.response = _Resp(self)


class Chan:
    def __init__(self):
        self.sent = []

    def permissions_for(self, _):
        return SimpleNamespace(view_channel=True, send_messages=True, embed_links=True)

    async def send(self, *a, **kw):
        self.sent.append(kw)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    bot = make_test_bot(str(tmp_path / "t.db"))
    chan = Chan()
    guild = SimpleNamespace(id=0, me=object(), system_channel=chan, get_channel=lambda cid: chan, name="g")
    bot.guilds = [guild]
    monkeypatch.setattr("domain.approval.is_allowed", lambda *a: True)
    now = [NOON]
    monkeypatch.setattr(company_cog.time, "time", lambda: now[0])
    monkeypatch.setattr(views.time, "time", lambda: now[0])
    cog = company_cog.CompanyCog(as_bot(bot), bot.config, bot.repos.company, bot.repos.guild)
    bot.repos.wallet.credit(U, 5_000_000, "テスト")
    return bot.repos, chan, guild, cog, now


def button(panel, label):
    return next(c for c in panel.children if getattr(c, "label", "") and label in c.label)


def test_found_command_creates_the_company_and_announces_it(setup):
    repos, chan, guild, cog, now = setup
    it = _It(U)
    asyncio.run(invoke(cog.found, cog, it, "帝愛商事", SimpleNamespace(value="farm")))
    assert "設立しました" in it.sent[0]["embed"].title and "帝愛商事" in it.sent[0]["embed"].description
    assert repos.company.company_get(U, now[0])["kind"] == "farm"
    again = _It(U)
    asyncio.run(invoke(cog.found, cog, again, "二社目", SimpleNamespace(value="mine")))
    assert "設立できません" in again.sent[0]["embed"].title and again.sent[0]["ephemeral"]


def test_status_shows_a_guide_without_buttons_when_there_is_no_company(setup):
    repos, chan, guild, cog, now = setup
    it = _It(U)
    asyncio.run(invoke(cog.status, cog, it))
    assert "設立" in it.sent[0]["embed"].description and it.sent[0]["view"].children == []


def test_panel_buttons_ship_invest_upgrade_and_change_kind(setup):
    repos, chan, guild, cog, now = setup
    repos.company.company_found(U, "帝愛商事", "mine", now[0])
    now[0] += DAY / 4
    panel = views.CompanyPanel(repos.company, U, 0)
    assert "帝愛商事" in must(panel.embed().title)

    it = _It(U)
    asyncio.run(button(panel, "出荷").callback(as_interaction(it)))
    assert "出荷しました" in it.edited[0]["embed"].description
    assert repos.company.company_get(U, now[0])["funds"] > 0

    it = _It(U)
    asyncio.run(button(panel, "出資").callback(as_interaction(it)))
    modal = it.modals[0]
    modal.amount._value = "1,000,000"
    it2 = _It(U)
    asyncio.run(modal.on_submit(it2))
    assert "出資しました" in it2.edited[0]["embed"].description
    modal.amount._value = "abc"
    it3 = _It(U)
    asyncio.run(modal.on_submit(it3))
    assert "金額が正しくありません" in it3.sent[0]["embed"].title

    it = _It(U)
    asyncio.run(button(panel, "増築").callback(as_interaction(it)))
    assert "Lv2" in it.edited[0]["embed"].description and repos.company.company_get(U, now[0])["level"] == 2

    it = _It(U)
    asyncio.run(button(panel, "種類を変える").callback(as_interaction(it)))
    kind_view = it.sent[0]["view"]
    it2 = _It(U, values=["farm"])
    asyncio.run(kind_view.children[0].callback(it2))
    assert "建て直しました" in it2.edited[0]["embed"].title
    assert repos.company.company_get(U, now[0])["kind"] == "farm"


def test_panel_rejects_other_users_and_reports_failures(setup):
    repos, chan, guild, cog, now = setup
    repos.company.company_found(U, "帝愛商事", "mine", now[0])
    panel = views.CompanyPanel(repos.company, U, 0)
    stranger = _It(2)
    assert asyncio.run(panel.interaction_check(as_interaction(stranger))) is False
    assert "他の人の会社" in stranger.sent[0]["content"]
    it = _It(U)
    asyncio.run(button(panel, "増築").callback(as_interaction(it)))  # 会社資金が無い
    assert "できません" in it.sent[0]["embed"].title and "会社資金が足りません" in it.sent[0]["embed"].description


def test_run_once_announces_a_bankruptcy(setup):
    repos, chan, guild, cog, now = setup
    repos.company.company_found(U, "帝愛商事", "mine", now[0])
    now[0] += 3 * DAY
    asyncio.run(cog.run_once())
    assert "倒産" in chan.sent[0]["embed"].title and "帝愛商事" in chan.sent[0]["embed"].description
    assert repos.company.company_get(U, now[0]) is None
    asyncio.run(cog.run_once())
    assert len(chan.sent) == 1  # 同じ倒産を、二度は告知しない
