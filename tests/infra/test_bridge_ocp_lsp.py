"""Bridge パターンにおける OCP・ISP・LSP 準拠を検証する単体テスト。"""

import asyncio
from types import SimpleNamespace

import discord
import pytest

from cogs.shared.bridges import (
    BotBridges,
    DeferredShopTitleBridge,
    IApprovalBridge,
    IEventAdminBridge,
    IHorseAdminBridge,
    IHorseButtonBridge,
    IP2PListingBridge,
    IP2PNavigationBridge,
    IQuizAdminBridge,
    IQuizButtonBridge,
    IShopTitleBridge,
    NoOpApprovalBridge,
    NoOpHorseButtonBridge,
    NoOpLoanButtonBridge,
    NoOpQuizButtonBridge,
    NoOpShopTitleBridge,
)
from domain import teiai
from domain.ports.bridges import (
    CompositeAssetCollector,
    CompositeAssetSeizureStep,
    CompositeBankruptPrepHook,
    CompositeGraceEnterHook,
    CompositeLiquidationStep,
    CompositeSeizureValueStep,
    CompositeValuationSource,
    IAssetSeizureStep,
    IBankruptPrepHook,
    IGraceEnterHook,
    ILiquidationStep,
    ISeizureValueStep,
    IValuationSource,
)
from infra.db import schema
from infra.db.account import AccountCore
from infra.db.assets import ValuationSourceCollector
from infra.db.bank import BankRepo
from infra.db.base import EcoDb
from infra.db.bonds import BondRepo
from infra.db.crypto import CryptoRepo
from infra.db.debt import DebtRepo
from infra.db.earnings import EarningsRepo
from infra.db.guild import GuildRepo
from infra.db.lazy_bridges import LazyAssetSeizureStep, LazyStatusReader
from infra.db.loans import LoanRepo
from infra.db.margin import MarginRepo
from infra.db.market import MarketDataRepo
from infra.db.market_events import MarketEventRepo
from infra.db.options import OptionRepo
from tests.support import make_test_bot

G = 1
U = 100


def _make_standalone_db() -> EcoDb:
    db = EcoDb(":memory:")
    schema.migrate_to_guild_scope(db.conn, db.db_path, None)
    with db.tx():
        schema.create_tables(db.conn)
        schema.add_missing_columns(db.conn)
    return db


@pytest.mark.real_scope
def test_standalone_repos_run_with_default_noop_bridges_satisfying_lsp():
    """すべての DB リポジトリはオプショナルブリッジ未注入（既定 NoOp*）でも NotImplementedError を出さず LSP を満たす。"""
    db = _make_standalone_db()
    try:
        account = AccountCore(db)
        with db.tx():
            account.ensure(G, U)
            initial = account.raw_balance(G, U)
            assert initial > 0
            assert account.apply(G, U, 500, "test") == 500

        raw_bank = BankRepo(db, account)
        market = MarketDataRepo(db)
        market_events = MarketEventRepo(db)
        earnings = EarningsRepo(db, account, raw_bank)

        bank = raw_bank.for_guild(G)
        debt = DebtRepo(db, account).for_guild(G)
        loans = LoanRepo(db, account).for_guild(G)
        bonds = BondRepo(db, account, raw_bank).for_guild(G)
        crypto = CryptoRepo(db, account, market, raw_bank).for_guild(G)
        margin = MarginRepo(db, account, market, raw_bank).for_guild(G)
        options = OptionRepo(db, account, market, market_events, earnings, raw_bank).for_guild(G)
        guild_repo = GuildRepo(db).for_guild(G)

        deposit_amt = max(200, teiai.BANK_MIN_DEPOSIT)
        with db.tx():
            account.apply(G, U, deposit_amt, "fund-deposit")
        assert bank.bank_deposit(U, deposit_amt)[0] is True
        bank_totals: dict[int, int] = {}
        bank.collect_values(G, bank_totals)
        assert bank_totals[U] == deposit_amt

        with db.tx():
            account.apply(G, U, -account.raw_balance(G, U), "drain")
            assert debt.owe_for(G, U, 100, "test-debt") == 100
        assert debt.bankrupt(U)[0] is True

        assert loans.loan_due_soon(1000.0) == []
        assert isinstance(loans.loan_credit(U)["status"], str)
        assert bonds.bond_values() == {}
        assert crypto.crypto_values() == {}
        assert crypto.crypto_sell(U, 1, 100.0).ok is False
        assert margin.margin_equity() == {}
        assert margin.margin_ratio_for(G, U) is None
        assert options.option_values() == {}
        assert guild_repo.status_nick_targets() == [U]
    finally:
        db.close()


