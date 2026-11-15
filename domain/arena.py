"""地下闘技場（NPC戦士どうしの賭け対戦）の数字と計算。Discord と DB に依存しない純粋なロジック。

- 戦士はプレイヤーが所有しない、観戦・賭け専用のNPC。日替わりで、その日の大会ぶんだけ生成される。
- 1日1大会。形式（1on1／バトロワ）は、日付だけで決まる（サーバー・人を問わず共通）。
  - 1on1の日: 準決勝2試合（各2人）→ 決勝1試合（準決勝の勝者2人）。
  - バトロワの日: 準決勝2試合（各4人）→ 決勝1試合（準決勝の勝者2人、1on1）。
- 戦士への賭け総額（大会を通じて累積）に応じて、その戦士は「武器」で強くなる（上限あり。必ず勝てるわけではない）。
- 配当は、1on1勝者2倍・バトロワ勝者6倍。ただし、その試合に集まった賭け金（負けた側の賭け＋観客の初期ランダム分）を
  超えて配当しない（新しくペリカを作らない。原資が足りなければ、配当は比例して減る）。
"""

import random

from domain.ports import get_catalogs

_CFG = get_catalogs().arena()

SEMI_HOUR = _CFG.semi_hour
FINAL_HOUR = _CFG.final_hour

FIGHTER_NAMES = tuple(_CFG.fighter_names)
BASE_POWER_MIN = _CFG.base_power_min
BASE_POWER_MAX = _CFG.base_power_max

WEAPON_CAP = _CFG.weapon_cap  # 武器による強さの上乗せの上限（1.0 なら、最大で素の強さの2倍）
WEAPON_SCALE = _CFG.weapon_scale  # この賭け総額で、上限に達する

DUEL_PAYOUT = _CFG.duel_payout  # 1on1 勝者の配当倍率
ROYALE_PAYOUT = _CFG.royale_payout  # バトロワ勝者の配当倍率
LUCK = _CFG.luck  # 試合ごとの運（強さだけで決まらないようにする）

MIN_STAKE = _CFG.min_stake
MAX_STAKE = _CFG.max_stake

SPECTATOR_COUNT = (_CFG.spectator_count_min, _CFG.spectator_count_max)
SPECTATOR_BET = (_CFG.spectator_min_bet, _CFG.spectator_max_bet)
HOUSE_TOPUP_MAX = _CFG.house_topup_max  # 観客の初期ランダム分を、帝愛の手元現金から補う上限（1試合あたり）

FORMATS = ("duel", "royale")
DUEL_GROUP = 2  # 1on1の日の、準決勝1試合の人数
ROYALE_GROUP = 4  # バトロワの日の、準決勝1試合の人数
NPC_SPECTATOR = -5  # 観客（プレイヤー以外）のNPC賭けを表す user_id


def format_today(day: str) -> str:
    """日替わりの大会形式（"duel" か "royale"）。サーバー・人を問わず、日付だけで決まる。"""
    return random.Random(f"arena:{day}").choice(FORMATS)


def group_size(fmt: str) -> int:
    return ROYALE_GROUP if fmt == "royale" else DUEL_GROUP


def payout_rate(fighter_count: int) -> float:
    """配当倍率は、その試合の参加人数で決まる（決勝はバトロワの日でも2人なので2倍になる）。"""
    return ROYALE_PAYOUT if fighter_count > DUEL_GROUP else DUEL_PAYOUT


def generate_fighters(fmt: str, rng: random.Random) -> list[dict]:
    """その日の戦士を生成する。[{name, base_power}]。人数は、形式の準決勝ぶん（1on1=4人・バトロワ=8人）。"""
    n = group_size(fmt) * 2
    names = rng.sample(FIGHTER_NAMES, min(n, len(FIGHTER_NAMES)))
    while len(names) < n:  # 名前の在庫が足りなければ、連番で埋める
        names.append(f"無名の戦士{len(names) + 1}")
    return [{"name": name, "base_power": rng.randint(BASE_POWER_MIN, BASE_POWER_MAX)} for name in names]


def initial_spectator_bets(rng: random.Random) -> int:
    """観客1人分の、ランダムな初期賭け額。"""
    return rng.randint(*SPECTATOR_BET)


def weapon_bonus(bet_total: int) -> float:
    """賭け総額による、強さの上乗せ（0 〜 WEAPON_CAP）。"""
    if WEAPON_SCALE <= 0:
        return 0.0
    return min(WEAPON_CAP, max(0.0, bet_total) / WEAPON_SCALE)


def effective_power(base_power: int, bet_total: int) -> float:
    """武器込みの、いまの強さ。"""
    return base_power * (1 + weapon_bonus(bet_total))


def simulate_match(fighters: list[dict], bet_totals: dict, rng: random.Random) -> int:
    """1試合の結果（勝者の添字）を決める。fighters は [{name, base_power}]、bet_totals は {名前: 賭け総額}。

    強さが高いほど勝ちやすいが、運（LUCK）で必ずしも勝てるとは限らない。
    """
    weights = [
        max(0.01, effective_power(f["base_power"], bet_totals.get(f["name"], 0)) * rng.gauss(1.0, LUCK))
        for f in fighters
    ]
    return rng.choices(range(len(fighters)), weights=weights, k=1)[0]


def payout_scale(losers_pool: int, winners_due: int) -> float:
    """配当の原資が足りないとき、比例して減らす倍率（1.0 が満額）。原資を超えて新しいペリカは作らない。"""
    if winners_due <= 0:
        return 1.0
    return min(1.0, max(0.0, losers_pool) / winners_due)
