"""永続化リポジトリの抽象ポート群（名前的基底クラス / DIP 契約）。

各リポジトリ（`infra/db/*.py`）がこれらの単一責務（SRP）ポートを明示的に継承し、
上位層（`services/`・`cogs/`）は `infra.db` ではなく本モジュールのポートと
`domain/ports/bridges.py` のブリッジ契約にのみ依存する。
"""

import datetime
import random
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Iterable, Optional, Self

from domain.ports.bridges import (
    IBankCdsBridge,
    IBankIncomeSink,
    IBankruptExecutor,
    IDebtLifecycleHook,
    IDebtOps,
    IDebtRepayHook,
    IMarginCollateralGuard,
    IMarginRatioReader,
    IMarketPriceReader,
    INoticeSink,
    IOverdueLoanCollector,
    ISpotCollateralReader,
    IStatusReader,
    IValuationSource,
)

if TYPE_CHECKING:
    from domain.earnings import MemoInfo
    from domain.errors import Notice
    from domain.types import CryptoResult, DailyResult, PurchaseResult, TransferResult


class IGuildScopedRepo:
    """サーバー（guild_id）単位のビューを切り出す共通契約。"""

    def for_guild(self, guild_id: int) -> Self:
        raise NotImplementedError


class INoticeRepo(IGuildScopedRepo, INoticeSink):
    def take_notices(self, user_id: int) -> list["Notice"]:
        raise NotImplementedError


class IRtpRepo(IGuildScopedRepo):
    def rtp_level_get(self, game: str) -> int:
        raise NotImplementedError

    def rtp_levels(self) -> dict[str, int]:
        raise NotImplementedError

    def rtp_level_set(self, game: Optional[str], level: int) -> list[str]:
        raise NotImplementedError


class IEventRepo(IGuildScopedRepo):
    def event_phase(self, day: datetime.date) -> int:
        raise NotImplementedError

    def set_event_phase(self, day: datetime.date, phase: int) -> None:
        raise NotImplementedError

    def manual_event_start(self, game: str, boost_pct: int, starts: float, ends: float, channel_id: int = 0) -> None:
        raise NotImplementedError

    def manual_event_get(self, now: float) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def manual_event_stop(self, now: float) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def manual_event_finish_due(self, now: float) -> Optional[dict[str, Any]]:
        raise NotImplementedError


class IPachinkoRepo(IGuildScopedRepo):
    def pachinko_record_set(self, user_id: int, bet: int, balls: int, result: Any, now: Optional[float] = None) -> None:
        raise NotImplementedError

    def pachinko_stats(self, guild_id: Optional[int] = None, since: Optional[float] = None) -> dict[str, Any]:
        raise NotImplementedError


class IRelicRepo(IGuildScopedRepo):
    def relic_buffs_for(self, guild_id: int, user_id: int) -> dict[str, float]:
        raise NotImplementedError

    def relic_stock_for(self, guild_id: int, user_id: int) -> dict[str, int]:
        raise NotImplementedError

    def relic_stock(self, user_id: int) -> dict[str, int]:
        raise NotImplementedError

    def relic_merge(self, user_id: int, item_id: str) -> tuple[Any, ...]:
        raise NotImplementedError


class IRecordRepo(IGuildScopedRepo):
    def record_play(
        self, user_id: int, game: str, bet: int, net: int, day: datetime.date, tags: Iterable[Any] = ()
    ) -> dict[str, Any]:
        raise NotImplementedError

    def mission_status(self, user_id: int, day: datetime.date) -> list[Any]:
        raise NotImplementedError

    def weekly_top(self, week: str, limit: int = 10) -> list[Any]:
        raise NotImplementedError

    def weekly_rank(self, week: str, user_id: int) -> Optional[tuple[Any, ...]]:
        raise NotImplementedError

    def weekly_last_announced(self) -> Optional[str]:
        raise NotImplementedError

    def set_weekly_announced(self, week: str) -> None:
        raise NotImplementedError

    def weekly_champion_count(self, user_id: int) -> int:
        raise NotImplementedError

    def weekly_award(self, week: str) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def backfill_weekly(self, utc_offset_hours: float = 9) -> int:
        raise NotImplementedError

    def play_summary(self, user_id: int) -> dict[str, Any]:
        raise NotImplementedError

    def win_streak(self, user_id: int) -> tuple[Any, ...]:
        raise NotImplementedError