def test_persistence_composites_and_valuation_collector_support_open_extension():
    """Composite* と ValuationSourceCollector は既存実装を変更せず新種ステップ・評価源を拡張できる（OCP）。"""

    class CustomSource(IValuationSource):
        def collect_values(self, guild_id: int, totals: dict[int, int]) -> None:
            totals[U] = totals.get(U, 0) + 777

    composed_source = CompositeValuationSource((CustomSource(),))
    totals: dict[int, int] = {}
    composed_source.collect_values(G, totals)
    assert totals == {U: 777}

    parts: dict[tuple[int, str], int] = {}

    def add_part(uid: int, key: str, value: int) -> None:
        parts[(uid, key)] = parts.get((uid, key), 0) + value

    collector = CompositeAssetCollector((ValuationSourceCollector("custom_token", composed_source),))
    collector.collect(G, add_part, 0.0)
    assert parts == {(U, "custom_token"): 777}

    calls: list[str] = []

    class HookA(IGraceEnterHook):
        def on_grace_enter(self, guild_id: int, user_id: int, now: float) -> None:
            calls.append(f"hook:{guild_id}:{user_id}")

    class PrepA(IBankruptPrepHook):
        def prepare(self, guild_id: int, user_id: int, now: float) -> None:
            calls.append(f"prep:{guild_id}:{user_id}")

    class SeizeA(IAssetSeizureStep):
        def seize(self, guild_id: int, user_id: int, need: int, reason: str, now: float) -> int:
            return min(need, 120)

    class SeizeB(IAssetSeizureStep):
        def seize(self, guild_id: int, user_id: int, need: int, reason: str, now: float) -> int:
            return min(need, 80)

    class LiqA(ILiquidationStep):
        def liquidate(self, guild_id: int, user_id: int, now: float) -> None:
            calls.append(f"liq:{guild_id}:{user_id}")

    class ValA(ISeizureValueStep):
        def seize(self, guild_id: int, user_id: int, now: float) -> int:
            return 10

    class ValB(ISeizureValueStep):
        def seize(self, guild_id: int, user_id: int, now: float) -> int:
            return 20

    CompositeGraceEnterHook((HookA(),)).on_grace_enter(G, U, 123.0)
    CompositeBankruptPrepHook((PrepA(),)).prepare(G, U, 123.0)
    CompositeLiquidationStep((LiqA(),)).liquidate(G, U, 123.0)
    assert calls == [f"hook:{G}:{U}", f"prep:{G}:{U}", f"liq:{G}:{U}"]
    assert CompositeAssetSeizureStep((SeizeA(), SeizeB())).seize(G, U, 500, "test", 0.0) == 200
    assert CompositeSeizureValueStep((ValA(), ValB())).seize(G, U, 0.0) == 30

    resolved_seize = SeizeA()
    lazy_seize = LazyAssetSeizureStep(lambda: resolved_seize)
    assert lazy_seize.seize(G, U, 500, "test", 0.0) == 120

    lazy_db = _make_standalone_db()
    try:
        lazy_status = LazyStatusReader(lambda: DebtRepo(lazy_db, AccountCore(lazy_db)))
        assert isinstance(lazy_status.status_for(G, U), str)
    finally:
        lazy_db.close()


