"""地下闘技場カタログの公称データ契約。"""

from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True)
class ArenaCatalogContract:
    semi_hour: int
    final_hour: int
    fighter_names: Sequence[str]
    base_power_min: int
    base_power_max: int
    weapon_cap: float
    weapon_scale: int
    takeout: float
    max_odds: float
    final_odds_boost: float
    luck: float
    min_stake: int
    max_stake: int
    spectator_count_min: int
    spectator_count_max: int
    spectator_min_bet: int
    spectator_max_bet: int
    house_topup_max: int
    match_subsidy_max: int