class IMarketDataRepo(IGuildScopedRepo, IMarketPriceReader):
    def market_latest(self, symbol: str = "cs") -> Optional[tuple[Any, ...]]:
        raise NotImplementedError

    def market_set(self, ts: float, price: float, event: int = 0, symbol: str = "cs") -> None:
        raise NotImplementedError

    def market_fair_get(self, symbol: str) -> Optional[float]:
        raise NotImplementedError

    def market_fair_set(self, symbol: str, fair: float, pin: int, ts: float) -> None:
        raise NotImplementedError

    def market_pin(self, symbol: str) -> int:
        raise NotImplementedError

    def market_history(self, since: float, symbol: str = "cs") -> list[Any]:
        raise NotImplementedError

    def market_prune(self, before: float) -> None:
        raise NotImplementedError

    def swap_chart_post(
        self, channel_id: int, message_id: int, guild_id: int, period: str, ts: float, symbol: str = "cs"
    ) -> Optional[int]:
        raise NotImplementedError

    def live_chart_posts(self) -> list[Any]:
        raise NotImplementedError

    def end_chart_post(self, channel_id: int) -> None:
        raise NotImplementedError

    def delete_chart_post(self, channel_id: int) -> None:
        raise NotImplementedError

    def delete_guild_chart_posts(self, guild_id: int) -> None:
        raise NotImplementedError

    def prune_chart_posts(self, before_ts: float) -> None:
        raise NotImplementedError

    def list_chart_boards(self) -> list[Any]:
        raise NotImplementedError

    def delete_chart_board(self, guild_id: int) -> None:
        raise NotImplementedError


class IMarketEventRepo(IGuildScopedRepo):
    def market_events(self, now: Optional[float] = None) -> list[Any]:
        raise NotImplementedError

    def vol_multipliers(self, now: Optional[float] = None) -> dict[str, Any]:
        raise NotImplementedError

    def event_step(
        self, now: float, rng: Any = None, force: Optional[dict[str, Any]] = None
    ) -> Optional[dict[str, Any]]:
        raise NotImplementedError


class IEarningsRepo(IGuildScopedRepo):
    def earnings_ensure(self, now: float, tz_hours: float, rng: Any = None) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def earnings_jumps(self, now: float, seconds: float) -> list[Any]:
        raise NotImplementedError

    def earnings_upcoming(self, now: Optional[float] = None) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def earnings_to_announce(self, now: float) -> list[Any]:
        raise NotImplementedError

    def earnings_release_due(self, now: float) -> list[Any]:
        raise NotImplementedError

    def earnings_memo(self, user_id: int, now: Optional[float] = None, rng: Any = None) -> Optional["MemoInfo"]:
        raise NotImplementedError

    def insider_stock(self, now: Optional[float] = None) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def insider_buy(self, user_id: int, now: Optional[float] = None, rng: Any = None) -> tuple[Any, ...]:
        raise NotImplementedError


class IGuildRepo(IGuildScopedRepo):
    def set_guild_status(
        self, guild_id: int, status: str, name: Optional[str] = None, by: Optional[int] = None
    ) -> None:
        raise NotImplementedError

    def get_guild_status(self, guild_id: int) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def list_guild_status(self) -> list[Any]:
        raise NotImplementedError

    def mark_guild_notified(self, guild_id: int) -> None:
        raise NotImplementedError

    def set_leaderboard(self, guild_id: int, channel_id: int, message_id: int) -> None:
        raise NotImplementedError

    def get_leaderboard(self, guild_id: int) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def list_leaderboards(self) -> list[Any]:
        raise NotImplementedError

    def delete_leaderboard(self, guild_id: int) -> None:
        raise NotImplementedError

    def set_nick_pref(self, guild_id: int, user_id: int, enabled: bool) -> None:
        raise NotImplementedError

    def ensure_nick_row(self, guild_id: int, user_id: int) -> None:
        raise NotImplementedError

    def nick_managed(self, guild_id: int, user_id: int) -> bool:
        raise NotImplementedError

    def status_nick_targets(self) -> list[Any]:
        raise NotImplementedError

    def get_nick_state(self, guild_id: int, user_id: int) -> Any:
        raise NotImplementedError

    def set_nick_state(self, guild_id: int, user_id: int, original: Any, applied: Any) -> None:
        raise NotImplementedError

    def delete_guild_nick_prefs(self, guild_id: int) -> None:
        raise NotImplementedError

    def nick_pref_guilds(self, user_id: int) -> list[Any]:
        raise NotImplementedError

    def nick_pref(self, guild_id: int, user_id: int) -> bool:
        raise NotImplementedError

    def profiles_of(self, user_ids: Iterable[int]) -> dict[int, dict[str, Any]]:
        raise NotImplementedError


