"""ショップ・スキン・発掘品カタログの公称データ契約。"""

from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class ShopItemContract:
    id: str
    name: str
    kind: str
    price: int
    value: int | str | None
    desc: str
    limited: bool
    mark: str


@dataclass(frozen=True)
class StockRuleContract:
    max: int
    per_hour: float


@dataclass(frozen=True)
class ShopCatalogContract:
    kind_labels: Mapping[str, str]
    role_prefix: str
    insurance_cap: int
    auto_used: tuple[str, ...]
    items: tuple[ShopItemContract, ...]
    stock_rules: Mapping[str, StockRuleContract]
    confirm_from: int
    status_nick_minutes: int
    status_nick_per_guild: int


@dataclass(frozen=True)
class SkinContract:
    item_id: str
    games: tuple[str, ...]
    title_prefix: str
    start_line: str
    win_line: str
    lose_line: str
    dice_mark: str
    role_win: Mapping[str, str] | None
    role_lose: Mapping[str, str] | None
    roll_speaker: str
    roll_mark: str
    banner: str


@dataclass(frozen=True)
class SkinsCatalogContract:
    slot_of_game: Mapping[str, str]
    skins: tuple[SkinContract, ...]


@dataclass(frozen=True)
class RelicBuffContract:
    effect: str
    description: str


@dataclass(frozen=True)
class RelicsCatalogContract:
    buff_rate: float
    merge_count: int
    star_max: int
    buffs: Mapping[str, RelicBuffContract]
