"""プレイヤー間市場（出品・購入・入札・精算）のアプリケーションサービス。"""

from typing import Any, Optional

from domain.ports.repos import IHorseRepo, IP2PRepo, IShopRepo, IWalletRepo


class P2PService:
    """プレイヤー間売買・競り・出品者手持ち照会の調停役。"""

    def __init__(
        self,
        p2p: IP2PRepo,
        horses: IHorseRepo,
        shop: IShopRepo,
        wallet: IWalletRepo,
    ) -> None:
        self._p2p = p2p
        self._horses = horses
        self._shop = shop
        self._wallet = wallet

    def get(self, guild_id: int, listing_id: int) -> Optional[dict[str, Any]]:
        return self._p2p.for_guild(guild_id).p2p_get(listing_id)

    def label(self, guild_id: int, row: dict[str, Any]) -> str:
        return self._p2p.for_guild(guild_id).p2p_label(row)

    def horse_of_listing(self, guild_id: int, row: dict[str, Any]) -> Optional[dict[str, Any]]:
        if row["kind"] != "horse":
            return None
        return self._horses.for_guild(guild_id).horse_get(int(row["ref"]))

    def mine(self, guild_id: int, user_id: int) -> dict[str, Any]:
        return self._p2p.for_guild(guild_id).p2p_mine(user_id)

    def wallet_balance(self, guild_id: int, user_id: int) -> int:
        return self._wallet.for_guild(guild_id).balance(user_id)

    def inventory(self, guild_id: int, user_id: int) -> dict[str, Any]:
        return self._shop.for_guild(guild_id).inventory(user_id)

    def horses(self, guild_id: int, user_id: int) -> list[Any]:
        return self._horses.for_guild(guild_id).horse_list(user_id)

    def list_item(
        self,
        guild_id: int,
        seller_id: int,
        kind: str,
        ref: str,
        qty: int,
        mode: str,
        price: int,
        hours: Optional[int],
    ) -> tuple[Any, ...]:
        return self._p2p.for_guild(guild_id).p2p_list(seller_id, kind, ref, qty, mode, price, hours)

    def cancel(self, guild_id: int, user_id: int, listing_id: int) -> tuple[Any, ...]:
        return self._p2p.for_guild(guild_id).p2p_cancel(user_id, listing_id)

    def buy(self, guild_id: int, buyer_id: int, listing_id: int) -> tuple[Any, ...]:
        return self._p2p.for_guild(guild_id).p2p_buy(buyer_id, listing_id)

    def bid(self, guild_id: int, bidder_id: int, listing_id: int, amount: int) -> tuple[Any, ...]:
        return self._p2p.for_guild(guild_id).p2p_bid(bidder_id, listing_id, amount)

    def set_post(self, guild_id: int, listing_id: int, channel_id: int, message_id: int) -> None:
        self._p2p.for_guild(guild_id).p2p_set_post(listing_id, channel_id, message_id)

    def mark_post_done(self, guild_id: int, listing_id: int) -> None:
        self._p2p.for_guild(guild_id).p2p_mark_post_done(listing_id)

    def settle(self, guild_id: int) -> list[Any]:
        return self._p2p.for_guild(guild_id).p2p_settle()

    def unsynced_posts(self, guild_id: int) -> list[Any]:
        return self._p2p.for_guild(guild_id).p2p_unsynced_posts()