class IRaffleRepo(IGuildScopedRepo):
    def raffle_open(self, host_id: int, fee: int, closes: float, channel_id: int) -> tuple[Any, ...]:
        raise NotImplementedError

    def raffle_get(self) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def raffle_set_message(self, raffle_id: int, message_id: int, channel_id: Optional[int] = None) -> None:
        raise NotImplementedError

    def raffle_join(self, user_id: int, now: float) -> tuple[Any, ...]:
        raise NotImplementedError

    def raffle_close(self, rng: Any = None, cancel: bool = False) -> Optional[dict[str, Any]]:
        raise NotImplementedError


class IShopRepo(IGuildScopedRepo):
    SLOTS: tuple[str, ...]

    def shop_stock(self, user_id: int, item_id: str, now: Optional[float] = None) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def purchase(
        self,
        user_id: int,
        item_id: str,
        label: str,
        price: int,
        unique: bool,
        qty: int = 1,
        now: Optional[float] = None,
    ) -> "PurchaseResult":
        raise NotImplementedError

    def inventory(self, user_id: int) -> dict[str, Any]:
        raise NotImplementedError

    def get_profile(self, user_id: int, raw: bool = False) -> dict[str, Any]:
        raise NotImplementedError

    def equip(self, user_id: int, slot: str, item_id: Optional[str]) -> bool:
        raise NotImplementedError

    def arm(self, user_id: int, item_id: str) -> bool:
        raise NotImplementedError


class IAuctionRepo(IGuildScopedRepo):
    def auction_price(self, item_id: str, listed_at: float, now: Optional[float] = None) -> int:
        raise NotImplementedError

    def auction_list(self, now: Optional[float] = None) -> list[Any]:
        raise NotImplementedError

    def auction_buy(self, user_id: int, item_id: str, qty: int = 1, now: Optional[float] = None) -> "PurchaseResult":
        raise NotImplementedError


class IEscrowRepo(IGuildScopedRepo):
    def place_bet(self, user_id: int, amount: int, game: str) -> Optional[int]:
        raise NotImplementedError

    def add_to_escrow(self, escrow_id: int, extra: int, credit: bool = False) -> bool:
        raise NotImplementedError

    def escrow_amount(self, escrow_id: int) -> int:
        raise NotImplementedError

    def settle(self, escrow_id: int, payout: int, game: str) -> Optional[int]:
        raise NotImplementedError

    def settle_with_penalty(self, escrow_id: int, payout: int, game: str, penalty: int) -> Optional[tuple[Any, ...]]:
        raise NotImplementedError

    def refund(self, escrow_id: int) -> bool:
        raise NotImplementedError

    def refund_all_escrows(self) -> int:
        raise NotImplementedError


class IQuizRepo(IGuildScopedRepo):
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
        raise NotImplementedError

    def quiz_add_many(self, items: list[Any], now: float, creator_name: str = "") -> list[Any]:
        raise NotImplementedError

    def quiz_existing_questions(self) -> set[Any]:
        raise NotImplementedError

    def quiz_get(self, quiz_id: int) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def quiz_list(self) -> list[Any]:
        raise NotImplementedError

    def quiz_delete(self, quiz_id: int) -> bool:
        raise NotImplementedError

    def quiz_next(self, user_id: int, now: float) -> tuple[Any, ...]:
        raise NotImplementedError

    def quiz_answer(self, user_id: int, quiz_id: int, chosen: str, now: float) -> tuple[Any, ...]:
        raise NotImplementedError

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
        raise NotImplementedError

    def quiz_own_open(self, user_id: int, now: float) -> list[Any]:
        raise NotImplementedError

    def quiz_set_message(self, quiz_id: int, message_id: int) -> None:
        raise NotImplementedError

    def quiz_settle(self, now: float) -> list[Any]:
        raise NotImplementedError

    def quiz_withdraw(self, user_id: int, quiz_id: int, now: float) -> Optional[dict[str, Any]]:
        raise NotImplementedError


