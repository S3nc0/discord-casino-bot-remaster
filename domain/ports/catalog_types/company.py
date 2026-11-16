"""会社カタログの公称データ契約。"""

from dataclasses import dataclass


@dataclass(frozen=True)
class CompanyConditionContract:
    key: str
    weight: int
    yield_mult: float
    price_lo: float
    price_hi: float


@dataclass(frozen=True)
class CompanyKindContract:
    key: str
    name: str
    yield_rate: float
    conditions: tuple[CompanyConditionContract, ...]


@dataclass(frozen=True)
class CompanyCatalogContract:
    found_fee: int
    name_max: int
    build_costs: tuple[int, ...]
    upkeep_rate: float
    pinhane_rate: float
    storage_days: int
    bankrupt_days: int
    kinds: tuple[CompanyKindContract, ...]
