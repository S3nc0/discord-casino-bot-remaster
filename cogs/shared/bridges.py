"""Cog 間・DynamicItem 間の疎結合ブリッジ契約（名前的基底クラス）とレジストリ。"""

from dataclasses import dataclass
from typing import Optional

import discord


class IApprovalBridge:
    """サーバー承認フロー（approval_guard / ApprovalButton → ApprovalCog）のブリッジ契約。"""

    async def ensure_requested(self, guild: discord.Guild, reset_denied: bool = False) -> None:
        raise NotImplementedError

    async def announce_approved(self, guild: discord.Guild) -> None:
        raise NotImplementedError

    async def handle_button(self, interaction: discord.Interaction, allow: bool, guild_id: int) -> None:
        raise NotImplementedError


class IShopTitleBridge:
    """ショップの称号・ニックネーム同期（Economy / Weekly → ShopCog）のブリッジ契約。"""

    async def sync_title_nick(
        self,
        user_id: int,
        here: Optional[discord.Guild] = None,
        member: Optional[discord.Member] = None,
    ) -> tuple[str, int]:
        raise NotImplementedError

    async def after_bankruptcy(self, guild: discord.Guild, member: discord.Member) -> None:
        raise NotImplementedError


class IEventAdminBridge:
    """運営向けイベント操作（Admin → EventCog）のブリッジ契約。"""

    async def start_manual(
        self,
        guild: discord.Guild,
        game: str,
        boost_pct: int,
        minutes: int,
        channel: Optional[discord.abc.Messageable] = None,
    ) -> tuple[bool, str]:
        raise NotImplementedError

    async def stop_manual(self, guild: discord.Guild) -> tuple[bool, str]:
        raise NotImplementedError


class IHorseRaceBridge:
    """競馬操作とレースボタン（Admin / RaceButton / BetPanel → HorseCog）のブリッジ契約。"""

    async def start_special(
        self,
        guild: discord.Guild,
        entry_min: int,
        bet_min: int,
        channel: Optional[discord.abc.Messageable] = None,
    ) -> int:
        raise NotImplementedError

    async def handle_button(self, interaction: discord.Interaction, action: str, race_id: int) -> None:
        raise NotImplementedError


class IRaffleAdminBridge:
    """運営向け抽選操作（Admin → RaffleCog）のブリッジ契約。"""

    async def host(
        self,
        guild: discord.Guild,
        host_id: int,
        fee: Optional[int] = None,
        minutes: int = 60,
        channel: Optional[discord.abc.Messageable] = None,
    ) -> tuple[bool, str]:
        raise NotImplementedError

    async def repost(self, guild: discord.Guild, channel: Optional[discord.abc.Messageable] = None) -> tuple[bool, str]:
        raise NotImplementedError

    async def cancel(self, guild: discord.Guild) -> tuple[bool, str]:
        raise NotImplementedError


class IQuizAdminBridge:
    """運営向けクイズ操作と公開回答ボタン（Admin / PublicButton → QuizCog）のブリッジ契約。"""

    def add_modal(
        self,
        announce: bool,
        guild: Optional[discord.Guild],
        channel: Optional[discord.abc.Messageable],
    ) -> discord.ui.Modal:
        raise NotImplementedError

    async def broadcast(
        self,
        quiz_id: int,
        guild: Optional[discord.Guild] = None,
        channel: Optional[discord.abc.Messageable] = None,
    ) -> int:
        raise NotImplementedError

    def listing_embed(self) -> discord.Embed:
        raise NotImplementedError

    def remove(self, quiz_id: int) -> bool:
        raise NotImplementedError

    async def handle_button(self, interaction: discord.Interaction, quiz_id: int, pos: int) -> None:
        raise NotImplementedError


class IP2PNavigationBridge:
    """P2P 画面遷移と出品カードボタン（Shop / ListingButton → P2PCog）のブリッジ契約。"""

    async def open_detail(self, interaction: discord.Interaction, listing_id: int) -> None:
        raise NotImplementedError

    async def open_sell(self, interaction: discord.Interaction) -> None:
        raise NotImplementedError

    async def open_mine(self, interaction: discord.Interaction) -> None:
        raise NotImplementedError


class ILoanButtonBridge:
    """個人間貸付ボタン（LoanButton → LoanCog）のブリッジ契約。"""

    async def handle_button(self, interaction: discord.Interaction, action: str, loan_id: int) -> None:
        raise NotImplementedError


@dataclass
class BotBridges:
    """Bot 実行時にロードされた各 Cog のブリッジ実装を束ねるコンテナ。"""

    approval: Optional[IApprovalBridge] = None
    shop: Optional[IShopTitleBridge] = None
    event: Optional[IEventAdminBridge] = None
    horse: Optional[IHorseRaceBridge] = None
    raffle: Optional[IRaffleAdminBridge] = None
    quiz: Optional[IQuizAdminBridge] = None
    p2p: Optional[IP2PNavigationBridge] = None
    loan: Optional[ILoanButtonBridge] = None
