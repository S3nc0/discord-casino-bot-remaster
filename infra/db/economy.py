"""ペリカの経済 Facade（Composition Root `RepositoryBundle` への薄い委譲アダプタ）。

Milestones B/C で上位層（`services/`・`cogs/`）を狭小ポート（`domain/ports/repos.py`）へ
コンストラクタ DI 移行する間の互換ラッパー。28-Mixin の多重継承は廃止済み。
"""

import datetime
import random
from typing import Any, Iterable, Optional, Self

from domain.earnings import MemoInfo
from domain.errors import Failure, Notice
from domain.market import DEFAULT
from domain.ports import IEconomy
from domain.types import (  # noqa: F401
    CONSUMABLE_EFFECTS,
    DAILY_BASE,
    DAILY_STREAK_BONUS,
    DAILY_STREAK_CAP,
    INITIAL_BALANCE,
    INSURANCE_CAP,
    CryptoResult,
    DailyResult,
    PurchaseResult,
    TransferResult,
)
from infra.db.horse import HorseRepo
from infra.db.labor import LaborRepo
from infra.db.margin import MarginRepo
from infra.db.p2p import P2PRepo
from infra.db.repositories import RepositoryBundle, open_repositories
from infra.db.shop import ShopRepo


class Economy:
    """単一責務リポジトリ束 `RepositoryBundle` を束ねる互換 Facade（IEconomy 実装）。"""

    DAILY_BASE = DAILY_BASE
    DAILY_STREAK_BONUS = DAILY_STREAK_BONUS
    DAILY_STREAK_CAP = DAILY_STREAK_CAP
    SLOTS = ShopRepo.SLOTS
    HORSE_PRICE = HorseRepo.HORSE_PRICE
    SHORT_LEVERAGES = MarginRepo.SHORT_LEVERAGES
    MARGIN_LEVERAGES = MarginRepo.MARGIN_LEVERAGES
    SIDE_NAME = MarginRepo.SIDE_NAME
    P2P_ORDERS = P2PRepo.P2P_ORDERS
    FINDS_KEEP = LaborRepo.FINDS_KEEP
    CLICK_LOG_DAYS = LaborRepo.CLICK_LOG_DAYS

    def __init__(self, db_path: str, legacy_guild_id: Optional[int] = None, strict: bool = False) -> None:
        self._repos: RepositoryBundle = open_repositories(db_path, legacy_guild_id=legacy_guild_id, strict=strict)
        self._bind_state(self._repos, 0, strict)

    def _bind_state(self, repos: RepositoryBundle, guild_id: int, strict: bool) -> None:
        self._repos = repos
        self._db = repos.db
        self._db_path = repos.db.db_path
        self._conn = repos.db.conn
        self._lock = repos.db.lock
        self.guild_id = guild_id
        self._strict = strict

    def for_guild(self, guild_id: int) -> Self:
        gid = int(guild_id)
        if gid <= 0:
            raise ValueError(f"サーバーIDが不正です: {guild_id!r}")
        view = type(self).__new__(type(self))
        view._bind_state(self._repos.for_guild(gid), gid, False)
        return view

    def _g(self) -> int:
        if self._strict and self.guild_id == 0:
            raise RuntimeError("サーバーが指定されていません。economy.for_guild(サーバーID) を通して使ってください。")
        return self.guild_id

    def close(self) -> None:
        self._repos.close()

    # ----------------------------- テスト互換ヘルパ ----------------------------- #
    def _apply(self, user_id: int, delta: int, reason: str, income: int = 0) -> int:
        return self._repos.account.apply(self._g(), user_id, delta, reason, income=income)

    def _balance(self, user_id: int) -> int:
        return self._repos.account.raw_balance(self._g(), user_id)

    def _owe(self, user_id: int, shortfall: int, reason: str) -> int:
        return self._repos.debt.owe_for(self._g(), user_id, shortfall, reason)

    def _after_debt_change(self, user_id: int) -> None:
        self._repos.debt.after_debt_change(self._g(), user_id)

    def _seize_assets(self, user_id: int, need: int, reason: str) -> int:
        return self._repos.debt._seize_assets_for(self._g(), user_id, need, reason)

    def _bank_sync(self, now: float) -> dict[str, float]:
        return self._repos.bank.bank_sync_for(self._g(), now)

    def _bank_set(self, cash: float, loaned: float) -> None:
        self._repos.bank.bank_set_for(self._g(), cash, loaned)

    def _bank_income(
        self, amount: int, share: float, now: Optional[float] = None, needs_depositors: bool = False
    ) -> None:
        self._repos.bank.bank_income_for(self._g(), amount, share, now=now, needs_depositors=needs_depositors)

    def _horse_count(self, user_id: int) -> int:
        return self._repos.horses.horse_count_for(self._g(), user_id)

    def _relic_buffs(self, user_id: int) -> dict[str, float]:
        return self._repos.relics.relic_buffs_for(self._g(), user_id)

    def _purge_unlistable_auctions(self) -> int:
        return self._repos.auction.purge_unlistable_auctions()

    def _crypto_sell_locked(
        self,
        user_id: int,
        units: Optional[int],
        price: float,
        symbol: str = DEFAULT,
        taxable: bool = False,
    ) -> CryptoResult:
        return self._repos.crypto.crypto_sell_locked_for(self._g(), user_id, units, price, symbol, taxable=taxable)

    def _margin_status_locked(
        self, user_id: int, prices: dict[str, Any], add: Optional[tuple[str, str, float, int]] = None
    ) -> dict[str, Any]:
        return self._repos.margin._margin_status_locked_for(self._g(), user_id, prices, add=add)

    def _margin_close_locked(
        self,
        user_id: int,
        side: str,
        units: Optional[int],
        price: float,
        label: str,
        symbol: str = DEFAULT,
        owe: bool = False,
        taxable: bool = False,
    ) -> CryptoResult:
        return self._repos.margin.margin_close_locked_for(
            self._g(), user_id, side, units, price, label, symbol, owe=owe, taxable=taxable
        )

    # ----------------------------- Notices ----------------------------- #
    def take_notices(self, user_id: int) -> list[Notice]:
        return self._repos.notices.take_notices(user_id)

    # ----------------------------- Wallet / Assets ----------------------------- #
    def balance(self, user_id: int) -> int:
        return self._repos.wallet.balance(user_id)

    def credit(self, user_id: int, amount: int, reason: str) -> int:
        return self._repos.wallet.credit(user_id, amount, reason)

    def set_balance(self, user_id: int, amount: int, reason: str) -> tuple[Any, ...]:
        return self._repos.wallet.set_balance(user_id, amount, reason)

    def debit_up_to(self, user_id: int, amount: int, reason: str) -> int:
        return self._repos.wallet.debit_up_to(user_id, amount, reason)

    def claim_daily(self, user_id: int, today: datetime.date, slot: Optional[int] = None) -> DailyResult:
        return self._repos.wallet.claim_daily(user_id, today, slot=slot)

    def touch_guild_user(self, guild_id: int, user_id: int) -> None:
        self._repos.wallet.touch_guild_user(guild_id, user_id)

    def guild_user_ids(self, guild_id: int) -> set[int]:
        return self._repos.wallet.guild_user_ids(guild_id)

    def wealthy_ids(self) -> set[int]:
        return self._repos.wallet.wealthy_ids()

    def display_status(self, user_id: int, wealthy: Optional[set[Any]] = None) -> str:
        return self._repos.wallet.display_status(user_id, wealthy=wealthy)

    def top(self, limit: int = 10, user_ids: Optional[set[Any]] = None) -> list[Any]:
        return self._repos.wallet.top(limit=limit, user_ids=user_ids)

    def rank_of(self, user_id: int, user_ids: Optional[set[Any]] = None) -> Optional[tuple[Any, ...]]:
        return self._repos.wallet.rank_of(user_id, user_ids=user_ids)

    def peek_stats(self, user_id: int) -> Optional[dict[str, Any]]:
        return self._repos.wallet.peek_stats(user_id)

    def stats(self, user_id: int) -> dict[str, Any]:
        return self._repos.wallet.stats(user_id)

    def history(self, user_id: int, limit: int = 10) -> list[Any]:
        return self._repos.wallet.history(user_id, limit=limit)

    def transfer(
        self,
        sender: int,
        receiver: int,
        amount: int,
        fee_rate: float,
        daily_limit: int,
        day_start_ts: float,
        min_games: int = 0,
    ) -> TransferResult:
        return self._repos.wallet.transfer(sender, receiver, amount, fee_rate, daily_limit, day_start_ts, min_games)

    def horse_worth(self, races: int, wins: int, places: int) -> int:
        return self._repos.assets.horse_worth(races, wins, places)

    def asset_parts(self, now: Optional[float] = None) -> dict[int, dict[str, int]]:
        return self._repos.assets.asset_parts(now=now)

    def final_assets(self, user_ids: Optional[set[Any]] = None, now: Optional[float] = None) -> list[Any]:
        return self._repos.assets.final_assets(user_ids=user_ids, now=now)

    def final_top(self, limit: int = 10, user_ids: Optional[set[Any]] = None) -> list[Any]:
        return self._repos.assets.final_top(limit=limit, user_ids=user_ids)

    def final_rank_of(self, user_id: int, user_ids: Optional[set[Any]] = None) -> Optional[tuple[Any, ...]]:
        return self._repos.assets.final_rank_of(user_id, user_ids=user_ids)

    # ----------------------------- Escrow / Casino / Records / Events / RTP / Pachinko ----------------------------- #
    def place_bet(self, user_id: int, amount: int, game: str) -> Optional[int]:
        return self._repos.escrow.place_bet(user_id, amount, game)

    def add_to_escrow(self, escrow_id: int, extra: int, credit: bool = False) -> bool:
        return self._repos.escrow.add_to_escrow(escrow_id, extra, credit=credit)

    def escrow_amount(self, escrow_id: int) -> int:
        return self._repos.escrow.escrow_amount(escrow_id)

    def settle(self, escrow_id: int, payout: int, game: str) -> Optional[int]:
        return self._repos.escrow.settle(escrow_id, payout, game)

    def settle_with_penalty(self, escrow_id: int, payout: int, game: str, penalty: int) -> Optional[tuple[Any, ...]]:
        return self._repos.escrow.settle_with_penalty(escrow_id, payout, game, penalty)

    def refund(self, escrow_id: int) -> bool:
        return self._repos.escrow.refund(escrow_id)

    def refund_all_escrows(self) -> int:
        return self._repos.escrow.refund_all_escrows()

    def record_play(
        self, user_id: int, game: str, bet: int, net: int, day: datetime.date, tags: Iterable[Any] = ()
    ) -> dict[str, Any]:
        return self._repos.records.record_play(user_id, game, bet, net, day, tags=tags)

    def mission_status(self, user_id: int, day: datetime.date) -> list[Any]:
        return self._repos.records.mission_status(user_id, day)

    def weekly_top(self, week: str, limit: int = 10) -> list[Any]:
        return self._repos.records.weekly_top(week, limit=limit)

    def weekly_rank(self, week: str, user_id: int) -> Optional[tuple[Any, ...]]:
        return self._repos.records.weekly_rank(week, user_id)

    def weekly_last_announced(self) -> Optional[str]:
        return self._repos.records.weekly_last_announced()

    def set_weekly_announced(self, week: str) -> None:
        self._repos.records.set_weekly_announced(week)

    def weekly_champion_count(self, user_id: int) -> int:
        return self._repos.records.weekly_champion_count(user_id)

    def weekly_award(self, week: str) -> Optional[dict[str, Any]]:
        return self._repos.records.weekly_award(week)

    def backfill_weekly(self, utc_offset_hours: float = 9) -> int:
        return self._repos.records.backfill_weekly(utc_offset_hours=utc_offset_hours)

    def play_summary(self, user_id: int) -> dict[str, Any]:
        return self._repos.records.play_summary(user_id)

    def win_streak(self, user_id: int) -> tuple[Any, ...]:
        return self._repos.records.win_streak(user_id)

    def rtp_level_get(self, game: str) -> int:
        return self._repos.rtp.rtp_level_get(game)

    def rtp_levels(self) -> dict[str, int]:
        return self._repos.rtp.rtp_levels()

    def rtp_level_set(self, game: Optional[str], level: int) -> list[str]:
        return self._repos.rtp.rtp_level_set(game, level)

    def event_phase(self, day: datetime.date) -> int:
        return self._repos.events.event_phase(day)

    def set_event_phase(self, day: datetime.date, phase: int) -> None:
        self._repos.events.set_event_phase(day, phase)

    def manual_event_start(self, game: str, boost_pct: int, starts: float, ends: float, channel_id: int = 0) -> None:
        self._repos.events.manual_event_start(game, boost_pct, starts, ends, channel_id=channel_id)

    def manual_event_get(self, now: float) -> Optional[dict[str, Any]]:
        return self._repos.events.manual_event_get(now)

    def manual_event_stop(self, now: float) -> Optional[dict[str, Any]]:
        return self._repos.events.manual_event_stop(now)

    def manual_event_finish_due(self, now: float) -> Optional[dict[str, Any]]:
        return self._repos.events.manual_event_finish_due(now)

    def pachinko_record_set(self, user_id: int, bet: int, balls: int, result: Any, now: Optional[float] = None) -> None:
        self._repos.pachinko.pachinko_record_set(user_id, bet, balls, result, now=now)

    def pachinko_stats(self, guild_id: Optional[int] = None, since: Optional[float] = None) -> dict[str, Any]:
        return self._repos.pachinko.pachinko_stats(guild_id=guild_id, since=since)

    # ----------------------------- Guild ----------------------------- #
    def set_guild_status(
        self, guild_id: int, status: str, name: Optional[str] = None, by: Optional[int] = None
    ) -> None:
        self._repos.guild.set_guild_status(guild_id, status, name=name, by=by)

    def get_guild_status(self, guild_id: int) -> Optional[dict[str, Any]]:
        return self._repos.guild.get_guild_status(guild_id)

    def list_guild_status(self) -> list[Any]:
        return self._repos.guild.list_guild_status()

    def mark_guild_notified(self, guild_id: int) -> None:
        self._repos.guild.mark_guild_notified(guild_id)

    def set_leaderboard(self, guild_id: int, channel_id: int, message_id: int) -> None:
        self._repos.guild.set_leaderboard(guild_id, channel_id, message_id)

    def get_leaderboard(self, guild_id: int) -> Optional[dict[str, Any]]:
        return self._repos.guild.get_leaderboard(guild_id)

    def list_leaderboards(self) -> list[Any]:
        return self._repos.guild.list_leaderboards()

    def delete_leaderboard(self, guild_id: int) -> None:
        self._repos.guild.delete_leaderboard(guild_id)

    def set_nick_pref(self, guild_id: int, user_id: int, enabled: bool) -> None:
        self._repos.guild.set_nick_pref(guild_id, user_id, enabled)

    def ensure_nick_row(self, guild_id: int, user_id: int) -> None:
        self._repos.guild.ensure_nick_row(guild_id, user_id)

    def nick_managed(self, guild_id: int, user_id: int) -> bool:
        return self._repos.guild.nick_managed(guild_id, user_id)

    def status_nick_targets(self) -> list[Any]:
        return self._repos.guild.status_nick_targets()

    def get_nick_state(self, guild_id: int, user_id: int) -> Any:
        return self._repos.guild.get_nick_state(guild_id, user_id)

    def set_nick_state(self, guild_id: int, user_id: int, original: Any, applied: Any) -> None:
        self._repos.guild.set_nick_state(guild_id, user_id, original, applied)

    def delete_guild_nick_prefs(self, guild_id: int) -> None:
        self._repos.guild.delete_guild_nick_prefs(guild_id)

    def nick_pref_guilds(self, user_id: int) -> list[Any]:
        return self._repos.guild.nick_pref_guilds(user_id)

    def nick_pref(self, guild_id: int, user_id: int) -> bool:
        return self._repos.guild.nick_pref(guild_id, user_id)

    def profiles_of(self, user_ids: Iterable[int]) -> dict[int, dict[str, Any]]:
        return self._repos.guild.profiles_of(user_ids)

    # ----------------------------- Shop / Auction / P2P / Raffle / Quiz ----------------------------- #
    def shop_stock(self, user_id: int, item_id: str, now: Optional[float] = None) -> Optional[dict[str, Any]]:
        return self._repos.shop.shop_stock(user_id, item_id, now=now)

    def purchase(
        self,
        user_id: int,
        item_id: str,
        label: str,
        price: int,
        unique: bool,
        qty: int = 1,
        now: Optional[float] = None,
    ) -> PurchaseResult:
        return self._repos.shop.purchase(user_id, item_id, label, price, unique, qty=qty, now=now)

    def inventory(self, user_id: int) -> dict[str, Any]:
        return self._repos.shop.inventory(user_id)

    def get_profile(self, user_id: int, raw: bool = False) -> dict[str, Any]:
        return self._repos.shop.get_profile(user_id, raw=raw)

    def equip(self, user_id: int, slot: str, item_id: Optional[str]) -> bool:
        return self._repos.shop.equip(user_id, slot, item_id)

    def arm(self, user_id: int, item_id: str) -> bool:
        return self._repos.shop.arm(user_id, item_id)

    def auction_price(self, item_id: str, listed_at: float, now: Optional[float] = None) -> int:
        return self._repos.auction.auction_price(item_id, listed_at, now=now)

    def auction_list(self, now: Optional[float] = None) -> list[Any]:
        return self._repos.auction.auction_list(now=now)

    def auction_buy(self, user_id: int, item_id: str, qty: int = 1, now: Optional[float] = None) -> PurchaseResult:
        return self._repos.auction.auction_buy(user_id, item_id, qty=qty, now=now)

    def p2p_list(
        self,
        user_id: int,
        kind: str,
        ref: str,
        qty: int,
        mode: str,
        price: int,
        hours: Optional[int] = None,
        now: Optional[float] = None,
    ) -> tuple[Any, ...]:
        return self._repos.p2p.p2p_list(user_id, kind, ref, qty, mode, price, hours=hours, now=now)

    def p2p_label(self, row: Any) -> str:
        return self._repos.p2p.p2p_label(row)

    def p2p_get(self, listing_id: int) -> Any:
        return self._repos.p2p.p2p_get(listing_id)

    def p2p_set_post(self, listing_id: int, channel_id: int, message_id: int) -> None:
        self._repos.p2p.p2p_set_post(listing_id, channel_id, message_id)

    def p2p_buy(self, buyer_id: int, listing_id: int, now: Optional[float] = None) -> tuple[Any, ...]:
        return self._repos.p2p.p2p_buy(buyer_id, listing_id, now=now)

    def p2p_bid(self, bidder_id: int, listing_id: int, amount: int, now: Optional[float] = None) -> tuple[Any, ...]:
        return self._repos.p2p.p2p_bid(bidder_id, listing_id, amount, now=now)

    def p2p_cancel(self, user_id: int, listing_id: int, now: Optional[float] = None) -> tuple[Any, ...]:
        return self._repos.p2p.p2p_cancel(user_id, listing_id, now=now)

    def p2p_pull_back(self, user_id: int, now: Optional[float] = None) -> dict[str, int]:
        return self._repos.p2p.p2p_pull_back(user_id, now=now)

    def p2p_unsynced_posts(self) -> list[Any]:
        return self._repos.p2p.p2p_unsynced_posts()

    def p2p_mark_post_done(self, listing_id: int) -> None:
        self._repos.p2p.p2p_mark_post_done(listing_id)

    def p2p_settle(self, now: Optional[float] = None) -> list[Any]:
        return self._repos.p2p.p2p_settle(now=now)

    def p2p_active(
        self,
        kind: Optional[str] = None,
        now: Optional[float] = None,
        limit: int = 25,
        mode: Optional[str] = None,
        order: str = "end",
    ) -> list[Any]:
        return self._repos.p2p.p2p_active(kind=kind, now=now, limit=limit, mode=mode, order=order)

    def p2p_count(self, now: Optional[float] = None) -> int:
        return self._repos.p2p.p2p_count(now=now)

    def p2p_mine(self, user_id: int, now: Optional[float] = None) -> dict[str, Any]:
        return self._repos.p2p.p2p_mine(user_id, now=now)

    def raffle_open(self, host_id: int, fee: int, closes: float, channel_id: int) -> tuple[Any, ...]:
        return self._repos.raffle.raffle_open(host_id, fee, closes, channel_id)

    def raffle_get(self) -> Optional[dict[str, Any]]:
        return self._repos.raffle.raffle_get()

    def raffle_set_message(self, raffle_id: int, message_id: int, channel_id: Optional[int] = None) -> None:
        self._repos.raffle.raffle_set_message(raffle_id, message_id, channel_id=channel_id)

    def raffle_join(self, user_id: int, now: float) -> tuple[Any, ...]:
        return self._repos.raffle.raffle_join(user_id, now)

    def raffle_close(self, rng: Any = None, cancel: bool = False) -> Optional[dict[str, Any]]:
        return self._repos.raffle.raffle_close(rng=rng, cancel=cancel)

    def quiz_add(
        self,
        question: str,
        choices: list[Any],
        explanation: str,
        reward: int,
        expires: Optional[float],
        now: float,
        creator_name: str = "",
        msg_right: str = "",
        msg_wrong: str = "",
    ) -> int:
        return self._repos.quiz.quiz_add(
            question,
            choices,
            explanation,
            reward,
            expires,
            now,
            creator_name=creator_name,
            msg_right=msg_right,
            msg_wrong=msg_wrong,
        )

    def quiz_add_many(self, items: list[Any], now: float, creator_name: str = "") -> list[Any]:
        return self._repos.quiz.quiz_add_many(items, now, creator_name=creator_name)

    def quiz_existing_questions(self) -> set[Any]:
        return self._repos.quiz.quiz_existing_questions()

    def quiz_get(self, quiz_id: int) -> Optional[dict[str, Any]]:
        return self._repos.quiz.quiz_get(quiz_id)

    def quiz_list(self) -> list[Any]:
        return self._repos.quiz.quiz_list()

    def quiz_delete(self, quiz_id: int) -> bool:
        return self._repos.quiz.quiz_delete(quiz_id)

    def quiz_next(self, user_id: int, now: float) -> tuple[Any, ...]:
        return self._repos.quiz.quiz_next(user_id, now)

    def quiz_answer(self, user_id: int, quiz_id: int, chosen: str, now: float) -> tuple[Any, ...]:
        return self._repos.quiz.quiz_answer(user_id, quiz_id, chosen, now)

    def quiz_post(
        self,
        author_id: int,
        question: str,
        choices: list[Any],
        explanation: str,
        reward: int,
        minutes: int,
        channel_id: int,
        now: float,
        creator_name: str = "",
        msg_right: str = "",
        msg_wrong: str = "",
    ) -> tuple[Any, ...]:
        return self._repos.quiz.quiz_post(
            author_id,
            question,
            choices,
            explanation,
            reward,
            minutes,
            channel_id,
            now,
            creator_name=creator_name,
            msg_right=msg_right,
            msg_wrong=msg_wrong,
        )

    def quiz_own_open(self, user_id: int, now: float) -> list[Any]:
        return self._repos.quiz.quiz_own_open(user_id, now)

    def quiz_set_message(self, quiz_id: int, message_id: int) -> None:
        self._repos.quiz.quiz_set_message(quiz_id, message_id)

    def quiz_settle(self, now: float) -> list[Any]:
        return self._repos.quiz.quiz_settle(now)

    def quiz_withdraw(self, user_id: int, quiz_id: int, now: float) -> Optional[dict[str, Any]]:
        return self._repos.quiz.quiz_withdraw(user_id, quiz_id, now)

    # ----------------------------- Teiai / Bank / Loans ----------------------------- #
    def status(self, user_id: int, now: Optional[float] = None) -> str:
        return self._repos.debt.status(user_id, now=now)

    def loan_blacklisted(self, user_id: int, now: Optional[float] = None) -> bool:
        return self._repos.debt.loan_blacklisted(user_id, now=now)

    def debt(self, user_id: int) -> int:
        return self._repos.debt.debt(user_id)

    def borrow_seed(self, user_id: int) -> tuple[Any, ...]:
        return self._repos.debt.borrow_seed(user_id)

    def can_borrow_for_bet(self, user_id: int, need: int) -> tuple[Any, ...]:
        return self._repos.debt.can_borrow_for_bet(user_id, need)

    def repay_debt(self, user_id: int, amount: Optional[int] = None) -> tuple[Any, ...]:
        return self._repos.debt.repay_debt(user_id, amount=amount)

    def escape_left(self, user_id: int) -> int:
        return self._repos.debt.escape_left(user_id)

    def escape_attempt(self, user_id: int, now: Optional[float] = None, rng: Any = None) -> tuple[Any, ...]:
        return self._repos.debt.escape_attempt(user_id, now=now, rng=rng)

    def bankrupt(self, user_id: int, forced: bool = False, escape: bool = False) -> tuple[Any, ...]:
        return self._repos.debt.bankrupt(user_id, forced=forced, escape=escape)

    def deposit_of(self, user_id: int) -> int:
        return self._repos.bank.deposit_of(user_id)

    def bank_values(self) -> dict[int, int]:
        return self._repos.bank.bank_values()

    def bank_status(self, now: Optional[float] = None) -> dict[str, Any]:
        return self._repos.bank.bank_status(now=now)

    def house_account(self) -> dict[str, Any]:
        return self._repos.bank.house_account()

    def bank_deposit(self, user_id: int, amount: int, now: Optional[float] = None) -> tuple[Any, ...]:
        return self._repos.bank.bank_deposit(user_id, amount, now=now)

    def bank_withdraw(self, user_id: int, amount: Optional[int] = None, now: Optional[float] = None) -> tuple[Any, ...]:
        return self._repos.bank.bank_withdraw(user_id, amount=amount, now=now)

    def grace_until(self, user_id: int) -> Optional[float]:
        return self._repos.bank.grace_until(user_id)

    def grace_list(self) -> list[Any]:
        return self._repos.bank.grace_list()

    def grace_expire(self, now: float) -> list[Any]:
        return self._repos.bank.grace_expire(now)

    def cds_quote(self, target_id: int, now: Optional[float] = None) -> dict[str, Any]:
        return self._repos.bank.cds_quote(target_id, now=now)

    def cds_buy(self, buyer_id: int, target_id: int, stake: int, now: Optional[float] = None) -> tuple[Any, ...]:
        return self._repos.bank.cds_buy(buyer_id, target_id, stake, now=now)

    def cds_list(self, user_id: int) -> dict[str, Any]:
        return self._repos.bank.cds_list(user_id)

    def cds_total_claims(self) -> int:
        return self._repos.bank.cds_total_claims()

    def loan_remaining(self, loan: dict[str, Any], now: float) -> int:
        return self._repos.loans.loan_remaining(loan, now)

    def loan_credit(self, user_id: int, now: Optional[float] = None) -> dict[str, Any]:
        return self._repos.loans.loan_credit(user_id, now=now)

    def loan_request(
        self, borrower_id: int, principal: int, rate_tenths: int, term_days: int, channel_id: int, now: float
    ) -> tuple[Any, ...]:
        return self._repos.loans.loan_request(borrower_id, principal, rate_tenths, term_days, channel_id, now)

    def loan_lend(self, loan_id: int, lender_id: int, now: float) -> tuple[Any, ...]:
        return self._repos.loans.loan_lend(loan_id, lender_id, now)

    def loan_offer(
        self,
        lender_id: int,
        borrower_id: int,
        principal: int,
        rate_tenths: int,
        term_days: int,
        channel_id: int,
        now: float,
    ) -> tuple[Any, ...]:
        return self._repos.loans.loan_offer(lender_id, borrower_id, principal, rate_tenths, term_days, channel_id, now)

    def loan_set_message(self, loan_id: int, message_id: int) -> None:
        self._repos.loans.loan_set_message(loan_id, message_id)

    def loan_get(self, loan_id: int) -> Optional[dict[str, Any]]:
        return self._repos.loans.loan_get(loan_id)

    def loan_accept(self, loan_id: int, user_id: int, now: float) -> tuple[Any, ...]:
        return self._repos.loans.loan_accept(loan_id, user_id, now)

    def loan_decline(self, loan_id: int, user_id: int) -> tuple[Any, ...]:
        return self._repos.loans.loan_decline(loan_id, user_id)

    def loan_cancel(self, loan_id: int, user_id: int) -> tuple[Any, ...]:
        return self._repos.loans.loan_cancel(loan_id, user_id)

    def loan_repay(self, loan_id: int, user_id: int, amount: Optional[int], now: float) -> tuple[Any, ...]:
        return self._repos.loans.loan_repay(loan_id, user_id, amount, now)

    def loan_collect_due(self, now: float) -> list[Any]:
        return self._repos.loans.loan_collect_due(now)

    def loan_due_soon(self, now: float) -> list[Any]:
        return self._repos.loans.loan_due_soon(now)

    def loan_expire_offers(self, now: float) -> list[Any]:
        return self._repos.loans.loan_expire_offers(now)

    def loan_list(self, user_id: int) -> dict[str, Any]:
        return self._repos.loans.loan_list(user_id)

    # ----------------------------- Market / Crypto / Margin / Bonds / Options / Earnings ----------------------------- #
    def market_latest(self, symbol: str = DEFAULT) -> Optional[tuple[Any, ...]]:
        return self._repos.market.market_latest(symbol=symbol)

    def latest_prices(self) -> dict[str, Any]:
        return self._repos.market.latest_prices()

    def market_set(self, ts: float, price: float, event: int = 0, symbol: str = DEFAULT) -> None:
        self._repos.market.market_set(ts, price, event=event, symbol=symbol)

    def market_fair_get(self, symbol: str) -> Optional[float]:
        return self._repos.market.market_fair_get(symbol)

    def market_fair_set(self, symbol: str, fair: float, pin: int, ts: float) -> None:
        self._repos.market.market_fair_set(symbol, fair, pin, ts)

    def market_pin(self, symbol: str) -> int:
        return self._repos.market.market_pin(symbol)

    def pin_reason(self, symbol: str, action: str) -> Optional[Failure]:
        return self._repos.market.pin_reason(symbol, action)

    def market_history(self, since: float, symbol: str = DEFAULT) -> list[Any]:
        return self._repos.market.market_history(since, symbol=symbol)

    def market_prune(self, before: float) -> None:
        self._repos.market.market_prune(before)

    def swap_chart_post(
        self, channel_id: int, message_id: int, guild_id: int, period: str, ts: float, symbol: str = DEFAULT
    ) -> Optional[int]:
        return self._repos.market.swap_chart_post(channel_id, message_id, guild_id, period, ts, symbol=symbol)

    def live_chart_posts(self) -> list[Any]:
        return self._repos.market.live_chart_posts()

    def end_chart_post(self, channel_id: int) -> None:
        self._repos.market.end_chart_post(channel_id)

    def delete_chart_post(self, channel_id: int) -> None:
        self._repos.market.delete_chart_post(channel_id)

    def delete_guild_chart_posts(self, guild_id: int) -> None:
        self._repos.market.delete_guild_chart_posts(guild_id)

    def prune_chart_posts(self, before_ts: float) -> None:
        self._repos.market.prune_chart_posts(before_ts)

    def list_chart_boards(self) -> list[Any]:
        return self._repos.market.list_chart_boards()

    def delete_chart_board(self, guild_id: int) -> None:
        self._repos.market.delete_chart_board(guild_id)

    def market_events(self, now: Optional[float] = None) -> list[Any]:
        return self._repos.market_events.market_events(now=now)

    def vol_multipliers(self, now: Optional[float] = None) -> dict[str, Any]:
        return self._repos.market_events.vol_multipliers(now=now)

    def event_step(
        self, now: float, rng: Any = None, force: Optional[dict[str, Any]] = None
    ) -> Optional[dict[str, Any]]:
        return self._repos.market_events.event_step(now, rng=rng, force=force)

    def earnings_ensure(self, now: float, tz_hours: float, rng: Any = None) -> Optional[dict[str, Any]]:
        return self._repos.earnings.earnings_ensure(now, tz_hours, rng=rng)

    def earnings_jumps(self, now: float, seconds: float) -> list[Any]:
        return self._repos.earnings.earnings_jumps(now, seconds)

    def earnings_upcoming(self, now: Optional[float] = None) -> Optional[dict[str, Any]]:
        return self._repos.earnings.earnings_upcoming(now=now)

    def earnings_to_announce(self, now: float) -> list[Any]:
        return self._repos.earnings.earnings_to_announce(now)

    def earnings_release_due(self, now: float) -> list[Any]:
        return self._repos.earnings.earnings_release_due(now)

    def earnings_memo(self, user_id: int, now: Optional[float] = None, rng: Any = None) -> Optional[MemoInfo]:
        return self._repos.earnings.earnings_memo(user_id, now=now, rng=rng)

    def insider_stock(self, now: Optional[float] = None) -> Optional[dict[str, Any]]:
        return self._repos.earnings.insider_stock(now=now)

    def insider_buy(self, user_id: int, now: Optional[float] = None, rng: Any = None) -> tuple[Any, ...]:
        return self._repos.earnings.insider_buy(user_id, now=now, rng=rng)

    def crypto_holding(self, user_id: int, symbol: str = DEFAULT) -> tuple[Any, ...]:
        return self._repos.crypto.crypto_holding(user_id, symbol=symbol)

    def holdings(self, user_id: int) -> list[Any]:
        return self._repos.crypto.holdings(user_id)

    def crypto_holders(self, limit: int = 10, symbol: str = DEFAULT) -> list[Any]:
        return self._repos.crypto.crypto_holders(limit=limit, symbol=symbol)

    def crypto_values(self) -> dict[int, int]:
        return self._repos.crypto.crypto_values()

    def crypto_buy(self, user_id: int, amount: int, price: float, symbol: str = DEFAULT) -> CryptoResult:
        return self._repos.crypto.crypto_buy(user_id, amount, price, symbol=symbol)

    def crypto_sell(self, user_id: int, units: Optional[int], price: float, symbol: str = DEFAULT) -> CryptoResult:
        return self._repos.crypto.crypto_sell(user_id, units, price, symbol=symbol)

    def margin_position(self, user_id: int, symbol: str, side: str) -> tuple[Any, ...]:
        return self._repos.margin.margin_position(user_id, symbol, side)

    def short_position(self, user_id: int, symbol: str = DEFAULT) -> tuple[Any, ...]:
        return self._repos.margin.short_position(user_id, symbol=symbol)

    def long_position(self, user_id: int, symbol: str = DEFAULT) -> tuple[Any, ...]:
        return self._repos.margin.long_position(user_id, symbol=symbol)

    def margin_positions(self, user_id: int) -> list[Any]:
        return self._repos.margin.margin_positions(user_id)

    def short_positions(self, user_id: int) -> list[Any]:
        return self._repos.margin.short_positions(user_id)

    def long_positions(self, user_id: int) -> list[Any]:
        return self._repos.margin.long_positions(user_id)

    def short_holders(self, limit: int = 10, symbol: str = DEFAULT) -> list[Any]:
        return self._repos.margin.short_holders(limit=limit, symbol=symbol)

    def margin_equity(self) -> dict[int, int]:
        return self._repos.margin.margin_equity()

    def margin_status(self, user_id: int, prices: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        return self._repos.margin.margin_status(user_id, prices=prices)

    def short_open(self, user_id: int, units: int, price: float, leverage: int, symbol: str = DEFAULT) -> CryptoResult:
        return self._repos.margin.short_open(user_id, units, price, leverage, symbol=symbol)

    def long_open(self, user_id: int, units: int, price: float, leverage: int, symbol: str = DEFAULT) -> CryptoResult:
        return self._repos.margin.long_open(user_id, units, price, leverage, symbol=symbol)

    def margin_close(
        self, user_id: int, side: str, units: Optional[int], price: float, symbol: str = DEFAULT
    ) -> CryptoResult:
        return self._repos.margin.margin_close(user_id, side, units, price, symbol=symbol)

    def short_close(self, user_id: int, units: Optional[int], price: float, symbol: str = DEFAULT) -> CryptoResult:
        return self._repos.margin.short_close(user_id, units, price, symbol=symbol)

    def long_close(self, user_id: int, units: Optional[int], price: float, symbol: str = DEFAULT) -> CryptoResult:
        return self._repos.margin.long_close(user_id, units, price, symbol=symbol)

    def margin_cut_map(self, prices: Optional[dict[str, Any]] = None) -> list[Any]:
        return self._repos.margin.margin_cut_map(prices=prices)

    def margin_interest(self, now: float) -> list[Any]:
        return self._repos.margin.margin_interest(now)

    def margin_losscut(self, prices: dict[str, Any]) -> list[Any]:
        return self._repos.margin.margin_losscut(prices)

    def bond_buy(self, user_id: int, kind_key: str, amount: int, now: float) -> tuple[Any, ...]:
        return self._repos.bonds.bond_buy(user_id, kind_key, amount, now)

    def bond_values(self) -> dict[int, int]:
        return self._repos.bonds.bond_values()

    def bond_list(self, user_id: int, recent: int = 5) -> dict[str, Any]:
        return self._repos.bonds.bond_list(user_id, recent=recent)

    def bond_settle(self, now: float, rng: Any = None) -> list[Any]:
        return self._repos.bonds.bond_settle(now, rng=rng)

    def bond_price(self, row: dict[str, Any], now: float) -> int:
        return self._repos.bonds.bond_price(row, now)

    def bond_cancel(self, user_id: int, bond_id: int, now: Optional[float] = None) -> tuple[Any, ...]:
        return self._repos.bonds.bond_cancel(user_id, bond_id, now=now)

    def option_buy(
        self,
        user_id: int,
        kind: str,
        symbol: str,
        amount: int,
        now: Optional[float] = None,
        symbol2: Optional[str] = None,
        strike_pct: Optional[float] = None,
    ) -> tuple[Any, ...]:
        return self._repos.options.option_buy(
            user_id, kind, symbol, amount, now=now, symbol2=symbol2, strike_pct=strike_pct
        )

    def option_write(
        self,
        user_id: int,
        kind: str,
        symbol: str,
        amount: int,
        now: Optional[float] = None,
        strike_pct: Optional[float] = None,
    ) -> tuple[Any, ...]:
        return self._repos.options.option_write(user_id, kind, symbol, amount, now=now, strike_pct=strike_pct)

    def option_close_cost(self, row: Any, now: float, prices: dict[str, Any]) -> int:
        return self._repos.options.option_close_cost(row, now, prices)

    def option_value(self, row: Any, now: float, prices: dict[str, Any]) -> int:
        return self._repos.options.option_value(row, now, prices)

    def option_values(self) -> dict[int, int]:
        return self._repos.options.option_values()

    def option_list(self, user_id: int, recent: int = 5) -> dict[str, Any]:
        return self._repos.options.option_list(user_id, recent=recent)

    def option_sell(self, user_id: int, option_id: int, now: Optional[float] = None) -> tuple[Any, ...]:
        return self._repos.options.option_sell(user_id, option_id, now=now)

    def option_settle(self, now: float) -> list[Any]:
        return self._repos.options.option_settle(now)

    # ----------------------------- Horse / Race / Labor / Relics ----------------------------- #
    def horse_create(self, user_id: int, name: str, coat: str, silks: str) -> tuple[Any, ...]:
        return self._repos.horses.horse_create(user_id, name, coat, silks)

    def rental_ensure(self, user_id: int, now: float, tz_hours: float, rng: Any = None) -> dict[str, Any]:
        return self._repos.horses.rental_ensure(user_id, now, tz_hours, rng=rng)

    def horse_buy_rental(self, user_id: int, now: float, tz_hours: float) -> tuple[Any, ...]:
        return self._repos.horses.horse_buy_rental(user_id, now, tz_hours)

    def horse_list(self, user_id: int) -> list[Any]:
        return self._repos.horses.horse_list(user_id)

    def horse_get(self, horse_id: int) -> Optional[dict[str, Any]]:
        return self._repos.horses.horse_get(horse_id)

    def horse_carrot(self, user_id: int, horse_id: int, src: str, dst: str) -> tuple[Any, ...]:
        return self._repos.horses.horse_carrot(user_id, horse_id, src, dst)

    def horse_retire(self, user_id: int, horse_id: int) -> tuple[Any, ...]:
        return self._repos.horses.horse_retire(user_id, horse_id)

    def horse_set_style(self, user_id: int, horse_id: int, style: Optional[str]) -> tuple[Any, ...]:
        return self._repos.horses.horse_set_style(user_id, horse_id, style)

    def horse_gold_carrot(self, user_id: int, horse_id: int, first: str, second: str) -> tuple[Any, ...]:
        return self._repos.horses.horse_gold_carrot(user_id, horse_id, first, second)

    def horse_auction_price(self, listed_at: float, now: Optional[float] = None) -> int:
        return self._repos.horses.horse_auction_price(listed_at, now=now)

    def auction_horses(self, now: Optional[float] = None) -> list[Any]:
        return self._repos.horses.auction_horses(now=now)

    def auction_buy_horse(self, user_id: int, horse_id: int, now: Optional[float] = None) -> PurchaseResult:
        return self._repos.horses.auction_buy_horse(user_id, horse_id, now=now)

    def race_get(self, race_id: int) -> Optional[dict[str, Any]]:
        return self._repos.races.race_get(race_id)

    def race_number(self, race_id: int) -> int:
        return self._repos.races.race_number(race_id)

    def race_open(self) -> list[Any]:
        return self._repos.races.race_open()

    def race_slots(self, now: float, tz_hours: float, days: int = 2) -> list[float]:
        return self._repos.races.race_slots(now, tz_hours, days=days)

    def race_ensure_scheduled(self, now: float, tz_hours: float, channel_id: int = 0) -> Optional[int]:
        return self._repos.races.race_ensure_scheduled(now, tz_hours, channel_id=channel_id)

    def race_create_special(self, now: float, entry_min: int, bet_min: int, channel_id: int = 0) -> int:
        return self._repos.races.race_create_special(now, entry_min, bet_min, channel_id=channel_id)

    def race_set_message(self, race_id: int, channel_id: int, message_id: int) -> None:
        self._repos.races.race_set_message(race_id, channel_id, message_id)

    def race_entries(self, race_id: int, registered_only: bool = False) -> list[Any]:
        return self._repos.races.race_entries(race_id, registered_only=registered_only)

    def race_register(self, user_id: int, horse_id: int, race_id: int, now: float) -> tuple[Any, ...]:
        return self._repos.races.race_register(user_id, horse_id, race_id, now)

    def race_withdraw(self, user_id: int, horse_id: int, race_id: int, now: float) -> tuple[Any, ...]:
        return self._repos.races.race_withdraw(user_id, horse_id, race_id, now)

    def race_close_entries(self, race_id: int, rng: Optional[random.Random] = None) -> Optional[dict[str, Any]]:
        return self._repos.races.race_close_entries(race_id, rng=rng)

    def race_set_odds(self, race_id: int, odds: Any) -> None:
        self._repos.races.race_set_odds(race_id, odds)

    def race_odds(self, race_id: int, kind: str, lanes: Any) -> Optional[float]:
        return self._repos.races.race_odds(race_id, kind, lanes)

    def race_bets(self, user_id: int, race_id: int) -> list[Any]:
        return self._repos.races.race_bets(user_id, race_id)

    def race_bet(self, user_id: int, race_id: int, kind: str, lane: Any, stake: int, now: float) -> tuple[Any, ...]:
        return self._repos.races.race_bet(user_id, race_id, kind, lane, stake, now)

    def race_bet_many(
        self, user_id: int, race_id: int, kind: str, lanes: list[Any], stake: int, now: float
    ) -> tuple[Any, ...]:
        return self._repos.races.race_bet_many(user_id, race_id, kind, lanes, stake, now)

    def race_run(
        self, race_id: int, rng: Optional[random.Random] = None, tz_hours: float = 9.0
    ) -> Optional[dict[str, Any]]:
        return self._repos.races.race_run(race_id, rng=rng, tz_hours=tz_hours)

    def labor_donated_total(self) -> int:
        return self._repos.labor.labor_donated_total()

    def labor_finds(self, user_id: int, limit: int = 6) -> list[Any]:
        return self._repos.labor.labor_finds(user_id, limit=limit)

    def labor_state(self, user_id: int, now: Optional[float] = None, day: str = "") -> dict[str, Any]:
        return self._repos.labor.labor_state(user_id, now=now, day=day)

    def labor_top(self, limit: int = 10, day: Optional[str] = None, user_id: Optional[int] = None) -> dict[str, Any]:
        return self._repos.labor.labor_top(limit=limit, day=day, user_id=user_id)

    def labor_click(self, user_id: int, now: Optional[float] = None, day: str = "", rng: Any = None) -> dict[str, Any]:
        self._repos.labor.FINDS_KEEP = self.FINDS_KEEP
        return self._repos.labor.labor_click(user_id, now=now, day=day, rng=rng)

    def labor_click_hours(self, user_id: int, since: float) -> list[Any]:
        return self._repos.labor.labor_click_hours(user_id, since)

    def labor_collect(self, user_id: int, now: Optional[float] = None, day: str = "", detail: bool = False) -> Any:
        return self._repos.labor.labor_collect(user_id, now=now, day=day, detail=detail)

    def labor_drink(self, user_id: int, now: Optional[float] = None, day: str = "") -> tuple[Any, ...]:
        return self._repos.labor.labor_drink(user_id, now=now, day=day)

    def labor_upgrade(self, user_id: int, tool: str, now: Optional[float] = None, day: str = "") -> tuple[Any, ...]:
        return self._repos.labor.labor_upgrade(user_id, tool, now=now, day=day)

    def labor_hire(self, user_id: int, kind: str, now: Optional[float] = None, day: str = "") -> tuple[Any, ...]:
        return self._repos.labor.labor_hire(user_id, kind, now=now, day=day)

    def labor_dismiss(self, user_id: int, kind: str, now: Optional[float] = None, day: str = "") -> tuple[Any, ...]:
        return self._repos.labor.labor_dismiss(user_id, kind, now=now, day=day)

    def labor_dorm(self, user_id: int, now: Optional[float] = None, day: str = "") -> tuple[Any, ...]:
        return self._repos.labor.labor_dorm(user_id, now=now, day=day)

    def labor_set_renew(self, user_id: int, on: bool, now: Optional[float] = None, day: str = "") -> tuple[Any, ...]:
        return self._repos.labor.labor_set_renew(user_id, on, now=now, day=day)

    def relic_stock(self, user_id: int) -> dict[str, int]:
        return self._repos.relics.relic_stock(user_id)

    def relic_merge(self, user_id: int, item_id: str) -> tuple[Any, ...]:
        return self._repos.relics.relic_merge(user_id, item_id)


def _verify_ieconomy(eco: Economy) -> IEconomy:
    """Pyright による IEconomy 構造的部分型の一致検証アンカー。"""
    return eco
