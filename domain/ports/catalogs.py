"""カタログ提供の抽象契約（DIP: domain が infra.catalogs や YAML I/O に直接依存しないため）。"""

from domain.ports.catalog_types import (
    ArenaCatalogContract,
    BondsCatalogContract,
    EconomyCatalogContract,
    EventsCatalogContract,
    GamesCatalogContract,
    HorseCatalogContract,
    LaborCatalogContract,
    MarketCatalogContract,
    MissionsCatalogContract,
    RelicsCatalogContract,
    ShopCatalogContract,
    SkinsCatalogContract,
    TeiaiCatalogContract,
)


class ICatalogs:
    """ドメイン層が必要とするカタログ設定の読み取りインターフェース。"""

    def shop(self) -> ShopCatalogContract:
        raise NotImplementedError

    def skins(self) -> SkinsCatalogContract:
        raise NotImplementedError

    def relics(self) -> RelicsCatalogContract:
        raise NotImplementedError

    def bonds(self) -> BondsCatalogContract:
        raise NotImplementedError

    def missions(self) -> MissionsCatalogContract:
        raise NotImplementedError

    def events(self) -> EventsCatalogContract:
        raise NotImplementedError

    def labor(self) -> LaborCatalogContract:
        raise NotImplementedError

    def horse(self) -> HorseCatalogContract:
        raise NotImplementedError

    def market(self) -> MarketCatalogContract:
        raise NotImplementedError

    def teiai(self) -> TeiaiCatalogContract:
        raise NotImplementedError

    def economy(self) -> EconomyCatalogContract:
        raise NotImplementedError

    def games(self) -> GamesCatalogContract:
        raise NotImplementedError

    def arena(self) -> ArenaCatalogContract:
        raise NotImplementedError


_PROVIDER: ICatalogs | None = None


def configure_catalogs(provider: ICatalogs) -> None:
    """Composition Root（main.py / manage.py / tests）から具象カタログ実装を注入する。"""
    global _PROVIDER
    _PROVIDER = provider


def get_catalogs() -> ICatalogs:
    """設定済みのカタログプロバイダを返す。未設定時は明示的にエラーを出す。"""
    if _PROVIDER is None:
        raise RuntimeError(
            "カタログプロバイダが未設定です。起動点（main.py / manage.py / conftest.py）で "
            "infra.catalogs.bind_catalogs() を呼んでから domain モジュールを読み込んでください。"
        )
    return _PROVIDER
