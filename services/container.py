"""アプリケーションサービス群のコンテナと配線ヘルパー（Composition Root 用）。"""

from dataclasses import dataclass
from typing import Any

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

    sessions: ISessionGuard
    casino: CasinoService
    market: MarketService
    horse: HorseService
    economy: EconomyService
    labor: LaborService


def build_services(config: dict[str, Any], repos: IRepositoryBundle, sessions: ISessionGuard) -> ServiceRegistry:
    clock = ConfigClock(config)
    return ServiceRegistry(
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


def services_of(bot: Any) -> ServiceRegistry:
    """`bot.services` を返す。Milestone C 完了までの FakeBot 互換解決を含む。"""
    existing = getattr(bot, "services", None)
    if existing is not None:
        return existing
    config = getattr(bot, "config", {}) or {}
    sessions = getattr(bot, "sessions", None)
    if sessions is None:
        from services.session import Sessions

        sessions = Sessions()
    repos = getattr(bot, "repos", None)
    if repos is None:
        eco_obj = bot.economy
        repos = getattr(eco_obj, "_repos", None)
        if repos is None:
            repos = eco_obj.for_guild(1)._repos
    return build_services(config, repos, sessions)
