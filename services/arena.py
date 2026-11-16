"""地下闘技場の大会進行・賭け・状況照会のアプリケーションサービス。"""

import datetime
from typing import Any, Optional

from domain.ports.clock import IClock
from domain.ports.repos import IArenaRepo

_JST = datetime.timezone(datetime.timedelta(hours=9))


class ArenaService:
    """地下闘技場の大会生成・準決勝/決勝進行・賭け実行の調停役。"""

    def __init__(self, arena: IArenaRepo, clock: IClock) -> None:
        self._arena = arena
        self._clock = clock

    def now_ts(self) -> float:
        return self._clock.now().timestamp()

    def jst_hour(self, now: Optional[float] = None) -> int:
        ts = self.now_ts() if now is None else now
        return datetime.datetime.fromtimestamp(ts, _JST).hour

    def ensure_tournament(self, guild_id: int, fmt: str, now: Optional[float] = None) -> dict[str, Any]:
        ts = self.now_ts() if now is None else now
        return self._arena.for_guild(guild_id).arena_tournament_ensure(fmt, ts)

    def tournament_by_day(self, guild_id: int, day: str, fmt: str) -> Optional[dict[str, Any]]:
        return self._arena.for_guild(guild_id).arena_tournament_get_by_day(day, fmt)

    def bets_breakdown(self, guild_id: int, tournament_id: int) -> dict[int, list[Any]]:
        return self._arena.for_guild(guild_id).arena_bets_breakdown(tournament_id)

    def run_semis(self, guild_id: int, tournament_id: int) -> Optional[dict[str, Any]]:
        return self._arena.for_guild(guild_id).arena_run_semis(tournament_id)

    def run_final(self, guild_id: int, tournament_id: int) -> Optional[dict[str, Any]]:
        return self._arena.for_guild(guild_id).arena_run_final(tournament_id)

    def place_bet(
        self, guild_id: int, user_id: int, fighter_id: int, stake: int, now: Optional[float] = None
    ) -> tuple[Any, ...]:
        ts = self.now_ts() if now is None else now
        return self._arena.for_guild(guild_id).arena_bet(user_id, fighter_id, stake, ts)
