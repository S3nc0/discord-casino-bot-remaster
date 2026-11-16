"""地下闘技場カタログの Pydantic スキーマ。"""

from functools import lru_cache

from pydantic import Field

from infra.catalogs.loader import StrictModel, load_yaml_model


class ArenaCatalog(StrictModel):
    semi_hour: int = Field(ge=0, lt=24)
    final_hour: int = Field(ge=0, lt=24)
    fighter_names: tuple[str, ...] = Field(min_length=1)
    base_power_min: int = Field(gt=0)
    base_power_max: int = Field(gt=0)
    weapon_cap: float = Field(ge=0)
    weapon_scale: int = Field(gt=0)
    takeout: float = Field(ge=0, lt=1)
    max_odds: float = Field(gt=1)
    final_odds_boost: float = Field(ge=1)
    luck: float = Field(ge=0)
    min_stake: int = Field(gt=0)
    max_stake: int = Field(gt=0)
    spectator_count_min: int = Field(ge=0)
    spectator_count_max: int = Field(ge=0)
    spectator_min_bet: int = Field(gt=0)
    spectator_max_bet: int = Field(gt=0)
    house_topup_max: int = Field(ge=0)


@lru_cache(maxsize=1)
def arena() -> ArenaCatalog:
    return load_yaml_model("arena.yaml", ArenaCatalog)