def test_bot_bridges_is_open_for_new_contracts_and_enforces_nominal_types():
    """BotBridges は本体修正なしで新規契約クラスを登録・解決でき（OCP）、契約継承違反は即座に検出する。"""

    class ICustomFeatureBridge:
        def ping(self) -> str:
            raise NotImplementedError

    class CustomFeature(ICustomFeatureBridge):
        def ping(self) -> str:
            return "pong"

    bridges = BotBridges()
    impl = CustomFeature()
    bridges.register(ICustomFeatureBridge, impl)
    assert bridges.has(ICustomFeatureBridge)
    resolved = bridges.resolve(ICustomFeatureBridge)
    assert resolved is impl and resolved.ping() == "pong"

    with pytest.raises(TypeError):
        bridges.register(ICustomFeatureBridge, SimpleNamespace(ping=lambda: "bad"))  # type: ignore[arg-type]


def test_deferred_and_dynamic_cog_bridges_are_load_order_independent(tmp_path):
    """ShopCog・P2PCog・EventCog 等のロード順序に依存せず、後から登録されたブリッジを動的解決できる。"""
    from cogs.admin.cog import ApprovalCog
    from cogs.economy.cog import EconomyCog
    from cogs.event.cog import EventCog
    from cogs.p2p.cog import P2PCog
    from cogs.shop.cog import ShopCog
    from cogs.weekly.cog import WeeklyCog

    bot = make_test_bot(db_path=str(tmp_path / "order.db"))
    eco = EconomyCog(
        bot,
        config=bot.config,
        economy_svc=bot.services.economy,
        wallet=bot.repos.wallet,
        records=bot.repos.records,
        bank=bot.repos.bank,
        debt=bot.repos.debt,
        loans=bot.repos.loans,
        shop_repo=bot.repos.shop,
        notices=bot.repos.notices,
        crypto=bot.repos.crypto,
        bonds_repo=bot.repos.bonds,
        assets=bot.repos.assets,
        guild_repo=bot.repos.guild,
        sessions=bot.sessions,
        clock=bot.services.clock,
    )
    weekly = WeeklyCog(
        bot,
        bot.config,
        bot.services.economy,
        bot.repos.records,
        bot.repos.guild,
        clock=bot.services.clock,
    )
    shop_cog = ShopCog(bot, bot.config, bot.services.shop, bot.repos.guild, bot.sessions)
    approval = ApprovalCog(
        bot,
        config=bot.config,
        guild_repo=bot.repos.guild,
        wallet=bot.repos.wallet,
        rtp=bot.repos.rtp,
        pachinko=bot.repos.pachinko,
        quiz_repo=bot.repos.quiz,
        labor_svc=bot.services.labor,
    )

    # 未登録時は NoOp へ安全にフォールバックし、後から登録されると実体を解決する
    assert isinstance(eco._shop_bridge, DeferredShopTitleBridge)
    assert asyncio.run(eco._shop_bridge.sync_title_nick(U)) == ("", 0)
    assert asyncio.run(weekly._shop_bridge.sync_title_nick(U)) == ("", 0)
    assert shop_cog.p2p_bridge() is None
    assert approval.event_bridge() is None

    sync_calls: list[int] = []

    class StubShop(IShopTitleBridge):
        async def sync_title_nick(self, user_id, here=None, member=None):
            sync_calls.append(user_id)
            return ("", 1)

        async def after_bankruptcy(self, guild, member):
            return None

    p2p_cog = P2PCog(bot, bot.config, bot.services.p2p, bot.repos.guild, bot.sessions)
    event_cog = EventCog(bot, bot.config, bot.repos.events, bot.repos.guild, bot.services.clock)

    bot.bridges.register(IShopTitleBridge, StubShop())
    bot.bridges.register(IP2PListingBridge, p2p_cog)
    bot.bridges.register(IP2PNavigationBridge, p2p_cog)
    bot.bridges.register(IEventAdminBridge, event_cog)

    assert asyncio.run(eco._shop_bridge.sync_title_nick(U)) == ("", 1)
    assert asyncio.run(weekly._shop_bridge.sync_title_nick(U)) == ("", 1)
    assert sync_calls == [U, U]
    assert shop_cog.p2p_bridge() is p2p_cog
    assert approval.event_bridge() is event_cog

    # アンロード時に自身の登録だけを解除できる
    bot.bridges.unregister(IEventAdminBridge, event_cog)
    assert approval.event_bridge() is None


