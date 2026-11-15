"""地下作業の発掘品（保有照会・効果集計・合体）（Economy に混ぜ込む部品）。"""

from domain import relics as relics_mod
from domain.errors import fail
from infra.db.base import EcoBase


class RelicMixin(EcoBase):
    """発掘品のバフ集計・在庫照会・合体。"""

    def _relic_buffs(self, user_id: int) -> dict:
        """持っている発掘品の効果 {効果の名前: 上がり幅}（個数ぶん重なる。出品中の品は持ち物にないので、効かない）。"""
        held = {
            r["item_id"]: r["qty"]
            for r in self._conn.execute(
                "SELECT item_id, qty FROM inventory WHERE guild_id=? AND user_id=? AND qty>0 AND item_id LIKE 'relic_%'",
                (self._g(), user_id),
            )
        }
        return relics_mod.buffs_of(held)

    def relic_stock(self, user_id: int) -> dict:
        """持ち物にある発掘品 {品のID: 個数}（★つきも含む）。"""
        with self._lock:
            return {
                r["item_id"]: r["qty"]
                for r in self._conn.execute(
                    "SELECT item_id, qty FROM inventory WHERE guild_id=? AND user_id=? AND qty>0 AND item_id LIKE 'relic_%'",
                    (self._g(), user_id),
                )
            }

    def relic_merge(self, user_id: int, item_id: str) -> tuple:
        """同じ発掘品を MERGE_COUNT 個つかって、★が1つ増えた1個に合体する。(成功か, 理由か合体後の品のID)。"""
        base, star = relics_mod.split_id(item_id)
        if base not in relics_mod.BUFFS:
            return False, fail("relic_not_relic")
        if star >= relics_mod.STAR_MAX:
            return False, fail("relic_max_star", star_max=relics_mod.STAR_MAX)
        new_id = relics_mod.star_id(base, star + 1)
        with self._lock, self._conn:
            self._ensure(user_id)
            cur = self._conn.execute(
                "UPDATE inventory SET qty = qty - ? WHERE guild_id=? AND user_id=? AND item_id=? AND qty >= ?",
                (relics_mod.MERGE_COUNT, self._g(), user_id, item_id, relics_mod.MERGE_COUNT),
            )
            if cur.rowcount == 0:
                return False, fail("relic_need_more", count=relics_mod.MERGE_COUNT)
            self._conn.execute(
                "INSERT INTO inventory (guild_id, user_id, item_id, qty) VALUES (?, ?, ?, 1) "
                "ON CONFLICT(guild_id, user_id, item_id) DO UPDATE SET qty = qty + 1",
                (self._g(), user_id, new_id),
            )
        return True, new_id
