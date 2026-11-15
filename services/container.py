"""アプリケーションサービス群のコンテナと解決ヘルパー（Composition Root 用）。"""

from dataclasses import dataclass
from typing import Any

from domain.ports import IEconomy, ISessionGuard
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


def build_services(config: dict[str, Any], economy: IEconomy, sessions: ISessionGuard) -> ServiceRegistry:
    clock = ConfigClock(config)
    return ServiceRegistry(
        sessions=sessions,
        casino=CasinoService(economy, sessions, clock),
        market=MarketService(economy, config),
        horse=HorseService(economy, config),
        economy=EconomyService(economy, clock, config),
        labor=LaborService(economy, clock, config),
    )


def services_of(bot: Any) -> ServiceRegistry:
    """`bot.services` を返す。テスト用 FakeBot 等で未注入の場合は `bot` の属性から構築する。"""
    existing = getattr(bot, "services", None)
    if existing is not None:
        return existing
    config = getattr(bot, "config", {}) or {}
    sessions = getattr(bot, "sessions", None)
    if sessions is None:
        from services.session import Sessions

        sessions = Sessions()
    return build_services(config, bot.economy, sessions)
