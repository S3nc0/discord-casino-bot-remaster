"""会社カタログの Pydantic スキーマ。"""

from functools import lru_cache

from pydantic import Field, model_validator
from pydantic.dataclasses import dataclass as pydantic_dataclass

from domain.ports.catalog_types.company import (
    CompanyCatalogContract,
    CompanyConditionContract,
    CompanyKindContract,
)
from infra.catalogs.loader import STRICT_CONFIG, load_yaml_model


@pydantic_dataclass(frozen=True, config=STRICT_CONFIG, kw_only=True)
class CompanyCondition(CompanyConditionContract):
    key: str = Field(min_length=1)
    weight: int = Field(gt=0)
    yield_mult: float = Field(ge=0)
    price_lo: float = Field(gt=0)
    price_hi: float = Field(gt=0)

    @model_validator(mode="after")
    def _price_range_is_ordered(self) -> "CompanyCondition":
        if self.price_lo > self.price_hi:
            raise ValueError("price_lo は price_hi 以下にしてください")
        return self


@pydantic_dataclass(frozen=True, config=STRICT_CONFIG, kw_only=True)
class CompanyKind(CompanyKindContract):
    key: str = Field(min_length=1)
    name: str = Field(min_length=1)
    yield_rate: float = Field(gt=0, lt=1)
    conditions: tuple[CompanyCondition, ...] = Field(min_length=1)


@pydantic_dataclass(frozen=True, config=STRICT_CONFIG, kw_only=True)
class CompanyCatalog(CompanyCatalogContract):
    found_fee: int = Field(ge=0)
    name_max: int = Field(gt=0)
    build_costs: tuple[int, ...] = Field(min_length=1)
    upkeep_rate: float = Field(ge=0, lt=1)
    pinhane_rate: float = Field(ge=0, lt=1)
    storage_days: int = Field(gt=0)
    bankrupt_days: int = Field(gt=0)
    daily_grant: int = Field(ge=0)
    kinds: tuple[CompanyKind, ...] = Field(min_length=1)


@lru_cache(maxsize=1)
def company() -> CompanyCatalog:
    return load_yaml_model("company.yaml", CompanyCatalog)
