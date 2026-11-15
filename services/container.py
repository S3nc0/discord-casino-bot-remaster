"""アプリケーションサービス群のコンテナと配線ヘルパー（Composition Root 用）。"""

from dataclasses import dataclass
from typing import Any

from domain.ports.clock import IClock
from domain.ports.repos import IRepositoryBundle
from domain.ports.session import ISessionGuard
from infra.clock import ConfigClock
from services.casino import CasinoService
from services.economy import EconomyService
from services.horse import HorseService
from services.labor import LaborService
from services.market import MarketService


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
    )
