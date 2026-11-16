"""地下闘技場の大会進行・賭け・状況照会のアプリケーションサービス。"""

import datetime
from typing import Any, Optional

from domain.ports.clock import IClock
from domain.ports.repos import IArenaRepo

_JST = datetime.timezone(datetime.timedelta(hours=9))


class ArenaService:
    """地下闘技場の大会時刻・生成・賭け実行の調停役。"""

    def __init__(self, arena: IArenaRepo, clock: IClock) -> None:
        self.arena = arena
        self.clock = clock

    def jst_hour(self, now: Optional[float] = None) -> int:
        ts = self.clock.now_ts() if now is None else now
        return datetime.datetime.fromtimestamp(ts, _JST).hour

    def ensure_tournament(self, guild_id: int, fmt: str, now: Optional[float] = None) -> dict[str, Any]:
        ts = self.clock.now_ts() if now is None else now
        return self.arena.for_guild(guild_id).arena_tournament_ensure(fmt, ts)

    def place_bet(
        self, guild_id: int, user_id: int, fighter_id: int, stake: int, now: Optional[float] = None
    ) -> tuple[Any, ...]:
        ts = self.clock.now_ts() if now is None else now
        return self.arena.for_guild(guild_id).arena_bet(user_id, fighter_id, stake, ts)