class ILoanRepo(IGuildScopedRepo, IOverdueLoanCollector):
    def loan_credit(self, user_id: int, now: Optional[float] = None) -> dict[str, Any]:
        raise NotImplementedError

    def loan_request(
        self, borrower_id: int, principal: int, rate_tenths: int, term_days: int, channel_id: int, now: float
    ) -> tuple[Any, ...]:
        raise NotImplementedError

    def loan_lend(self, loan_id: int, lender_id: int, now: float) -> tuple[Any, ...]:
        raise NotImplementedError

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
        raise NotImplementedError

    def loan_set_message(self, loan_id: int, message_id: int) -> None:
        raise NotImplementedError

    def loan_get(self, loan_id: int) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def loan_accept(self, loan_id: int, user_id: int, now: float) -> tuple[Any, ...]:
        raise NotImplementedError

    def loan_decline(self, loan_id: int, user_id: int) -> tuple[Any, ...]:
        raise NotImplementedError

    def loan_cancel(self, loan_id: int, user_id: int) -> tuple[Any, ...]:
        raise NotImplementedError

    def loan_repay(self, loan_id: int, user_id: int, amount: Optional[int], now: float) -> tuple[Any, ...]:
        raise NotImplementedError

    def loan_collect_due(self, now: float) -> list[Any]:
        raise NotImplementedError

    def loan_due_soon(self, now: float) -> list[Any]:
        raise NotImplementedError

    def loan_expire_offers(self, now: float) -> list[Any]:
        raise NotImplementedError

    def loan_list(self, user_id: int) -> dict[str, Any]:
        raise NotImplementedError


class IBankRepo(IGuildScopedRepo, IBankIncomeSink, IBankCdsBridge, IValuationSource):
    def deposit_of(self, user_id: int) -> int:
        raise NotImplementedError

    def bank_values(self) -> dict[int, int]:
        raise NotImplementedError

    def bank_status(self, now: Optional[float] = None) -> dict[str, Any]:
        raise NotImplementedError

    def house_account(self) -> dict[str, Any]:
        raise NotImplementedError

    def bank_deposit(self, user_id: int, amount: int, now: Optional[float] = None) -> tuple[Any, ...]:
        raise NotImplementedError

    def bank_withdraw(self, user_id: int, amount: Optional[int] = None, now: Optional[float] = None) -> tuple[Any, ...]:
        raise NotImplementedError

    def grace_until(self, user_id: int) -> Optional[float]:
        raise NotImplementedError

    def grace_list(self) -> list[Any]:
        raise NotImplementedError

    def grace_expire(self, now: float) -> list[Any]:
        raise NotImplementedError

    def cds_quote(self, target_id: int, now: Optional[float] = None) -> dict[str, Any]:
        raise NotImplementedError

    def cds_buy(self, buyer_id: int, target_id: int, stake: int, now: Optional[float] = None) -> tuple[Any, ...]:
        raise NotImplementedError

    def cds_list(self, user_id: int) -> dict[str, Any]:
        raise NotImplementedError

    def cds_total_claims(self) -> int:
        raise NotImplementedError


class IDebtRepo(
    IGuildScopedRepo,
    IDebtLifecycleHook,
    IStatusReader,
    IBankruptExecutor,
    IDebtOps,
    IDebtRepayHook,
):
    def status(self, user_id: int, now: Optional[float] = None) -> str:
        raise NotImplementedError

    def loan_blacklisted(self, user_id: int, now: Optional[float] = None) -> bool:
        raise NotImplementedError

    def debt(self, user_id: int) -> int:
        raise NotImplementedError

    def borrow_seed(self, user_id: int) -> tuple[Any, ...]:
        raise NotImplementedError

    def can_borrow_for_bet(self, user_id: int, need: int) -> tuple[Any, ...]:
        raise NotImplementedError

    def repay_debt(self, user_id: int, amount: Optional[int] = None) -> tuple[Any, ...]:
        raise NotImplementedError

    def escape_left(self, user_id: int) -> int:
        raise NotImplementedError

    def escape_attempt(self, user_id: int, now: Optional[float] = None, rng: Any = None) -> tuple[Any, ...]:
        raise NotImplementedError

    def bankrupt(self, user_id: int, forced: bool = False, escape: bool = False) -> tuple[Any, ...]:
        raise NotImplementedError


