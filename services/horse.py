"""競馬のレース進行・オッズ計算・スケジュール管理のアプリケーションサービス。"""

from typing import Any, Optional

from domain import horse as horse_mod
from domain.ports.clock import IClock
from domain.ports.repos import IRaceRepo


class HorseService:
    """定時レースのスケジュール作成・締切オッズ確定・発走精算の調整役。"""

    def __init__(self, races: IRaceRepo, clock: IClock) -> None:
        self._races = races
        self.clock = clock

    def next_slots(self, guild_id: int, now: Optional[float] = None) -> list[float]:
        now = self.clock.now_ts() if now is None else now
        return self._races.for_guild(guild_id).race_slots(now, self.clock.offset_hours())

    def ensure_scheduled(self, guild_id: int, now: float, channel_id: int) -> Optional[int]:
        return self._races.for_guild(guild_id).race_ensure_scheduled(now, self.clock.offset_hours(), channel_id)

    def close_entries_and_set_odds(self, guild_id: int, race_id: int) -> Optional[dict[str, Any]]:
        """出走申込を締め切ってオッズを計算・保存し、最新の race 辞書を返す。"""
        races = self._races.for_guild(guild_id)
        field = races.race_close_entries(race_id)
        if field is None:
            return None
        races.race_set_odds(race_id, horse_mod.make_all_odds(field["runners"]))
        return races.race_get(race_id)

    def run_race(self, guild_id: int, race_id: int) -> Optional[dict[str, Any]]:
        """レースを実行して賞金・馬券を精算し、演出結果辞書を返す。"""
        return self._races.for_guild(guild_id).race_run(race_id, tz_hours=self.clock.offset_hours())
