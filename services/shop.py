"""ショップ・帝愛の競売・装備・称号のアプリケーションサービス。"""

from dataclasses import dataclass
from typing import Any, Optional

from domain import shop, teiai
from domain.ports.repos import (
    IAuctionRepo,
    IDebtRepo,
    IEarningsRepo,
    IGuildRepo,
    IHorseRepo,
    IP2PRepo,
    IShopRepo,
    IWalletRepo,
)
from domain.types import CONSUMABLE_EFFECTS


@dataclass(frozen=True)
class BuyItemPrecheck:
    ok: bool
    status: str = ""
    stock: Optional[dict[str, Any]] = None
    balance: int = 0
    total: int = 0


class ShopService:
    """ショップ・帝愛の競売・持ち物・称号解決のユースケース調停役。"""

    def __init__(
        self,
        shop_repo: IShopRepo,
        auction: IAuctionRepo,
        horses: IHorseRepo,
        earnings: IEarningsRepo,
        debt: IDebtRepo,
        p2p: IP2PRepo,
        wallet: IWalletRepo,
        guild: IGuildRepo,
    ) -> None:
        self.shop = shop_repo
        self.auction = auction
        self.horses = horses
        self.earnings = earnings
        self.debt = debt
        self.p2p = p2p
        self.wallet = wallet
        self.guild = guild

    def peek_balance(self, guild_id: int, user_id: int) -> int:
        me = self.wallet.for_guild(guild_id).peek_stats(user_id)
        return me["balance"] if me else 0

    def stocks_for_items(self, guild_id: int, user_id: int, items: list[shop.Item]) -> dict[str, dict[str, Any]]:
        repo = self.shop.for_guild(guild_id)
        out: dict[str, dict[str, Any]] = {}
        for item in items:
            if item.id in shop.STOCK_RULES:
                st = repo.shop_stock(user_id, item.id)
                if st is not None:
                    out[item.id] = st
        return out

    def precheck_buy(self, guild_id: int, user_id: int, item: shop.Item, qty: int) -> BuyItemPrecheck:
        shop_repo = self.shop.for_guild(guild_id)
        balance = self.wallet.for_guild(guild_id).balance(user_id)
        total = item.price * qty
        if item.unique and shop_repo.inventory(user_id).get(item.id, 0) > 0:
            return BuyItemPrecheck(ok=False, status="owned", balance=balance, total=total)
        stock = shop_repo.shop_stock(user_id, item.id)
        if stock is not None and qty > stock["stock"]:
            return BuyItemPrecheck(ok=False, status="out_of_stock", stock=stock, balance=balance, total=total)
        if balance < total:
            return BuyItemPrecheck(ok=False, status="insufficient_balance", balance=balance, total=total)
        return BuyItemPrecheck(ok=True, balance=balance, total=total)

    def arm_consumable(self, guild_id: int, user_id: int, item_id: str) -> Optional[int]:
        """消耗品を有効化し、有効になった残り枚数を返す（未所持なら None）。"""
        repo = self.shop.for_guild(guild_id)
        if not repo.arm(user_id, item_id):
            return None
        return int(repo.get_profile(user_id)[CONSUMABLE_EFFECTS[item_id]])

    def catalog_snapshot(self, guild_id: int, user_id: int, tab: str, items: list[shop.Item]) -> dict[str, Any]:
        """カタログ画面描画・選択肢構築用のスナップショットを 1 回の取得で組む。"""
        inv = self.shop.for_guild(guild_id).inventory(user_id)
        balance = self.peek_balance(guild_id, user_id)
        waiting = (
            len(self.auction.for_guild(guild_id).auction_list()) + len(self.horses.for_guild(guild_id).auction_horses())
            if tab == "home"
            else 0
        )
        stocks = self.stocks_for_items(guild_id, user_id, items) if tab != "home" else {}
        return {"inv": inv, "balance": balance, "waiting": waiting, "stocks": stocks}

    def auction_snapshot(
        self,
        guild_id: int,
        user_id: int,
        tab: Optional[str],
        p2p_enabled: bool,
        kind: Optional[str],
        mode: Optional[str],
        order: str,
        limit: int,
    ) -> dict[str, Any]:
        """競売画面描画・選択肢構築用のスナップショット（二重クエリ防止）。"""
        listed = self.auction.for_guild(guild_id).auction_list()
        horses = self.horses.for_guild(guild_id).auction_horses()
        p2p_repo = self.p2p.for_guild(guild_id)
        p2p_total = p2p_repo.p2p_count() if p2p_enabled else 0
        resolved_tab = tab if tab is not None else ("players" if p2p_enabled and p2p_total else "teiai")
        if not p2p_enabled:
            resolved_tab = "teiai"
        p2p_rows: list[tuple[dict[str, Any], str]] = []
        if resolved_tab == "players":
            rows = p2p_repo.p2p_active(kind, limit=limit, mode=mode, order=order)
            p2p_rows = [(r, p2p_repo.p2p_label(r)) for r in rows]
        return {
            "balance": self.peek_balance(guild_id, user_id),
            "listed": listed,
            "horses": horses,
            "p2p_total": p2p_total,
            "tab": resolved_tab,
            "p2p_rows": p2p_rows,
        }

    def equipped_title(self, guild_id: int, user_id: int) -> Optional[str]:
        item = shop.BY_ID.get(self.shop.for_guild(guild_id).get_profile(user_id)["title"])
        return item.name if item else None

    def nick_tag(self, guild_id: int, user_id: int) -> Optional[str]:
        status = self.debt.for_guild(guild_id).status(user_id)
        if status != teiai.KATAGI:
            return teiai.STATUS_NAME[status]
        if self.guild.nick_pref(guild_id, user_id):
            return self.equipped_title(guild_id, user_id)
        return (
            teiai.STATUS_NAME[teiai.WEALTHY]
            if self.wallet.for_guild(guild_id).display_status(user_id) == teiai.WEALTHY
            else None
        )
