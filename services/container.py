"""アプリケーションサービス群のコンテナと配線ヘルパー（Composition Root 用）。"""

from dataclasses import dataclass
from typing import Any

from domain.ports.clock import IClock
from domain.ports.repos import IRepositoryBundle
from domain.ports.session import ISessionGuard
from infra.clock import ConfigClock
from services.arena import ArenaService
from services.casino import CasinoService
from services.economy import EconomyService
from services.horse import HorseService
from services.labor import LaborService
from services.loan import LoanService
from services.market import MarketService
from services.p2p import P2PService
from services.shop import ShopService


@dataclass(frozen=True)
class ServiceRegistry:
    """全アプリケーションサービスを束ねるレジストリ。"""

    clock: IClock
    sessions: ISessionGuard
    casino: CasinoService
    market: MarketService
    horse: HorseService
    economy: EconomyService
    labor: LaborService
    arena: ArenaService
    loan: LoanService
    p2p: P2PService
    shop: ShopService


def build_services(config: dict[str, Any], repos: IRepositoryBundle, sessions: ISessionGuard) -> ServiceRegistry:
    clock = ConfigClock(config)
    return ServiceRegistry(
        clock=clock,
        sessions=sessions,
        casino=CasinoService(
            wallet=repos.wallet,
            escrow=repos.escrow,
            shop=repos.shop,
            rtp=repos.rtp,
            events=repos.events,
            notices=repos.notices,
            records=repos.records,
            sessions=sessions,
            clock=clock,
            debt=repos.debt,
            pachinko=repos.pachinko,
        ),
        market=MarketService(
            market_data=repos.market,
            market_events_repo=repos.market_events,
            earnings_repo=repos.earnings,
            crypto=repos.crypto,
            margin=repos.margin,
            bonds_repo=repos.bonds,
            options_repo=repos.options,
            config=config,
        ),
        horse=HorseService(races=repos.races, config=config),
        economy=EconomyService(
            wallet=repos.wallet,
            notices=repos.notices,
            earnings=repos.earnings,
            records=repos.records,
            clock=clock,
            config=config,
        ),
        labor=LaborService(labor=repos.labor, clock=clock, config=config),
        arena=ArenaService(arena=repos.arena, clock=clock),
        loan=LoanService(loans=repos.loans, clock=clock),
        p2p=P2PService(
            p2p=repos.p2p,
            horses=repos.horses,
            shop=repos.shop,
            wallet=repos.wallet,
        ),
        shop=ShopService(
            shop_repo=repos.shop,
            auction=repos.auction,
            horses=repos.horses,
            earnings=repos.earnings,
            debt=repos.debt,
            p2p=repos.p2p,
            wallet=repos.wallet,
            guild=repos.guild,
        ),
    )
