"""地下作業のアプリケーションサービス（日付キー解決・クリック不正検知レポート）。"""

from typing import Any

from domain import labor as labor_mod
from domain.ports.clock import IClock
from domain.ports.repos import ILaborRepo


class LaborService:
    """地下作業の日付キー・クリック分析レポート取得を担う。"""

    def __init__(self, labor: ILaborRepo, clock: IClock) -> None:
        self._labor = labor
        self.clock = clock

    def today_key(self) -> str:
        return self.clock.today().isoformat()

    def click_report(self, guild_id: int, user_id: int, hours: int) -> dict[str, Any]:
        rows = self._labor.for_guild(guild_id).labor_click_hours(user_id, self.clock.now_ts() - hours * 3600)
        return labor_mod.click_report(rows)
