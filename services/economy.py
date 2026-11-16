"""経済・デイリー・送金・週間ランキング補完のアプリケーションサービス。"""

import datetime
from dataclasses import dataclass
from typing import Optional

from domain.earnings import MemoInfo
from domain.ports.clock import IClock
from domain.ports.repos import IEarningsRepo, INoticeRepo, IRecordRepo, IWalletRepo
from domain.types import DailyResult, TransferResult


@dataclass(frozen=True)
class DailyClaimOutcome:
    result: DailyResult
    memo: Optional[MemoInfo] = None


class EconomyService:
    """デイリーボーナス・送金・週間集計補完のユースケース調整。"""

    def __init__(
        self,
        wallet: IWalletRepo,
        notices: INoticeRepo,
        earnings: IEarningsRepo,
        records: IRecordRepo,
        clock: IClock,
    ) -> None:
        self._wallet = wallet
        self._notices = notices
        self._earnings = earnings
        self._records = records
        self.clock = clock

    def claim_daily(self, guild_id: int, user_id: int, now: datetime.datetime, slot: int) -> DailyClaimOutcome:
        """デイリー受取・一時通知の掃き出し・裏情報メモ抽選を 1 ユースケースとして実行する。"""
        result = self._wallet.for_guild(guild_id).claim_daily(user_id, now.date(), slot)
        if not result.ok:
            return DailyClaimOutcome(result=result)
        self._notices.for_guild(guild_id).take_notices(user_id)
        memo = self._earnings.for_guild(guild_id).earnings_memo(user_id, now.timestamp())
        return DailyClaimOutcome(result=result, memo=memo)

    def transfer(
        self,
        guild_id: int,
        sender_id: int,
        receiver_id: int,
        amount: int,
        fee_rate: float,
        daily_limit: int,
        min_games: int,
        now: Optional[datetime.datetime] = None,
    ) -> TransferResult:
        now = self.clock.now() if now is None else now
        day_start = datetime.datetime.combine(now.date(), datetime.time(), tzinfo=now.tzinfo).timestamp()
        return self._wallet.for_guild(guild_id).transfer(
            sender_id, receiver_id, amount, fee_rate, daily_limit, day_start, min_games
        )

    def backfill_weekly(self) -> int:
        return self._records.backfill_weekly(self.clock.offset_hours())
