"""アプリケーションサービス群のコンテナと配線ヘルパー（Composition Root 用）。"""

from dataclasses import dataclass
from typing import Any

from domain.ports.clock import IClock
from domain.ports.repos import IRepositoryBundle
from domain.ports.session import ISessionGuard
from infra.clock import ConfigClock
from services.arena import ArenaService
from services.casino import CasinoService
from services.company import CompanyService
from services.economy import EconomyService
from services.horse import HorseService
from services.labor import LaborService
from services.loan import LoanService
from services.market import MarketService
from services.ranking import RankingService
from services.shop import ShopService
from services.teiai import TeiaiService


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
    company: CompanyService
    loan: LoanService
    shop: ShopService
    teiai: TeiaiService
    ranking: RankingService


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
            clock=clock,
        ),
        horse=HorseService(races=repos.races, clock=clock),
        economy=EconomyService(
            wallet=repos.wallet,
            notices=repos.notices,
            earnings=repos.earnings,
            records=repos.records,
            clock=clock,
            shop=repos.shop,
            crypto=repos.crypto,
            bonds=repos.bonds,
        ),
        labor=LaborService(labor=repos.labor, clock=clock),
        arena=ArenaService(arena=repos.arena, clock=clock),
        company=CompanyService(company=repos.company, clock=clock),
        loan=LoanService(loans=repos.loans, clock=clock),
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
        teiai=TeiaiService(
            bank=repos.bank,
            debt=repos.debt,
            wallet=repos.wallet,
            notices=repos.notices,
            loans=repos.loans,
            clock=clock,
        ),
        ranking=RankingService(wallet=repos.wallet, crypto=repos.crypto, bonds=repos.bonds, assets=repos.assets),
    )
