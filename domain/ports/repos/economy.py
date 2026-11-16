"""経済・通知・履歴・ギルド設定・資産集計のリポジトリポート契約。"""

import datetime
from typing import TYPE_CHECKING, Any, Iterable, Optional

from domain.ports.bridges import INoticeSink
from domain.ports.repos.base import IGuildScopedRepo

if TYPE_CHECKING:
    from domain.errors import Notice
    from domain.types import DailyResult, TransferResult


class INoticeRepo(IGuildScopedRepo, INoticeSink):
    def take_notices(self, user_id: int) -> list["Notice"]:
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
