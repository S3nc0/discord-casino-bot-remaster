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
from domain.types import PurchaseResult


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
        self._shop = shop_repo
        self._auction = auction
        self._horses = horses
        self._earnings = earnings
        self._debt = debt
        self._p2p = p2p
        self._wallet = wallet
        self._guild = guild

    def inventory(self, guild_id: int, user_id: int) -> dict[str, Any]:
        return self._shop.for_guild(guild_id).inventory(user_id)

    def profile(self, guild_id: int, user_id: int) -> dict[str, Any]:
        return self._shop.for_guild(guild_id).get_profile(user_id)

    def peek_balance(self, guild_id: int, user_id: int) -> int:
        me = self._wallet.for_guild(guild_id).peek_stats(user_id)
        return me["balance"] if me else 0

    def stock_of(self, guild_id: int, user_id: int, item_id: str) -> Optional[dict[str, Any]]:
        return self._shop.for_guild(guild_id).shop_stock(user_id, item_id)

    def stocks_for_items(self, guild_id: int, user_id: int, items: list[shop.Item]) -> dict[str, dict[str, Any]]:
        repo = self._shop.for_guild(guild_id)
        out: dict[str, dict[str, Any]] = {}
        for item in items:
            if item.id in shop.STOCK_RULES:
                st = repo.shop_stock(user_id, item.id)
                if st is not None:
                    out[item.id] = st
        return out

    def precheck_buy(self, guild_id: int, user_id: int, item: shop.Item, qty: int) -> BuyItemPrecheck:
        shop_repo = self._shop.for_guild(guild_id)
        balance = self._wallet.for_guild(guild_id).balance(user_id)
        total = item.price * qty
        if item.unique and shop_repo.inventory(user_id).get(item.id, 0) > 0:
            return BuyItemPrecheck(ok=False, status="owned", balance=balance, total=total)
        stock = shop_repo.shop_stock(user_id, item.id)
        if stock is not None and qty > stock["stock"]:
            return BuyItemPrecheck(ok=False, status="out_of_stock", stock=stock, balance=balance, total=total)
        if balance < total:
            return BuyItemPrecheck(ok=False, status="insufficient_balance", balance=balance, total=total)
        return BuyItemPrecheck(ok=True, balance=balance, total=total)

    def purchase_item(self, guild_id: int, user_id: int, item: shop.Item, qty: int) -> PurchaseResult:
        return self._shop.for_guild(guild_id).purchase(user_id, item.id, shop.label(item), item.price, item.unique, qty)

    def arm_item(self, guild_id: int, user_id: int, item_id: str) -> bool:
        return self._shop.for_guild(guild_id).arm(user_id, item_id)

    def equip_slot(self, guild_id: int, user_id: int, slot: str, item_id: Optional[str]) -> bool:
        return self._shop.for_guild(guild_id).equip(user_id, slot, item_id)

    def auction_items(self, guild_id: int) -> list[Any]:
        return self._auction.for_guild(guild_id).auction_list()

    def auction_horses(self, guild_id: int) -> list[Any]:
        return self._horses.for_guild(guild_id).auction_horses()

    def buy_auction_item(self, guild_id: int, user_id: int, item_id: str, qty: int) -> PurchaseResult:
        return self._auction.for_guild(guild_id).auction_buy(user_id, item_id, qty)

    def buy_auction_horse(self, guild_id: int, user_id: int, horse_id: int) -> PurchaseResult:
        return self._horses.for_guild(guild_id).auction_buy_horse(user_id, horse_id)

    def insider_stock(self, guild_id: int) -> Optional[dict[str, Any]]:
        return self._earnings.for_guild(guild_id).insider_stock()

    def buy_insider_memo(self, guild_id: int, user_id: int) -> tuple[Any, ...]:
        return self._earnings.for_guild(guild_id).insider_buy(user_id)

    def p2p_count(self, guild_id: int) -> int:
        return self._p2p.for_guild(guild_id).p2p_count()

    def p2p_active(self, guild_id: int, kind: Optional[str], limit: int, mode: Optional[str], order: str) -> list[Any]:
        return self._p2p.for_guild(guild_id).p2p_active(kind, limit=limit, mode=mode, order=order)

    def p2p_label(self, guild_id: int, row: dict[str, Any]) -> str:
        return self._p2p.for_guild(guild_id).p2p_label(row)

    def equipped_title(self, guild_id: int, user_id: int) -> Optional[str]:
        item = shop.BY_ID.get(self._shop.for_guild(guild_id).get_profile(user_id)["title"])
        return item.name if item else None

    def nick_tag(self, guild_id: int, user_id: int) -> Optional[str]:
        status = self._debt.for_guild(guild_id).status(user_id)
        if status != teiai.KATAGI:
            return teiai.STATUS_NAME[status]
        if self._guild.nick_pref(guild_id, user_id):
            return self.equipped_title(guild_id, user_id)
        return (
            teiai.STATUS_NAME[teiai.WEALTHY]
            if self._wallet.for_guild(guild_id).display_status(user_id) == teiai.WEALTHY
            else None
        )