def test_cog_bridge_isp_splits_and_noop_buttons_follow_lsp():
    """ISP 分割後の最小契約だけを実装したスタブが正常に動作し、NoOp* も例外を出さない。"""
    from cogs.horse.cards import RaceButton
    from cogs.loan.cog import LoanButton
    from cogs.quiz.views import PublicButton

    bridges = BotBridges()
    client = SimpleNamespace(bridges=bridges)
    interaction = SimpleNamespace(client=client, user=SimpleNamespace(id=1), guild_id=G)

    # 未登録時の NoOp フォールバックが安全に完了する
    asyncio.run(RaceButton("card", 1).callback(interaction))  # type: ignore[arg-type]
    asyncio.run(PublicButton(1, 0).callback(interaction))  # type: ignore[arg-type]
    asyncio.run(LoanButton("accept", 1).callback(interaction))  # type: ignore[arg-type]

    # ISP: HorseButton と QuizButton は管理メソッドを要求しない
    horse_clicks: list[tuple[str, int]] = []
    quiz_clicks: list[tuple[int, int]] = []

    class OnlyHorseButton(IHorseButtonBridge):
        async def handle_button(self, interaction: discord.Interaction, action: str, race_id: int) -> None:
            horse_clicks.append((action, race_id))

    class OnlyQuizButton(IQuizButtonBridge):
        async def handle_button(self, interaction: discord.Interaction, quiz_id: int, pos: int) -> None:
            quiz_clicks.append((quiz_id, pos))

    bridges.register(IHorseButtonBridge, OnlyHorseButton())
    bridges.register(IQuizButtonBridge, OnlyQuizButton())
    assert not bridges.has(IHorseAdminBridge)
    assert not bridges.has(IQuizAdminBridge)

    asyncio.run(RaceButton("bet", 42).callback(interaction))  # type: ignore[arg-type]
    asyncio.run(PublicButton(7, 2).callback(interaction))  # type: ignore[arg-type]
    assert horse_clicks == [("bet", 42)]
    assert quiz_clicks == [(7, 2)]

    # 全 NoOp クラスの直接呼び出しも LSP 準拠
    guild = SimpleNamespace(id=G)
    member = SimpleNamespace(id=U)
    assert asyncio.run(NoOpApprovalBridge().ensure_requested(guild)) is None  # type: ignore[arg-type]
    assert asyncio.run(NoOpApprovalBridge().announce_approved(guild)) is None  # type: ignore[arg-type]
    assert asyncio.run(NoOpApprovalBridge().handle_button(interaction, True, G)) is None  # type: ignore[arg-type]
    assert asyncio.run(NoOpShopTitleBridge().after_bankruptcy(guild, member)) is None  # type: ignore[arg-type]
    assert asyncio.run(NoOpHorseButtonBridge().handle_button(interaction, "card", 1)) is None  # type: ignore[arg-type]
    assert asyncio.run(NoOpQuizButtonBridge().handle_button(interaction, 1, 0)) is None  # type: ignore[arg-type]
    assert asyncio.run(NoOpLoanButtonBridge().handle_button(interaction, "cancel", 1)) is None  # type: ignore[arg-type]
    assert not bridges.has(IApprovalBridge)