class ICryptoRepo(IGuildScopedRepo, ISpotCollateralReader, IValuationSource):
    def crypto_holding(self, user_id: int, symbol: str = "cs") -> tuple[Any, ...]:
        raise NotImplementedError

    def holdings(self, user_id: int) -> list[Any]:
        raise NotImplementedError

    def crypto_holders(self, limit: int = 10, symbol: str = "cs") -> list[Any]:
        raise NotImplementedError

    def crypto_values(self) -> dict[int, int]:
        raise NotImplementedError

    def crypto_buy(self, user_id: int, amount: int, price: float, symbol: str = "cs") -> "CryptoResult":
        raise NotImplementedError

    def crypto_sell(self, user_id: int, units: Optional[int], price: float, symbol: str = "cs") -> "CryptoResult":
        raise NotImplementedError


class IMarginRepo(IGuildScopedRepo, IMarginCollateralGuard, IMarginRatioReader, IValuationSource):
    def margin_position(self, user_id: int, symbol: str, side: str) -> tuple[Any, ...]:
        raise NotImplementedError

    def short_position(self, user_id: int, symbol: str = "cs") -> tuple[Any, ...]:
        raise NotImplementedError

    def long_position(self, user_id: int, symbol: str = "cs") -> tuple[Any, ...]:
        raise NotImplementedError

    def margin_positions(self, user_id: int) -> list[Any]:
        raise NotImplementedError

    def short_positions(self, user_id: int) -> list[Any]:
        raise NotImplementedError

    def long_positions(self, user_id: int) -> list[Any]:
        raise NotImplementedError

    def short_holders(self, limit: int = 10, symbol: str = "cs") -> list[Any]:
        raise NotImplementedError

    def margin_equity(self) -> dict[int, int]:
        raise NotImplementedError

    def margin_status(self, user_id: int, prices: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        raise NotImplementedError

    def short_open(self, user_id: int, units: int, price: float, leverage: int, symbol: str = "cs") -> "CryptoResult":
        raise NotImplementedError

    def long_open(self, user_id: int, units: int, price: float, leverage: int, symbol: str = "cs") -> "CryptoResult":
        raise NotImplementedError

    def margin_close(
        self, user_id: int, side: str, units: Optional[int], price: float, symbol: str = "cs"
    ) -> "CryptoResult":
        raise NotImplementedError

    def short_close(self, user_id: int, units: Optional[int], price: float, symbol: str = "cs") -> "CryptoResult":
        raise NotImplementedError

    def long_close(self, user_id: int, units: Optional[int], price: float, symbol: str = "cs") -> "CryptoResult":
        raise NotImplementedError

    def margin_cut_map(self, prices: Optional[dict[str, Any]] = None) -> list[Any]:
        raise NotImplementedError

    def margin_interest(self, now: float) -> list[Any]:
        raise NotImplementedError

    def margin_losscut(self, prices: dict[str, Any]) -> list[Any]:
        raise NotImplementedError


class IBondRepo(IGuildScopedRepo, IValuationSource):
    def bond_buy(self, user_id: int, kind_key: str, amount: int, now: float) -> tuple[Any, ...]:
        raise NotImplementedError

    def bond_values(self) -> dict[int, int]:
        raise NotImplementedError

    def bond_list(self, user_id: int, recent: int = 5) -> dict[str, Any]:
        raise NotImplementedError

    def bond_settle(self, now: float, rng: Any = None) -> list[Any]:
        raise NotImplementedError

    def bond_price(self, row: dict[str, Any], now: float) -> int:
        raise NotImplementedError

    def bond_cancel(self, user_id: int, bond_id: int, now: Optional[float] = None) -> tuple[Any, ...]:
        raise NotImplementedError


class IOptionRepo(IGuildScopedRepo, IValuationSource):
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
        raise NotImplementedError

    def option_write(
        self,
        user_id: int,
        kind: str,
        symbol: str,
        amount: int,
        now: Optional[float] = None,
        strike_pct: Optional[float] = None,
    ) -> tuple[Any, ...]:
        raise NotImplementedError

    def option_close_cost(self, row: Any, now: float, prices: dict[str, Any]) -> int:
        raise NotImplementedError

    def option_value(self, row: Any, now: float, prices: dict[str, Any]) -> int:
        raise NotImplementedError

    def option_values(self) -> dict[int, int]:
        raise NotImplementedError

    def option_list(self, user_id: int, recent: int = 5) -> dict[str, Any]:
        raise NotImplementedError

    def option_sell(self, user_id: int, option_id: int, now: Optional[float] = None) -> tuple[Any, ...]:
        raise NotImplementedError

    def option_settle(self, now: float) -> list[Any]:
        raise NotImplementedError


class IHorseRepo(IGuildScopedRepo):
    HORSE_PRICE: int

    def horse_create(self, user_id: int, name: str, coat: str, silks: str) -> tuple[Any, ...]:
        raise NotImplementedError

    def rental_ensure(self, user_id: int, now: float, tz_hours: float, rng: Any = None) -> dict[str, Any]:
        raise NotImplementedError

    def horse_buy_rental(self, user_id: int, now: float, tz_hours: float) -> tuple[Any, ...]:
        raise NotImplementedError

    def horse_list(self, user_id: int) -> list[Any]:
        raise NotImplementedError

    def horse_get(self, horse_id: int) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def horse_carrot(self, user_id: int, horse_id: int, src: str, dst: str) -> tuple[Any, ...]:
        raise NotImplementedError

    def horse_retire(self, user_id: int, horse_id: int) -> tuple[Any, ...]:
        raise NotImplementedError

    def horse_set_style(self, user_id: int, horse_id: int, style: Optional[str]) -> tuple[Any, ...]:
        raise NotImplementedError

    def horse_gold_carrot(self, user_id: int, horse_id: int, first: str, second: str) -> tuple[Any, ...]:
        raise NotImplementedError

    def horse_auction_price(self, listed_at: float, now: Optional[float] = None) -> int:
        raise NotImplementedError

    def auction_horses(self, now: Optional[float] = None) -> list[Any]:
        raise NotImplementedError

    def auction_buy_horse(self, user_id: int, horse_id: int, now: Optional[float] = None) -> "PurchaseResult":
        raise NotImplementedError


class IRaceRepo(IGuildScopedRepo):
    def race_get(self, race_id: int) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def race_number(self, race_id: int) -> int:
        raise NotImplementedError

    def race_open(self) -> list[Any]:
        raise NotImplementedError

    def race_slots(self, now: float, tz_hours: float) -> list[float]:
        raise NotImplementedError

    def race_ensure_scheduled(self, now: float, tz_hours: float, channel_id: int = 0) -> Optional[int]:
        raise NotImplementedError

    def race_create_special(self, now: float, entry_min: int, bet_min: int, channel_id: int = 0) -> int:
        raise NotImplementedError

    def race_set_message(self, race_id: int, channel_id: int, message_id: int) -> None:
        raise NotImplementedError

    def race_entries(self, race_id: int, registered_only: bool = False) -> list[Any]:
        raise NotImplementedError

    def race_register(self, user_id: int, horse_id: int, race_id: int, now: float) -> tuple[Any, ...]:
        raise NotImplementedError

    def race_withdraw(self, user_id: int, horse_id: int, race_id: int, now: float) -> tuple[Any, ...]:
        raise NotImplementedError

    def race_close_entries(self, race_id: int, rng: Optional[random.Random] = None) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def race_set_odds(self, race_id: int, odds: Any) -> None:
        raise NotImplementedError

    def race_odds(self, race_id: int, kind: str, lanes: Any) -> Optional[float]:
        raise NotImplementedError

    def race_bets(self, user_id: int, race_id: int) -> list[Any]:
        raise NotImplementedError

    def race_bet(self, user_id: int, race_id: int, kind: str, lane: Any, stake: int, now: float) -> tuple[Any, ...]:
        raise NotImplementedError

    def race_bet_many(
        self, user_id: int, race_id: int, kind: str, lanes: list[Any], stake: int, now: float
    ) -> tuple[Any, ...]:
        raise NotImplementedError

    def race_run(
        self, race_id: int, rng: Optional[random.Random] = None, tz_hours: float = 9.0
    ) -> Optional[dict[str, Any]]:
        raise NotImplementedError


class ILaborRepo(IGuildScopedRepo):
    def labor_donated_total(self) -> int:
        raise NotImplementedError

    def labor_finds(self, user_id: int, limit: int = 6) -> list[Any]:
        raise NotImplementedError

    def labor_state(self, user_id: int, now: Optional[float] = None, day: str = "") -> dict[str, Any]:
        raise NotImplementedError

    def labor_top(self, limit: int = 10, day: Optional[str] = None, user_id: Optional[int] = None) -> dict[str, Any]:
        raise NotImplementedError

    def labor_click(self, user_id: int, now: Optional[float] = None, day: str = "", rng: Any = None) -> dict[str, Any]:
        raise NotImplementedError

    def labor_click_hours(self, user_id: int, since: float) -> list[Any]:
        raise NotImplementedError

    def labor_collect(self, user_id: int, now: Optional[float] = None, day: str = "", detail: bool = False) -> Any:
        raise NotImplementedError

    def labor_drink(self, user_id: int, now: Optional[float] = None, day: str = "") -> tuple[Any, ...]:
        raise NotImplementedError

    def labor_upgrade(self, user_id: int, tool: str, now: Optional[float] = None, day: str = "") -> tuple[Any, ...]:
        raise NotImplementedError

    def labor_hire(self, user_id: int, kind: str, now: Optional[float] = None, day: str = "") -> tuple[Any, ...]:
        raise NotImplementedError

    def labor_dismiss(self, user_id: int, kind: str, now: Optional[float] = None, day: str = "") -> tuple[Any, ...]:
        raise NotImplementedError

    def labor_dorm(self, user_id: int, now: Optional[float] = None, day: str = "") -> tuple[Any, ...]:
        raise NotImplementedError

    def labor_set_renew(self, user_id: int, on: bool, now: Optional[float] = None, day: str = "") -> tuple[Any, ...]:
        raise NotImplementedError


class IP2PRepo(IGuildScopedRepo):
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
        raise NotImplementedError

    def p2p_label(self, row: Any) -> str:
        raise NotImplementedError

    def p2p_get(self, listing_id: int) -> Any:
        raise NotImplementedError

    def p2p_set_post(self, listing_id: int, channel_id: int, message_id: int) -> None:
        raise NotImplementedError

    def p2p_buy(self, buyer_id: int, listing_id: int, now: Optional[float] = None) -> tuple[Any, ...]:
        raise NotImplementedError

    def p2p_bid(self, bidder_id: int, listing_id: int, amount: int, now: Optional[float] = None) -> tuple[Any, ...]:
        raise NotImplementedError

    def p2p_cancel(self, user_id: int, listing_id: int, now: Optional[float] = None) -> tuple[Any, ...]:
        raise NotImplementedError

    def p2p_pull_back(self, user_id: int, now: Optional[float] = None) -> dict[str, int]:
        raise NotImplementedError

    def p2p_unsynced_posts(self) -> list[Any]:
        raise NotImplementedError

    def p2p_mark_post_done(self, listing_id: int) -> None:
        raise NotImplementedError

    def p2p_settle(self, now: Optional[float] = None) -> list[Any]:
        raise NotImplementedError

    def p2p_active(
        self,
        kind: Optional[str] = None,
        now: Optional[float] = None,
        limit: int = 25,
        mode: Optional[str] = None,
        order: str = "end",
    ) -> list[Any]:
        raise NotImplementedError

    def p2p_count(self, now: Optional[float] = None) -> int:
        raise NotImplementedError

    def p2p_mine(self, user_id: int, now: Optional[float] = None) -> dict[str, Any]:
        raise NotImplementedError


class IWalletRepo(IGuildScopedRepo):
    def balance(self, user_id: int) -> int:
        raise NotImplementedError

    def credit(self, user_id: int, amount: int, reason: str) -> int:
        raise NotImplementedError

    def set_balance(self, user_id: int, amount: int, reason: str) -> tuple[Any, ...]:
        raise NotImplementedError

    def debit_up_to(self, user_id: int, amount: int, reason: str) -> int:
        raise NotImplementedError

    def claim_daily(self, user_id: int, today: datetime.date, slot: Optional[int] = None) -> "DailyResult":
        raise NotImplementedError

    def touch_guild_user(self, guild_id: int, user_id: int) -> None:
        raise NotImplementedError

    def guild_user_ids(self, guild_id: int) -> set[int]:
        raise NotImplementedError

    def wealthy_ids(self) -> set[int]:
        raise NotImplementedError

    def display_status(self, user_id: int, wealthy: Optional[set[Any]] = None) -> str:
        raise NotImplementedError

    def top(self, limit: int = 10, user_ids: Optional[set[Any]] = None) -> list[Any]:
        raise NotImplementedError

    def rank_of(self, user_id: int, user_ids: Optional[set[Any]] = None) -> Optional[tuple[Any, ...]]:
        raise NotImplementedError

    def peek_stats(self, user_id: int) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def stats(self, user_id: int) -> dict[str, Any]:
        raise NotImplementedError

    def history(self, user_id: int, limit: int = 10) -> list[Any]:
        raise NotImplementedError

    def transfer(
        self,
        sender: int,
        receiver: int,
        amount: int,
        fee_rate: float,
        daily_limit: int,
        day_start_ts: float,
        min_games: int = 0,
    ) -> "TransferResult":
        raise NotImplementedError


class IAssetRepo(IGuildScopedRepo):
    def horse_worth(self, races: int, wins: int, places: int) -> int:
        raise NotImplementedError

    def asset_parts(self, now: Optional[float] = None) -> dict[int, dict[str, int]]:
        raise NotImplementedError

    def final_assets(self, user_ids: Optional[set[Any]] = None, now: Optional[float] = None) -> list[Any]:
        raise NotImplementedError

    def final_top(self, limit: int = 10, user_ids: Optional[set[Any]] = None) -> list[Any]:
        raise NotImplementedError

    def final_rank_of(self, user_id: int, user_ids: Optional[set[Any]] = None) -> Optional[tuple[Any, ...]]:
        raise NotImplementedError


class IArenaRepo(IGuildScopedRepo):
    def arena_today(self, now: float, tz_hours: float = 9.0) -> str:
        raise NotImplementedError

    def arena_tournament_ensure(
        self, now: Optional[float] = None, tz_hours: float = 9.0, rng: Optional[random.Random] = None
    ) -> dict[str, Any]:
        raise NotImplementedError

    def arena_tournament_get_by_day(self, day: str) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def arena_fighters(self, tournament_id: int) -> list[Any]:
        raise NotImplementedError

    def arena_bet(self, user_id: int, fighter_id: int, amount: int, now: Optional[float] = None) -> tuple[Any, ...]:
        raise NotImplementedError

    def arena_run_semis(self, tournament_id: int, rng: Optional[random.Random] = None) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def arena_run_final(self, tournament_id: int, rng: Optional[random.Random] = None) -> Optional[dict[str, Any]]:
        raise NotImplementedError

    def arena_my_bets(self, tournament_id: int, user_id: int) -> list[Any]:
        raise NotImplementedError

    def arena_bets_breakdown(self, tournament_id: int) -> dict[int, list[Any]]:
        raise NotImplementedError


@dataclass(frozen=True)
class IRepositoryBundle(IGuildScopedRepo):
    """単一責務（SRP）の抽象リポジトリ群を束ねる Composition Root 用契約。"""

    notices: INoticeRepo
    rtp: IRtpRepo
    events: IEventRepo
    pachinko: IPachinkoRepo
    relics: IRelicRepo
    market: IMarketDataRepo
    market_events: IMarketEventRepo
    records: IRecordRepo
    raffle: IRaffleRepo
    guild: IGuildRepo
    bank: IBankRepo
    debt: IDebtRepo
    loans: ILoanRepo
    shop: IShopRepo
    auction: IAuctionRepo
    escrow: IEscrowRepo
    quiz: IQuizRepo
    horses: IHorseRepo
    races: IRaceRepo
    labor: ILaborRepo
    arena: IArenaRepo
    earnings: IEarningsRepo
    crypto: ICryptoRepo
    margin: IMarginRepo
    bonds: IBondRepo
    options: IOptionRepo
    p2p: IP2PRepo
    wallet: IWalletRepo
    assets: IAssetRepo

    def close(self) -> None:
        raise NotImplementedError
