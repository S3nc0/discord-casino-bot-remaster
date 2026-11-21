#!/usr/bin/env python3
"""Deterministic legacy parity fixture generator.

Runs against legacy/python with fixed RNG seeds, fixed timestamps (FrozenClock),
and an in-memory SQLite database. Never modifies legacy/python or catalogs.

Usage (from repo root):
    uv --directory legacy/python run python ../../tests/fixtures/legacy/generate/generate.py
"""

from __future__ import annotations

import dataclasses
import datetime
import json
import math
import pathlib
import random
import sys
from typing import Any

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
LEGACY_PY = REPO_ROOT / "legacy" / "python"
CATALOGS_DIR = REPO_ROOT / "catalogs"
FIXTURES_ROOT = REPO_ROOT / "tests" / "fixtures" / "legacy"

if str(LEGACY_PY) not in sys.path:
    sys.path.insert(0, str(LEGACY_PY))

# Patch catalog lookup paths in memory (without touching legacy/python)
import infra.catalogs  # noqa: E402
import infra.catalogs.loader  # noqa: E402
import infra.paths  # noqa: E402

infra.paths.CATALOGS_DIR = CATALOGS_DIR
infra.catalogs.loader.CATALOG_DIR = CATALOGS_DIR
infra.catalogs.CATALOG_DIR = CATALOGS_DIR
infra.catalogs.bind_catalogs()

from domain import (  # noqa: E402
    arena,
    bonds,
    company,
    earnings,
    events,
    history,
    horse,
    kyosai,
    labor,
    loans,
    market,
    market_events,
    missions,
    options,
    p2p,
    poll,
    quizimport,
    quizpay,
    rates,
    relics,
    shop,
    teiai,
    teiai_market,
    thermostat,
    types,
    weekly,
)
from domain.games import (  # noqa: E402
    blackjack,
    chinchiro,
    jackpot,
    pachinko,
    roulette,
    rtplevel,
    slot,
)
from domain.ports.clock import IClock  # noqa: E402
from infra.db.repositories import open_repositories  # noqa: E402

JST = datetime.timezone(datetime.timedelta(hours=9))
# 2025-01-06 09:00:00+09:00 (Monday)
BASE_DT = datetime.datetime(2025, 1, 6, 9, 0, 0, tzinfo=JST)
BASE_TS = BASE_DT.timestamp()
GUILD_A = 100000000000000001
GUILD_B = 100000000000000002
USER_1 = 200000000000000001
USER_2 = 200000000000000002
USER_3 = 200000000000000003


class FrozenClock(IClock):
    """Deterministic clock for legacy repositories."""

    def __init__(self, dt: datetime.datetime = BASE_DT) -> None:
        self._dt = dt

    def set(self, dt: datetime.datetime) -> None:
        self._dt = dt

    def set_ts(self, ts: float) -> None:
        self._dt = datetime.datetime.fromtimestamp(ts, tz=JST)

    def advance(self, seconds: float) -> float:
        self._dt = self._dt + datetime.timedelta(seconds=seconds)
        return self.now_ts()

    def now(self) -> datetime.datetime:
        return self._dt

    def today(self) -> datetime.date:
        return self._dt.date()

    def offset_hours(self) -> float:
        return 9.0


def serialize(obj: Any) -> Any:
    """Convert dataclasses, dates, sets, tuples, and sqlite Rows into JSON-safe values."""
    if obj is None or isinstance(obj, (bool, int, str)):
        return obj
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return str(obj)
        return round(obj, 10)
    if isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    if dataclasses.is_dataclass(obj):
        return serialize(dataclasses.asdict(obj))
    if isinstance(obj, dict):
        return {str(k): serialize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [serialize(v) for v in obj]
    if isinstance(obj, set):
        return sorted(serialize(v) for v in obj)
    # sqlite3.Row or mapping-like
    if hasattr(obj, "keys"):
        return {str(k): serialize(obj[k]) for k in obj.keys()}
    return repr(obj)


def write_fixture(rel_path: str, payload: dict[str, Any]) -> None:
    out_path = FIXTURES_ROOT / rel_path
    out_path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(serialize(payload), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    out_path.write_text(text, encoding="utf-8")


def fresh_repos(dt: datetime.datetime = BASE_DT):
    clock = FrozenClock(dt)
    bundle = open_repositories(":memory:", strict=True, clock=clock)
    return bundle, clock


# ---------------------------------------------------------------------------
# B2-A: Casino Games
# ---------------------------------------------------------------------------


def gen_casino_common() -> None:
    rng = random.Random(1001)
    jp_cases = [
        {
            "bet": bet,
            "pool": pool,
            "chance": jackpot.chance(bet, pool),
            "contribution": jackpot.contribution(bet),
        }
        for bet, pool in [(100, 10000), (1000, 50000), (5000, 100000), (10000, 500000)]
    ]
    jp_draws = [
        {"trial": i, "hit": jackpot.draw(rng, 1000, 100000)} for i in range(25)
    ]

    rtp_cases = []
    for game, kind in [
        ("チンチロ", None),
        ("スロット", None),
        ("ブラックジャック", None),
        ("パチンコ", None),
        ("ルーレット", "red"),
        ("ルーレット", "number"),
    ]:
        base = rtplevel.base_stats(game, kind)
        levels = {}
        for lv in range(1, 7):
            levels[str(lv)] = {
                "factor": rtplevel.factor(game, lv, kind),
                "approx_rtp": rtplevel.approx_rtp(game, lv, kind),
                "adjust_1000_win_2000": rtplevel.adjust(game, lv, 1000, 2000, kind),
                "adjust_1000_push_1000": rtplevel.adjust(game, lv, 1000, 1000, kind),
                "adjust_1000_loss_0": rtplevel.adjust(game, lv, 1000, 0, kind),
            }
        rtp_cases.append({"game": game, "kind": kind, "base_stats": base, "levels": levels})

    ev_sched = [
        {
            "day": (BASE_DT.date() + datetime.timedelta(days=d)).isoformat(),
            "event": events.schedule(GUILD_A, BASE_DT.date() + datetime.timedelta(days=d)),
        }
        for d in range(7)
    ]
    ev_day = events.schedule(GUILD_A, BASE_DT.date())
    ev_h, ev_m = divmod(ev_day.start_min, 60)
    ev_active_in = events.active(
        GUILD_A,
        datetime.datetime(2025, 1, 6, ev_h, ev_m, 0, tzinfo=JST) + datetime.timedelta(minutes=5),
    )
    ev_active_out = events.active(
        GUILD_A,
        datetime.datetime(2025, 1, 6, (ev_h + 3) % 24, 0, 0, tzinfo=JST),
    )
    ev_bonus_cases = [
        {"bet": 1000, "payout": 3000, "boost": 0.5, "bonus": events.bonus(1000, 3000, 0.5)},
        {"bet": 1000, "payout": 1000, "boost": 0.5, "bonus": events.bonus(1000, 1000, 0.5)},
        {"bet": 1000, "payout": 0, "boost": 0.5, "bonus": events.bonus(1000, 0, 0.5)},
        {
            "best_boost_scheduled_only": events.best_boost(ev_day.game, ev_day, None),
            "best_boost_manual_higher": events.best_boost(
                ev_day.game, ev_day, {"game": ev_day.game, "boost": 1.0}
            ),
        },
    ]

    write_fixture(
        "casino-common/formulas.json",
        {
            "module": "casino-common",
            "seed": 1001,
            "jackpot": {"formulas": jp_cases, "draws": jp_draws},
            "rtp_levels": rtp_cases,
            "events": {
                "guild_id": GUILD_A,
                "weekly_schedule": ev_sched,
                "active_during_hour": ev_active_in,
                "active_outside_hour": ev_active_out,
                "bonuses": ev_bonus_cases,
            },
        },
    )


def gen_chinchiro() -> None:
    sample_dice = [
        (1, 1, 1),
        (6, 6, 6),
        (2, 2, 2),
        (4, 5, 6),
        (6, 6, 5),
        (3, 3, 1),
        (1, 3, 5),
        (1, 2, 3),
    ]
    classifications = [
        {"dice": list(d), "hand": chinchiro.classify(d)} for d in sample_dice
    ]

    matchups = []
    pairs = [
        ((1, 1, 1), (6, 6, 6)),
        ((6, 6, 6), (4, 5, 6)),
        ((4, 5, 6), (2, 2, 6)),
        ((2, 2, 6), (1, 1, 5)),
        ((1, 3, 5), (2, 4, 6)),
        ((1, 2, 3), (1, 3, 5)),
        ((1, 2, 3), (1, 2, 3)),
        ((1, 3, 5), (1, 2, 3)),
        ((3, 3, 4), (5, 5, 4)),
    ]
    for pd, dd in pairs:
        ph = chinchiro.classify(pd)
        dh = chinchiro.classify(dd)
        out = chinchiro.compare(ph, dh)
        pay = chinchiro.payout(1000, out)
        matchups.append(
            {
                "player_dice": list(pd),
                "dealer_dice": list(dd),
                "player_hand": ph,
                "dealer_hand": dh,
                "outcome": out,
                "payout_bet_1000": pay,
            }
        )

    rng = random.Random(1002)
    seeded_rounds = []
    for i in range(15):
        p_rolls = chinchiro.play_hand(rng)
        d_rolls = chinchiro.play_hand(rng)
        ph = p_rolls[-1][1]
        dh = d_rolls[-1][1]
        out = chinchiro.compare(ph, dh)
        seeded_rounds.append(
            {
                "round": i,
                "player_rolls": [{"dice": list(r[0]), "hand": r[1]} for r in p_rolls],
                "dealer_rolls": [{"dice": list(r[0]), "hand": r[1]} for r in d_rolls],
                "outcome": out,
                "payout_bet_1000": chinchiro.payout(1000, out),
            }
        )

    write_fixture(
        "chinchiro/hands.json",
        {
            "module": "chinchiro",
            "seed": 1002,
            "classifications": classifications,
            "matchups": matchups,
            "seeded_rounds": seeded_rounds,
        },
    )


def gen_pachinko() -> None:
    rng = random.Random(1003)
    spins = [pachinko.roll_spin(rng) for _ in range(30)]
    sets = [pachinko.roll_set(rng) for _ in range(8)]
    round_rolls = [pachinko.roll_rounds(rng) for _ in range(15)]

    write_fixture(
        "pachinko/spins.json",
        {
            "module": "pachinko",
            "seed": 1003,
            "stats": {
                "hit_rate": pachinko.hit_rate(),
                "mean_hit_prob": pachinko.mean_hit_prob(),
                "rtp": pachinko.rtp(),
                "hit_rate_by_omen": pachinko.hit_rate_by_omen(),
                "hit_rate_by_tier": pachinko.hit_rate_by_tier(),
            },
            "seeded_spins": spins,
            "seeded_sets": sets,
            "seeded_round_rolls": round_rolls,
        },
    )


def gen_slots() -> None:
    rng = random.Random(1004)
    seeded_spins = []
    for i in range(40):
        reels = slot.spin(rng)
        seeded_spins.append(
            {
                "spin": i,
                "reels": list(reels),
                "multiplier": slot.multiplier(reels),
                "label": slot.label(reels),
            }
        )

    explicit = [
        ("7️⃣", "7️⃣", "7️⃣"),
        ("💎", "💎", "💎"),
        ("🔔", "🔔", "🔔"),
        ("🍇", "🍇", "🍇"),
        ("🍒", "🍒", "🍒"),
        ("🍒", "🍒", "🍋"),
        ("🍒", "🔔", "🍋"),
        ("🔔", "🍇", "🍋"),
    ]
    explicit_combos = [
        {"reels": list(r), "multiplier": slot.multiplier(r), "label": slot.label(r)}
        for r in explicit
    ]

    write_fixture(
        "slots/spins.json",
        {
            "module": "slots",
            "seed": 1004,
            "rtp": slot.rtp(),
            "explicit_combos": explicit_combos,
            "seeded_spins": seeded_spins,
        },
    )


def gen_blackjack() -> None:
    hand_cases = [
        [(1, "♠"), (13, "♥")],
        [(1, "♠"), (1, "♥"), (9, "♦")],
        [(1, "♠"), (6, "♣"), (10, "♦")],
        [(10, "♠"), (7, "♥"), (6, "♣")],
        [(5, "♠"), (5, "♦"), (1, "♣")],
    ]
    evaluations = [
        {
            "cards": cards,
            "text": blackjack.hand_text(cards),
            "value": blackjack.value(cards),
            "is_blackjack": blackjack.is_blackjack(cards),
        }
        for cards in hand_cases
    ]
    payouts = {
        res: blackjack.payout(res, 1000)
        for res in ["blackjack", "win", "push", "lose", "bust", "surrender"]
    }

    rng = random.Random(1005)
    games_out = []
    for i in range(10):
        g = blackjack.Game(rng=rng)
        init_player = list(g.player)
        init_dealer = list(g.dealer)
        actions = []
        if not g.finished:
            if blackjack.value(g.player) < 15:
                g.hit()
                actions.append("hit")
            if not g.finished:
                g.stand()
                actions.append("stand")
        res = g.result()
        bet = 2000 if g.doubled else 1000
        games_out.append(
            {
                "game": i,
                "initial_player": init_player,
                "initial_dealer": init_dealer,
                "actions": actions,
                "final_player": g.player,
                "final_dealer": g.dealer,
                "player_value": blackjack.value(g.player),
                "dealer_value": blackjack.value(g.dealer),
                "result": res,
                "bet": bet,
                "payout": blackjack.payout(res, bet),
            }
        )

    # Explicit double-down game
    g_dbl = blackjack.Game(rng=random.Random(1006))
    dbl_init_p = list(g_dbl.player)
    if not g_dbl.finished:
        g_dbl.double()
    dbl_res = g_dbl.result()
    dbl_bet = 2000 if g_dbl.doubled else 1000
    double_case = {
        "seed": 1006,
        "initial_player": dbl_init_p,
        "final_player": g_dbl.player,
        "final_dealer": g_dbl.dealer,
        "doubled": g_dbl.doubled,
        "bet": dbl_bet,
        "result": dbl_res,
        "payout": blackjack.payout(dbl_res, dbl_bet),
    }

    write_fixture(
        "blackjack/hands.json",
        {
            "module": "blackjack",
            "seed": 1005,
            "hand_evaluations": evaluations,
            "payout_table_bet_1000": payouts,
            "seeded_games": games_out,
            "double_down_case": double_case,
        },
    )


def gen_roulette() -> None:
    colors = {str(n): roulette.color_of(n) for n in range(37)}
    kinds = [
        ("red", None),
        ("black", None),
        ("even", None),
        ("odd", None),
        ("low", None),
        ("high", None),
        ("dozen1", None),
        ("dozen2", None),
        ("dozen3", None),
        ("number", 17),
        ("number", 0),
    ]
    rtps = {k: roulette.rtp(k) for k, _ in kinds}
    bet_checks = []
    for result in [0, 1, 2, 17, 25, 36]:
        row = {"result": result, "color": roulette.color_of(result), "bets": {}}
        for kind, num in kinds:
            key = f"{kind}:{num}" if num is not None else kind
            row["bets"][key] = {
                "wins": roulette.wins(kind, result, num),
                "payout_1000": roulette.payout(kind, 1000, result, num),
            }
        bet_checks.append(row)

    rng = random.Random(1007)
    spins = [
        {"spin": i, "number": (n := roulette.spin(rng)), "color": roulette.color_of(n)}
        for i in range(30)
    ]

    write_fixture(
        "roulette/spins.json",
        {
            "module": "roulette",
            "seed": 1007,
            "colors": colors,
            "rtps": rtps,
            "bet_checks": bet_checks,
            "seeded_spins": spins,
        },
    )


# ---------------------------------------------------------------------------
# B2-B: Horse, Arena, Labor, Relics, Quiz, Lottery, Polls, Shop,
#       Missions, Weekly Ranking, Daily, Transfer, Economy Core
# ---------------------------------------------------------------------------


def gen_horse() -> None:
    rng = random.Random(2001)
    track = horse.random_track(rng)
    runners = []
    for lane in range(1, 9):
        st = horse.random_stats(rng, total=200)
        form = horse.random_form(rng)
        style = horse.style_of(st)
        runners.append(
            horse.Runner(
                lane=lane,
                name=f"ウマ{lane}",
                speed=st["speed"],
                stamina=st["stamina"],
                power=st["power"],
                guts=st["guts"],
                form=form,
                style=style,
            )
        )

    odds_simple = horse.make_odds(runners)
    odds_all = horse.make_all_odds(runners, track)
    sim = horse.simulate(runners, track, random.Random(2002), keep_frames=False)
    order_lanes = sim["order"]

    combo_checks = [
        {"kind": "win", "lanes": [order_lanes[0]], "hit": horse.combo_hit("win", [order_lanes[0]], order_lanes)},
        {"kind": "place", "lanes": [order_lanes[2]], "hit": horse.combo_hit("place", [order_lanes[2]], order_lanes)},
        {"kind": "quinella", "lanes": [order_lanes[1], order_lanes[0]], "hit": horse.combo_hit("quinella", [order_lanes[1], order_lanes[0]], order_lanes)},
        {"kind": "exacta", "lanes": [order_lanes[0], order_lanes[1]], "hit": horse.combo_hit("exacta", [order_lanes[0], order_lanes[1]], order_lanes)},
        {"kind": "exacta", "lanes": [order_lanes[1], order_lanes[0]], "hit": horse.combo_hit("exacta", [order_lanes[1], order_lanes[0]], order_lanes)},
        {"kind": "wide", "lanes": [order_lanes[0], order_lanes[2]], "hit": horse.combo_hit("wide", [order_lanes[0], order_lanes[2]], order_lanes)},
        {"kind": "trio", "lanes": [order_lanes[2], order_lanes[0], order_lanes[1]], "hit": horse.combo_hit("trio", [order_lanes[2], order_lanes[0], order_lanes[1]], order_lanes)},
        {"kind": "trifecta", "lanes": order_lanes[:3], "hit": horse.combo_hit("trifecta", order_lanes[:3], order_lanes)},
    ]

    base_stats = {"speed": 60, "stamina": 50, "power": 45, "guts": 45}
    moved = horse.move_points(base_stats, "stamina", "speed", carrots=1)
    added = horse.add_points(base_stats, "speed", "power")

    # End-to-end DB horse + race lifecycle
    bundle, clock = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    h_repo = bundle.horses.for_guild(GUILD_A)
    r_repo = bundle.races.for_guild(GUILD_A)
    s_repo = bundle.shop.for_guild(GUILD_A)
    w.set_balance(USER_1, 100000, "fixture_seed")
    w.set_balance(USER_2, 100000, "fixture_seed")
    s_repo.purchase(USER_1, "horse_voucher", "馬券引換券", 30000, unique=False, qty=1, now=BASE_TS)
    created = h_repo.horse_create(USER_1, "テストホース", horse.COATS[0], horse.SILKS[0])
    horse_id = created[1] if isinstance(created[1], int) else (created[0] if isinstance(created[0], int) else None)
    race_id = r_repo.race_create_special(BASE_TS, entry_min=10, bet_min=10, channel_id=999)
    reg = r_repo.race_register(USER_1, horse_id, race_id, BASE_TS + 60) if horse_id else None
    closed = r_repo.race_close_entries(race_id, rng=random.Random(2003))
    entries = r_repo.race_entries(race_id)
    db_runners = [
        horse.Runner(
            lane=e["lane"],
            name=e["name"],
            speed=e["speed"],
            stamina=e["stamina"],
            power=e["power"],
            guts=e["guts"],
            form=e["form"],
            style=e["style"],
        )
        for e in entries
    ]
    r_repo.race_set_odds(race_id, horse.make_all_odds(db_runners))
    bet_res = r_repo.race_bet(USER_2, race_id, "win", 1, 2000, BASE_TS + 700)
    run_res = r_repo.race_run(race_id, tz_hours=9.0, rng=random.Random(2004))

    write_fixture(
        "horse/races.json",
        {
            "module": "horse",
            "seeds": {"setup": 2001, "sim": 2002, "db_close": 2003, "db_run": 2004},
            "schedule_2025_01_06": horse.schedule_for(BASE_DT.date()),
            "track": track,
            "runners": runners,
            "make_odds": odds_simple,
            "make_all_odds_win_place": {
                "win": odds_all.get("win", {}),
                "place": odds_all.get("place", {}),
            },
            "simulation": sim,
            "combo_checks": combo_checks,
            "payout_1000_at_4_3": horse.payout(1000, 4.3),
            "retire_values": {
                "0_0_0": horse.retire_value(0, 0, 0),
                "10_3_5": horse.retire_value(10, 3, 5),
                "25_10_15": horse.retire_value(25, 10, 15),
            },
            "prize_pool_scale": {
                "1_real": horse.prize_pool_scale(1, 30000, 0),
                "4_real": horse.prize_pool_scale(4, 30000, 0),
                "8_real_topup": horse.prize_pool_scale(8, 30000, 10000),
            },
            "stat_ops": {"move_points": moved, "add_points": added},
            "db_race_flow": {
                "horse_create": created,
                "register": reg,
                "closed_entries_count": len(entries),
                "bet_result": bet_res,
                "run_order": run_res.get("order") if run_res else None,
                "user1_balance_after": w.balance(USER_1),
                "user2_balance_after": w.balance(USER_2),
            },
        },
    )


def gen_arena() -> None:
    rng = random.Random(2005)
    fighters_duel = arena.generate_fighters("duel", rng)
    fighters_royale = arena.generate_fighters("royale", rng)
    odds_duel = arena.match_odds(fighters_duel)
    odds_royale = arena.match_odds(fighters_royale)
    sim_winner = arena.simulate_match(fighters_duel[:2], {0: 2000, 1: 4000}, random.Random(2006))
    settle_ok = arena.settle_payouts([1000, 2000], 2.5, pool=10000, subsidy_cap=5000)
    settle_capped = arena.settle_payouts([5000, 5000], 4.0, pool=10000, subsidy_cap=5000)

    bundle, clock = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    ar = bundle.arena.for_guild(GUILD_A)
    w.set_balance(USER_1, 50000, "fixture_seed")
    w.set_balance(USER_2, 50000, "fixture_seed")
    t = ar.arena_tournament_ensure("duel", BASE_TS, 9.0, rng=random.Random(2007))
    t_fighters = ar.arena_fighters(t["id"])
    b1 = ar.arena_bet(USER_1, t_fighters[0]["id"], 3000, BASE_TS + 60)
    b2 = ar.arena_bet(USER_2, t_fighters[1]["id"], 4000, BASE_TS + 120)
    semis = ar.arena_run_semis(t["id"], rng=random.Random(2008), now=BASE_TS + 3600)
    final = ar.arena_run_final(t["id"], rng=random.Random(2009), now=BASE_TS + 7200)

    write_fixture(
        "arena/tournaments.json",
        {
            "module": "arena",
            "seeds": {"gen": 2005, "sim": 2006, "ensure": 2007, "semis": 2008, "final": 2009},
            "fighters_duel": fighters_duel,
            "fighters_royale": fighters_royale,
            "odds_duel": odds_duel,
            "odds_royale": odds_royale,
            "weapon_bonus": {
                "0": arena.weapon_bonus(0),
                "5000": arena.weapon_bonus(5000),
                "50000": arena.weapon_bonus(50000),
            },
            "payout_scale_10k_vs_25k": arena.payout_scale(10000, 25000),
            "settle_payouts_full": settle_ok,
            "settle_payouts_capped": settle_capped,
            "sim_winner_idx": sim_winner,
            "db_tournament": {
                "tournament_id": t["id"],
                "fighter_count": len(t_fighters),
                "bet1": b1,
                "bet2": b2,
                "semis_winner_ids": [m.get("winner_id") for m in semis.get("matches", [])] if isinstance(semis, dict) else semis,
                "final_winner_id": final.get("winner_id") if isinstance(final, dict) else final,
                "user1_balance_after": w.balance(USER_1),
                "user2_balance_after": w.balance(USER_2),
            },
        },
    )


def gen_labor() -> None:
    rng = random.Random(2010)
    upgrade_costs = {str(lv): labor.upgrade_cost(lv) for lv in range(0, 12)}
    dorm_costs = {str(lv): labor.dorm_cost(lv) for lv in range(0, 7)}
    slots_by_dorm = {str(lv): labor.slots(lv) for lv in range(0, 7)}
    clicks = [
        {"pick": p, "glove": g, "fatigue": f, "outcome": labor.click_outcome(p, g, f)}
        for p, g, f in [(0, 0, 0.0), (5, 3, 25.0), (10, 10, 80.0), (10, 10, 100.0)]
    ]
    fatigue_decay = {
        "after_10m_base": labor.fatigue_now(60.0, 0.0, 600.0, recovery=0.0),
        "after_30m_recovery_0_5": labor.fatigue_now(60.0, 0.0, 1800.0, recovery=0.5),
    }
    terrain = labor.terrain_today("2025-01-06")
    workers = [
        {"kind": "apprentice", "hired_at": BASE_TS, "expires_at": BASE_TS + 86400},
        {"kind": "miner", "hired_at": BASE_TS, "expires_at": BASE_TS + 86400},
        {"kind": "foreman", "hired_at": BASE_TS, "expires_at": BASE_TS + 86400},
    ]
    plan = labor.settle_plan(
        workers=workers,
        renew=True,
        idle_at=BASE_TS,
        now=BASE_TS + 6 * 3600,
        pot=500,
        balance=10000,
        rng=rng,
        wage_bonus=0.1,
        luck_bonus=0.05,
    )

    # Anti-bot detection fixture
    mech_hours = [
        {"hour": h, "clicks": 120, "gaps": 119, "sum_gap": 119 * 5.0, "sum_gap2": 119 * 25.0}
        for h in range(100, 108)
    ]
    normal_hours = [
        {"hour": h, "clicks": 30, "gaps": 29, "sum_gap": 29 * 12.0, "sum_gap2": 29 * (144.0 + 36.0)}
        for h in range(100, 103)
    ]

    # DB labor click + hire + collect
    bundle, clock = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    lb = bundle.labor.for_guild(GUILD_A)
    w.set_balance(USER_1, 50000, "fixture_seed")
    c1 = lb.labor_click(USER_1, BASE_TS, day="2025-01-06", rng=random.Random(2011))
    up = lb.labor_upgrade(USER_1, "pick", BASE_TS + 10, day="2025-01-06")
    hire = lb.labor_hire(USER_1, "apprentice", BASE_TS + 20, day="2025-01-06")
    clock.set_ts(BASE_TS + 4 * 3600)
    _orig_sysrand = labor.random.SystemRandom
    _collect_rng = random.Random(20110)
    labor.random.SystemRandom = lambda: _collect_rng  # type: ignore[assignment]
    try:
        collected = lb.labor_collect(USER_1, BASE_TS + 4 * 3600, day="2025-01-06", detail=True)
    finally:
        labor.random.SystemRandom = _orig_sysrand  # type: ignore[assignment]

    write_fixture(
        "labor/work.json",
        {
            "module": "labor",
            "seeds": {"settle": 2010, "db_click": 2011, "db_collect": 20110},
            "upgrade_costs": upgrade_costs,
            "dorm_costs": dorm_costs,
            "slots_by_dorm": slots_by_dorm,
            "click_outcomes": clicks,
            "fatigue_decay": fatigue_decay,
            "terrain_2025_01_06": {"kind": terrain, "label": labor.terrain_label(terrain)},
            "crit_chance_p5_w3": labor.crit_chance(5, 3, terrain),
            "idle_rate_sample": labor.idle_rate({"apprentice": 2, "miner": 1, "foreman": 1}),
            "settle_plan_6h": plan,
            "anti_bot": {
                "mechanical_suspected": labor.auto_click_suspected(mech_hours, 107),
                "normal_suspected": labor.auto_click_suspected(normal_hours, 102),
            },
            "db_flow": {
                "click1": c1,
                "upgrade_pick": up,
                "hire_apprentice": hire,
                "collect_4h": collected,
                "balance_after": w.balance(USER_1),
            },
        },
    )


def gen_relics() -> None:
    held = {
        "relic_fossil": 1,
        "relic_bone_s2": 1,
        "relic_crown_s3": 1,
        "relic_meteor_s4": 1,
    }
    buffs = relics.buffs_of(held)
    id_ops = [
        {
            "id": item_id,
            "split": relics.split_id(item_id),
            "buff_text": relics.buff_text(item_id),
        }
        for item_id in held
    ]
    star_ops = {
        str(s): {"star_id": relics.star_id("relic_crown", s), "stars": relics.stars(s)}
        for s in range(1, 6)
    }
    rng = random.Random(2012)
    chance_rounds = [relics.chance_round(1.35, rng=rng) for _ in range(20)]

    # DB relic merge (10 base relics -> 1 star-2 relic)
    bundle, _ = fresh_repos()
    rl = bundle.relics.for_guild(GUILD_A)
    bundle.wallet.for_guild(GUILD_A).set_balance(USER_1, 50000, "fixture_seed")
    bundle.db.conn.execute(
        "INSERT INTO inventory (guild_id, user_id, item_id, qty) VALUES (?, ?, ?, ?)",
        (GUILD_A, USER_1, "relic_fossil", 10),
    )
    bundle.db.conn.commit()
    merge_res = rl.relic_merge(USER_1, "relic_fossil")
    stock_after = rl.relic_stock(USER_1)
    buffs_after = rl.relic_buffs_for(GUILD_A, USER_1)

    write_fixture(
        "relics/buffs.json",
        {
            "module": "relics",
            "seed": 2012,
            "id_ops": id_ops,
            "star_ops": star_ops,
            "buffs_stacked": buffs,
            "chance_round_1_35": chance_rounds,
            "db_merge": {
                "merge_result": merge_res,
                "stock_after": stock_after,
                "buffs_after": buffs_after,
            },
        },
    )


def gen_quiz() -> None:
    reward_cases = []
    for participants, correct, reward in [
        (1, 1, 100),
        (5, 5, 100),
        (5, 2, 100),
        (10, 5, 300),
        (10, 0, 500),
        (20, 10, 1000),
    ]:
        reward_cases.append(
            {
                "participants": participants,
                "correct": correct,
                "reward": reward,
                "scale": quizpay.scale(reward),
                "factor": quizpay.factor(participants, correct),
                "base_reward": quizpay.base_reward(reward),
                "bonus": quizpay.bonus(participants, correct, reward),
                "participation": quizpay.participation(participants, correct, reward),
                "author_payout": quizpay.author_payout(participants, correct, reward),
            }
        )

    bulk_text = "日本の首都は？ | 東京 | 大阪 | 京都 | 1 | 100\n2+2は？ | 3 | 4 | 5 | 2 | 200"
    parsed = quizimport.parse_bulk(bulk_text)

    write_fixture(
        "quiz/rewards.json",
        {
            "module": "quiz",
            "reward_cases": reward_cases,
            "bulk_import_sample": parsed,
        },
    )


def gen_lottery() -> None:
    bundle, clock = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    rf = bundle.raffle.for_guild(GUILD_A)
    for u in (USER_1, USER_2, USER_3):
        w.set_balance(u, 10000, "fixture_seed")

    opened = rf.raffle_open(USER_1, fee=1000, closes=BASE_TS + 600, channel_id=555)
    j1 = rf.raffle_join(USER_1, BASE_TS + 10)
    j2 = rf.raffle_join(USER_2, BASE_TS + 20)
    j3 = rf.raffle_join(USER_3, BASE_TS + 30)
    j_dup = rf.raffle_join(USER_1, BASE_TS + 40)
    closed = rf.raffle_close(rng=random.Random(2013), cancel=False)

    # Cancel refund scenario
    opened2 = rf.raffle_open(USER_2, fee=500, closes=BASE_TS + 1200, channel_id=555)
    j_cancel = rf.raffle_join(USER_2, BASE_TS + 700)
    cancelled = rf.raffle_close(rng=random.Random(2014), cancel=True)

    write_fixture(
        "lottery/draws.json",
        {
            "module": "lottery",
            "seeds": {"draw": 2013, "cancel": 2014},
            "normal_draw": {
                "opened": opened,
                "joins": [j1, j2, j3, j_dup],
                "closed": closed,
                "balances_after": {
                    "u1": w.balance(USER_1),
                    "u2": w.balance(USER_2),
                    "u3": w.balance(USER_3),
                },
            },
            "cancel_refund": {
                "opened": opened2,
                "join": j_cancel,
                "cancelled": cancelled,
                "u2_balance_after": w.balance(USER_2),
            },
        },
    )


def gen_polls() -> None:
    shown_cases = [
        {"real": r, "adj": a, "shown": poll.shown(r, a)}
        for r, a in [(3, 0), (3, 2), (2, -5), (0, 4)]
    ]

    bundle, clock = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    pl = bundle.polls.for_guild(GUILD_A)
    for u in (USER_1, USER_2, USER_3):
        w.set_balance(u, 10000, "fixture_seed")

    created = pl.poll_create(USER_1, "ペリカ増額に賛成？", BASE_TS + 600, channel_id=777, now=BASE_TS)
    poll_id = created[1]
    v1 = pl.poll_vote(USER_1, poll_id, True, BASE_TS + 10)
    v2 = pl.poll_vote(USER_2, poll_id, False, BASE_TS + 20)
    v3 = pl.poll_vote(USER_3, poll_id, False, BASE_TS + 30)
    rig = pl.poll_rig(USER_1, poll_id, yes=3, no=0, now=BASE_TS + 40)
    before_close = pl.poll_get(poll_id)
    closed = pl.poll_close_due(BASE_TS + 700)

    write_fixture(
        "polls/outcomes.json",
        {
            "module": "polls",
            "shown_cases": shown_cases,
            "db_flow": {
                "created": created,
                "votes": [v1, v2, v3],
                "rig": rig,
                "before_close": before_close,
                "closed": closed,
                "u1_balance_after": w.balance(USER_1),
            },
        },
    )


def gen_shop() -> None:
    stock_rule = shop.Stock(max=5, per_hour=0.5)
    stock_cases = {
        "after_1h_from_2": shop.stock_now(stock_rule, 2.0, 0.0, 3600.0),
        "after_10h_capped": shop.stock_now(stock_rule, 2.0, 0.0, 36000.0),
        "next_refill_from_2": shop.next_refill_at(stock_rule, 2.0, 1000.0),
        "next_refill_when_full": shop.next_refill_at(stock_rule, 5.0, 1000.0),
    }

    decay_cases = {
        str(h): teiai.auction_rate(BASE_TS, BASE_TS + h * 3600)
        for h in [0, 6, 12, 24, 48, 72]
    }

    day0 = teiai_market.day_start(BASE_TS)
    catalog_items = shop.of_kind("title", include_limited=False) + shop.of_kind("item", include_limited=False)
    planned_day = teiai_market.plan_day(day0, random.Random(2015), catalog_items[:10])
    price_decay = {
        "start": teiai_market.price_at(10000, 4000, day0, day0 + 86400, day0),
        "mid": teiai_market.price_at(10000, 4000, day0, day0 + 86400, day0 + 43200),
        "end": teiai_market.price_at(10000, 4000, day0, day0 + 86400, day0 + 86400),
    }

    bundle, _ = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    sh = bundle.shop.for_guild(GUILD_A)
    au = bundle.auction.for_guild(GUILD_A)
    w.set_balance(USER_1, 100000, "fixture_seed")
    item = shop.find("daily_double")
    buy_res = sh.purchase(USER_1, item.id, item.name, item.price, item.unique, qty=1, now=BASE_TS)
    au.auction_list_locked_for(GUILD_A, "daily_double", 1, BASE_TS)
    au_price_12h = au.auction_price("daily_double", BASE_TS, BASE_TS + 12 * 3600)
    au_buy = au.auction_buy(USER_1, "daily_double", qty=1, now=BASE_TS + 12 * 3600)

    write_fixture(
        "shop/purchases.json",
        {
            "module": "shop",
            "seed": 2015,
            "stock_math": stock_cases,
            "auction_rate_by_hour": decay_cases,
            "teiai_market": {
                "day_start": day0,
                "planned_count": len(planned_day),
                "planned_listings": planned_day,
                "price_decay": price_decay,
            },
            "db_flow": {
                "shop_buy_daily_double": buy_res,
                "auction_price_12h": au_price_12h,
                "auction_buy": au_buy,
                "inventory_after": sh.inventory(USER_1),
                "collection_value": shop.collection_value(sh.inventory(USER_1)),
                "balance_after": w.balance(USER_1),
            },
        },
    )


def gen_missions() -> None:
    day = BASE_DT.date()
    todays = missions.today_missions(day)
    next_day = missions.today_missions(day + datetime.timedelta(days=1))
    jackpot_checks = [
        {"bet": b, "net": n, "is_jackpot": missions.is_jackpot(b, n)}
        for b, n in [(1000, 2000), (1000, 3000), (1000, 4000), (1000, 5000), (1000, -1000)]
    ]

    bundle, _ = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    rec = bundle.records.for_guild(GUILD_A)
    w.set_balance(USER_1, 20000, "fixture_seed")
    plays = [
        rec.record_play(USER_1, "chinchiro", 1000, 2000, day),
        rec.record_play(USER_1, "slot", 500, -500, day),
        rec.record_play(USER_1, "blackjack", 1000, 1500, day),
        rec.record_play(USER_1, "roulette", 1000, 5000, day),
    ]
    status = rec.mission_status(USER_1, day)

    write_fixture(
        "missions/progress.json",
        {
            "module": "missions",
            "date": day.isoformat(),
            "today_missions": todays,
            "next_day_missions": next_day,
            "jackpot_checks": jackpot_checks,
            "db_plays": plays,
            "mission_status_after": status,
            "balance_after": w.balance(USER_1),
        },
    )


def gen_weekly_ranking() -> None:
    day = BASE_DT.date()
    wk = weekly.week_id(day)
    prev_wk = weekly.previous_week_id(day)

    bundle, _ = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    rec = bundle.records.for_guild(GUILD_A)
    for u in (USER_1, USER_2, USER_3):
        w.set_balance(u, 50000, "fixture_seed")
    # USER_1: 6 plays, +12000 net (qualifies >= 5)
    for net in [3000, 2000, -1000, 4000, 2000, 2000]:
        rec.record_play(USER_1, "chinchiro", 1000, net, day)
    # USER_2: 5 plays, +5000 net (qualifies >= 5)
    for net in [1000, 1000, 1000, 1000, 1000]:
        rec.record_play(USER_2, "blackjack", 1000, net, day)
    # USER_3: 3 plays, +30000 net (below min_plays = 5!)
    for net in [10000, 10000, 10000]:
        rec.record_play(USER_3, "slot", 1000, net, day)

    top = rec.weekly_top(wk, limit=10)
    r1 = rec.weekly_rank(wk, USER_1)
    r3 = rec.weekly_rank(wk, USER_3)
    award = rec.weekly_award(wk)

    write_fixture(
        "weekly-ranking/titles.json",
        {
            "module": "weekly-ranking",
            "date": day.isoformat(),
            "week_id": wk,
            "week_start": weekly.week_start(day),
            "previous_week_id": prev_wk,
            "week_label": weekly.week_label(wk),
            "weekly_top": top,
            "rank_user1": r1,
            "rank_user3_under_min_plays": r3,
            "weekly_award": award,
            "user1_balance_after_award": w.balance(USER_1),
        },
    )


def gen_daily() -> None:
    bundle, clock = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    sh = bundle.shop.for_guild(GUILD_A)
    dt_repo = bundle.debt.for_guild(GUILD_A)

    # Normal streak across 3 slots (6h each) + duplicate slot rejection
    d1 = w.claim_daily(USER_1, BASE_DT.date(), slot=0)
    d_dup = w.claim_daily(USER_1, BASE_DT.date(), slot=0)
    d2 = w.claim_daily(USER_1, BASE_DT.date(), slot=1)
    d3 = w.claim_daily(USER_1, BASE_DT.date(), slot=2)

    # daily_double item armed
    w.set_balance(USER_2, 20000, "fixture_seed")
    item = shop.find("daily_double")
    sh.purchase(USER_2, item.id, item.name, item.price, item.unique, qty=1, now=BASE_TS)
    sh.arm(USER_2, "daily_double")
    d_double = w.claim_daily(USER_2, BASE_DT.date(), slot=0)

    # Debtor with Teiai debt (20% skim + 30% withholding)
    w.set_balance(USER_3, 0, "fixture_seed")
    dt_repo.owe_for(GUILD_A, USER_3, 5000, "fixture_debt")
    d_debtor = w.claim_daily(USER_3, BASE_DT.date(), slot=0)

    write_fixture(
        "daily/claims.json",
        {
            "module": "daily",
            "date": BASE_DT.date().isoformat(),
            "streak_slot0": d1,
            "duplicate_slot0": d_dup,
            "streak_slot1": d2,
            "streak_slot2": d3,
            "with_daily_double": d_double,
            "debtor_claim": {
                "result": d_debtor,
                "balance_after": w.balance(USER_3),
                "debt_after": dt_repo.debt(USER_3),
            },
        },
    )


def gen_transfer() -> None:
    bundle, _ = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    rec = bundle.records.for_guild(GUILD_A)
    dt_repo = bundle.debt.for_guild(GUILD_A)

    w.set_balance(USER_1, 100000, "fixture_seed")
    w.set_balance(USER_2, 5000, "fixture_seed")
    w.set_balance(USER_3, 1000, "fixture_seed")
    dt_repo.owe_for(GUILD_A, USER_3, 5000, "fixture_debt")

    day_start_ts = datetime.datetime(2025, 1, 6, 0, 0, 0, tzinfo=JST).timestamp()
    # Blocked by min_games = 3
    blocked_min_games = w.transfer(
        USER_1, USER_2, 1000, fee_rate=0.1, daily_limit=20000, day_start_ts=day_start_ts, min_games=3
    )
    # Play 3 games via escrow to satisfy min_games=3
    esc = bundle.escrow.for_guild(GUILD_A)
    for _ in range(3):
        eid = esc.place_bet(USER_1, 100, "チンチロ")
        esc.settle(eid, 200, "チンチロ")

    # Normal transfer with 10% ceiling fee (1005 * 0.1 = 100.5 -> 101)
    ok1 = w.transfer(
        USER_1, USER_2, 1005, fee_rate=0.1, daily_limit=20000, day_start_ts=day_start_ts, min_games=3
    )
    # Transfer to debtor triggers 30% withholding on receiver
    ok_to_debtor = w.transfer(
        USER_1, USER_3, 2000, fee_rate=0.1, daily_limit=20000, day_start_ts=day_start_ts, min_games=3
    )
    # Exceeding daily limit of 20000 (already sent 3005, trying 18000)
    over_cap = w.transfer(
        USER_1, USER_2, 18000, fee_rate=0.1, daily_limit=20000, day_start_ts=day_start_ts, min_games=3
    )
    # Sender in debt is blocked
    debtor_send = w.transfer(
        USER_3, USER_2, 500, fee_rate=0.1, daily_limit=20000, day_start_ts=day_start_ts, min_games=0
    )

    write_fixture(
        "transfer/transfers.json",
        {
            "module": "transfer",
            "blocked_min_games": blocked_min_games,
            "ok_1005_ceiling_fee": ok1,
            "ok_2000_to_debtor": {
                "result": ok_to_debtor,
                "receiver_balance_after": w.balance(USER_3),
                "receiver_debt_after": dt_repo.debt(USER_3),
            },
            "over_daily_cap": over_cap,
            "debtor_sender_blocked": debtor_send,
        },
    )


def gen_economy_core() -> None:
    bundle, _ = fresh_repos()
    wa = bundle.wallet.for_guild(GUILD_A)
    wb = bundle.wallet.for_guild(GUILD_B)

    init_a = wa.balance(USER_1)
    init_b = wb.balance(USER_1)
    wa.credit(USER_1, 5000, "chinchiro:win")
    wa.debit_up_to(USER_1, 999999, "slot:bet")
    after_floor_a = wa.balance(USER_1)
    still_init_b = wb.balance(USER_1)

    # History grouping & ledger rows
    wa.set_balance(USER_2, 10000, "fixture_seed")
    wa.debit_up_to(USER_2, 1000, "chinchiro:bet")
    wa.credit(USER_2, 2000, "chinchiro:win")
    wa.debit_up_to(USER_2, 500, "slot:bet")
    wa.credit(USER_2, 1000, "daily")
    hist_rows = wa.history(USER_2, limit=20)
    summarized = history.summarize_history(hist_rows, limit=12)
    game_res = history.game_results(list(reversed(hist_rows)))

    # Asset balance sheet
    assets_a = bundle.assets.for_guild(GUILD_A)
    parts = assets_a.asset_parts(BASE_TS)
    grouped = {str(uid): types.asset_groups(p) for uid, p in parts.items()}
    final_assets = assets_a.final_assets(now=BASE_TS)

    write_fixture(
        "economy-core/core.json",
        {
            "module": "economy-core",
            "per_guild_isolation": {
                "initial_guild_a": init_a,
                "initial_guild_b": init_b,
                "after_floor_clamp_guild_a": after_floor_a,
                "untouched_guild_b": still_init_b,
            },
            "history": {
                "summarized": summarized,
                "game_results": game_res,
            },
            "assets": {
                "parts": parts,
                "groups": grouped,
                "final_assets": final_assets,
            },
        },
    )


# ---------------------------------------------------------------------------
# B3: Stocks, Crypto, Teiai Bank/Debt/CDS, P2P Loans, Kyosai, Player Market, Companies
# ---------------------------------------------------------------------------


def gen_stocks() -> None:
    cov = market.covariance_matrix()
    chol = market.cholesky(cov)
    base_prices = {s.key: s.start for s in market.SYMBOLS}
    rng = random.Random(3001)
    ticks = []
    cur = dict(base_prices)
    for i in range(10):
        cur, shocks = market.next_prices(cur, rng)
        ticks.append({"tick": i, "prices": dict(cur), "shocks": shocks})

    ref = dict(base_prices)
    extreme = {k: v * (1.45 if idx % 2 == 0 else 0.55) for idx, (k, v) in enumerate(ref.items())}
    limited = market.limit_to_day(extreme, ref, limit=0.3)
    pins = market.pin_states(extreme, ref, limit=0.3)

    tax_cases = {
        str(p): market.capital_gains_tax(p)
        for p in [-5000, 0, 5000, 10000, 25000, 50000, 100000, 300000]
    }
    margin_cases = {
        "required_margin_cs_100k": market.required_margin({"cs": 100000.0}),
        "required_margin_multi": market.required_margin({"cs": 50000.0, "tb": 80000.0}),
        "long_pnl_gain": market.margin_pnl("long", 10000, 10000.0, 1.25),
        "short_pnl_gain": market.margin_pnl("short", 10000, 10000.0, 0.8),
        "interest_base_long": market.margin_interest_base("long", 50000.0, 20000),
        "interest_base_short": market.margin_interest_base("short", 50000.0, 20000),
    }

    # Options (single & pair Margrabe)
    sym = market.SYMBOLS[0].key
    sym2 = market.SYMBOLS[1].key
    spot = market.SYMBOLS[0].start
    strike_call = options.strike_for("call", spot)
    strike_put = options.strike_for("put", spot)
    opt_cases = {
        "call_strike": strike_call,
        "put_strike": strike_put,
        "call_ask_24h": options.ask_per_unit("call", sym, spot, strike_call, 86400.0, now=BASE_TS),
        "call_bid_24h": options.bid_per_unit("call", sym, spot, strike_call, 86400.0, now=BASE_TS),
        "put_ask_24h": options.ask_per_unit("put", sym, spot, strike_put, 86400.0, now=BASE_TS),
        "intrinsic_call_itm": options.intrinsic("call", 10000, spot * 1.2, strike_call),
        "pair_ask_rate_24h": options.pair_ask_rate(sym, sym2, 86400.0, now=BASE_TS),
        "pair_bid_rate_24h": options.pair_bid_rate(sym, sym2, 1.1, 1.0, 86400.0, now=BASE_TS),
        "pair_intrinsic": options.pair_intrinsic(10000, 100.0, 100.0, 120.0, 100.0),
    }

    # Earnings & Market Events
    earn_plan = earnings.plan(BASE_TS, 9.0, random.Random(3002))
    memo = earnings.build_memo("CSトークン", 1, earn_plan["release_at"])
    ev_plan = market_events.plan_event(BASE_TS, random.Random(3003))
    ev_mult_during = market_events.multiplier([ev_plan], ev_plan["symbol"], ev_plan["start_ts"] + 60)

    # Bonds & Rates
    rf0 = rates.rf_target(0.15)
    rf1 = rates.rf_step(rf0, 0.15, days=1.0, z=0.5)
    bond_cases = {}
    for k in bonds.KINDS.values():
        rate_pct = rates.bond_rate_pct(k, rf0)
        bond_cases[k.key] = {
            "rate_pct": rate_pct,
            "interest_10000": bonds.interest(k, 10000, rate_pct),
            "maturity_payout_10000": bonds.maturity_payout(k, 10000, rate_pct),
            "default_prob_24h": bonds.default_probability(k, 24.0),
            "sale_value_halfway": bonds.sale_value(
                k,
                10000,
                BASE_TS + (k.hours * 3600) / 2,
                BASE_TS + k.hours * 3600,
                rate_pct=rate_pct,
                discount_per_hour=rates.sale_discount_per_hour(rf0),
            ),
        }

    write_fixture(
        "stocks/market.json",
        {
            "module": "stocks",
            "seeds": {"ticks": 3001, "earnings": 3002, "events": 3003},
            "symbols": market.SYMBOLS,
            "covariance_matrix": cov,
            "cholesky": chol,
            "seeded_ticks": ticks,
            "daily_limits": {"extreme_limited": limited, "pins": pins},
            "capital_gains_tax": tax_cases,
            "margin": margin_cases,
            "options": opt_cases,
            "earnings": {
                "plan": earn_plan,
                "factor_pos": earnings.factor(1, 0.12),
                "factor_neg": earnings.factor(-1, 0.12),
                "jump_variance": earnings.jump_variance(),
                "memo": memo,
            },
            "market_events": {
                "planned": ev_plan,
                "multiplier_during": ev_mult_during,
            },
            "rates_and_bonds": {
                "rf_target_theta_0_15": rf0,
                "rf_step_1d_z_0_5": rf1,
                "bonds": bond_cases,
            },
        },
    )


def gen_crypto() -> None:
    quotes = {
        "buy_10000_at_100": market.buy_quote(10000, 100.0),
        "buy_10000_at_33_3": market.buy_quote(10000, 33.3),
        "sell_50000_at_120": market.sell_quote(50000, 120.0),
        "avg_price_50000_cost_4000": market.avg_price(50000, 4000),
        "pnl_percent": market.pnl_percent(120.0, 50000, 4000),
    }

    bundle, _ = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    cr = bundle.crypto.for_guild(GUILD_A)
    md = bundle.market.for_guild(GUILD_A)
    w.set_balance(USER_1, 100000, "fixture_seed")
    md.market_set(BASE_TS, 100.0, 0, "cs")

    buy1 = cr.crypto_buy(USER_1, 30000, 100.0, symbol="cs")
    buy2 = cr.crypto_buy(USER_1, 20000, 125.0, symbol="cs")
    holdings_mid = cr.holdings(USER_1)
    # Partial sell at profit (price 200.0 -> triggers capital gains tax)
    sell_partial = cr.crypto_sell(USER_1, 200000, 200.0, symbol="cs")
    holdings_after = cr.holdings(USER_1)

    write_fixture(
        "crypto/spot.json",
        {
            "module": "crypto",
            "quotes": quotes,
            "db_flow": {
                "buy1": buy1,
                "buy2": buy2,
                "holdings_mid": holdings_mid,
                "sell_partial": sell_partial,
                "holdings_after": holdings_after,
                "balance_after": w.balance(USER_1),
            },
        },
    )


def gen_teiai() -> None:
    domain_math = {
        "skim_1000": teiai.skim(1000),
        "labor_skim_1000": teiai.labor_skim(1000),
        "withhold_1000": teiai.withhold(1000),
        "cds_odds": {
            "katagi_0": teiai.cds_odds("カタギ", 0, None),
            "laborer_8000": teiai.cds_odds("地下労働者", 8000, None),
            "laborer_20000": teiai.cds_odds("地下労働者", 20000, 0.3),
            "wealthy_0": teiai.cds_odds("富豪", 0, None),
        },
    }

    st0 = thermostat.State(load=0.0, capacity=100000.0)
    st1, net_in, abs_in = thermostat.absorb_inflow(st0, 20000.0)
    st2, net_sh, abs_sh = thermostat.absorb_shock(st1, 30000.0)
    st3 = thermostat.decay(st2, days=2.0)

    # DB Teiai bank, trust, debt, escape, CDS, bankruptcy
    bundle, clock = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    bk = bundle.bank.for_guild(GUILD_A)
    dt_repo = bundle.debt.for_guild(GUILD_A)

    w.set_balance(USER_1, 100000, "fixture_seed")
    w.set_balance(USER_2, 0, "fixture_seed")
    w.set_balance(USER_3, 50000, "fixture_seed")

    # Deposit + trust interest accrual
    dep = bk.bank_deposit(USER_1, 40000, BASE_TS)
    bank_status_1 = bk.bank_status(BASE_TS)
    clock.set_ts(BASE_TS + 24 * 3600)
    accrued_trust = bk.bank_trust_accrue(BASE_TS + 24 * 3600)
    wd = bk.bank_withdraw(USER_1, 10000, BASE_TS + 24 * 3600)

    # Borrow seed + debt below grace -> buy CDS -> push into grace -> interest + escape + forced bankruptcy
    clock.set_ts(BASE_TS)
    seed_res = dt_repo.borrow_seed(USER_2)
    dt_repo.owe_for(GUILD_A, USER_2, 7000, "fixture_subgrace")
    cds_q = bk.cds_quote(USER_2, BASE_TS + 60)
    cds_b = bk.cds_buy(USER_3, USER_2, 5000, BASE_TS + 60)
    dt_repo.owe_for(GUILD_A, USER_2, 9000, "fixture_excess")
    debt_before_int = dt_repo.debt(USER_2)
    int_3d = dt_repo.accrue_debt_interest_for(GUILD_A, USER_2, BASE_TS + 3 * 86400)
    esc_fail = dt_repo.escape_attempt(USER_2, BASE_TS + 3 * 86400, rng=random.Random(3004))
    bankrupt_res = dt_repo.bankrupt(USER_2, forced=True)

    write_fixture(
        "teiai/bank_debt.json",
        {
            "module": "teiai",
            "seed": 3004,
            "domain_math": domain_math,
            "thermostat": {
                "after_inflow_20k": {"state": st1, "net": net_in, "absorbed": abs_in},
                "after_shock_30k": {"state": st2, "net": net_sh, "absorbed": abs_sh},
                "after_decay_2d": st3,
            },
            "db_flow": {
                "deposit_40k": dep,
                "bank_status_initial": bank_status_1,
                "trust_accrue_24h": accrued_trust,
                "withdraw_10k": wd,
                "user1_deposit_after": bk.deposit_of(USER_1),
                "borrow_seed": seed_res,
                "debt_before_interest": debt_before_int,
                "interest_3d": int_3d,
                "cds_quote": cds_q,
                "cds_buy": cds_b,
                "escape_attempt": esc_fail,
                "forced_bankruptcy": bankrupt_res,
                "user2_balance_after": w.balance(USER_2),
                "user2_debt_after": dt_repo.debt(USER_2),
                "user3_balance_after_cds": w.balance(USER_3),
            },
        },
    )


def gen_p2p_loans() -> None:
    # 10000 principal, 1.5%/day (rate_tenths=15), 5-day term
    math_cases = {
        "rate_text_15": loans.rate_text(15),
        "late_rate_tenths_15": loans.late_rate_tenths(15),
        "late_rate_tenths_10": loans.late_rate_tenths(10),
        "full_term_total": loans.full_term_total(10000, 15, 5),
        "total_day_2": loans.total_owed(10000, 15, 5, BASE_TS, BASE_TS + 2 * 86400),
        "total_day_5_due": loans.total_owed(10000, 15, 5, BASE_TS, BASE_TS + 5 * 86400),
        "total_day_10_overdue": loans.total_owed(10000, 15, 5, BASE_TS, BASE_TS + 10 * 86400),
        "total_day_100_capped": loans.total_owed(10000, 15, 5, BASE_TS, BASE_TS + 100 * 86400),
    }

    bundle, clock = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    lr = bundle.loans.for_guild(GUILD_A)
    w.set_balance(USER_1, 50000, "fixture_seed")
    w.set_balance(USER_2, 5000, "fixture_seed")

    offer = lr.loan_offer(USER_1, USER_2, 10000, 15, 5, channel_id=111, now=BASE_TS)
    loan_id = offer[1]
    accept = lr.loan_accept(loan_id, USER_2, BASE_TS + 60)
    repay_part = lr.loan_repay(loan_id, USER_2, 3000, BASE_TS + 2 * 86400)
    rem_mid = lr.loan_remaining(lr.loan_get(loan_id), BASE_TS + 2 * 86400)
    # Maturity auto-collect
    collected = lr.loan_collect_due(BASE_TS + 6 * 86400)

    write_fixture(
        "p2p-loans/loans.json",
        {
            "module": "p2p-loans",
            "domain_math": math_cases,
            "db_flow": {
                "offer": offer,
                "accept": accept,
                "repay_partial_3000": repay_part,
                "remaining_after_partial": rem_mid,
                "collect_due_day6": collected,
                "lender_balance_after": w.balance(USER_1),
                "borrower_balance_after": w.balance(USER_2),
            },
        },
    )


def gen_kyosai() -> None:
    domain_cases = {
        "split_1000_3holders": kyosai.split(1000, [(1, 1), (2, 1), (3, 1)]),
        "split_1000_weighted": kyosai.split(1000, [(1, 5), (2, 3), (3, 2)]),
        "dividend_pool_excess": kyosai.dividend_pool(200000.0, 100000),
        "dividend_pool_below_buffer": kyosai.dividend_pool(110000.0, 100000),
        "gate_locked_ok": kyosai.gate_locked(0.15, 0),
        "gate_locked_low_theta": kyosai.gate_locked(0.05, 0),
        "gate_locked_grace": kyosai.gate_locked(0.20, 1),
        "motion_passes_yes": kyosai.motion_passes(60, 20, 100),
        "motion_passes_quorum_fail": kyosai.motion_passes(10, 0, 100),
        "premium_ok_0_05": kyosai.premium_ok(0.05),
        "premium_ok_0_50": kyosai.premium_ok(0.50),
    }

    bundle, clock = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    ky = bundle.kyosai.for_guild(GUILD_A)
    for u in (USER_1, USER_2, USER_3):
        w.set_balance(u, 200000, "fixture_seed")

    tick_open = ky.kyosai_auction_tick(BASE_TS)
    bid1 = ky.kyosai_bid(USER_1, 5000, BASE_TS + 60)
    bid2 = ky.kyosai_bid(USER_2, 6000, BASE_TS + 120)
    # Advance past auction close (48h+ or 24h)
    tick_settle = ky.kyosai_auction_tick(BASE_TS + 72 * 3600)
    status_u2 = ky.kyosai_status(USER_2, BASE_TS + 72 * 3600)

    # P2P unit transfer from USER_2 to USER_1 (if USER_2 won units)
    u2_units = ky.units_of_for(GUILD_A, USER_2)
    offer_res = None
    accept_res = None
    if u2_units > 0:
        offer_res = ky.kyosai_offer(USER_2, USER_1, 1, 8000, BASE_TS + 72 * 3600 + 60)
        if offer_res and offer_res[0]:
            oid = offer_res[1] if isinstance(offer_res[1], int) else offer_res[0]
            if isinstance(oid, int):
                accept_res = ky.kyosai_accept(USER_1, oid, BASE_TS + 72 * 3600 + 120)

    write_fixture(
        "kyosai/operations.json",
        {
            "module": "kyosai",
            "domain_math": domain_cases,
            "db_flow": {
                "auction_open": tick_open,
                "bid1": bid1,
                "bid2": bid2,
                "auction_settle": tick_settle,
                "u2_units_after_auction": u2_units,
                "u2_status": status_u2,
                "p2p_offer": offer_res,
                "p2p_accept": accept_res,
                "u1_units_after": ky.units_of_for(GUILD_A, USER_1),
                "u2_units_after": ky.units_of_for(GUILD_A, USER_2),
            },
        },
    )


def gen_player_market() -> None:
    domain_cases = {
        "tradable_daily_double": p2p.tradable("daily_double"),
        "tradable_horse_voucher": p2p.tradable("horse_voucher"),
        "fee_of_1000": p2p.fee_of(1000),
        "fee_of_1005": p2p.fee_of(1005),
        "price_range_item": p2p.price_range("item", "daily_double", 1),
        "price_range_horse": p2p.price_range("horse"),
        "min_next_bid_first": p2p.min_next_bid(1000, 0),
        "min_next_bid_after_1000": p2p.min_next_bid(1000, 1000),
        "end_after_bid_snipe": p2p.end_after_bid(BASE_TS + 60, BASE_TS),
        "end_after_bid_normal": p2p.end_after_bid(BASE_TS + 3600, BASE_TS),
    }

    bundle, _ = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    sh = bundle.shop.for_guild(GUILD_A)
    pm = bundle.p2p.for_guild(GUILD_A)
    for u in (USER_1, USER_2, USER_3):
        w.set_balance(u, 100000, "fixture_seed")

    # Give USER_1 two tradable items (daily_double)
    item = shop.find("daily_double")
    sh.purchase(USER_1, item.id, item.name, item.price, item.unique, qty=2, now=BASE_TS)

    # Fixed price listing + buy
    list_fixed = pm.p2p_list(USER_1, "item", "daily_double", 1, "fixed", item.price, now=BASE_TS)
    lid_fixed = list_fixed[1]
    buy_fixed = pm.p2p_buy(USER_2, lid_fixed, BASE_TS + 60)

    # Auction listing + bid + outbid + settle
    list_auc = pm.p2p_list(USER_1, "item", "daily_double", 1, "auction", item.price, hours=6, now=BASE_TS)
    lid_auc = list_auc[1]
    bid_u2 = pm.p2p_bid(USER_2, lid_auc, item.price, BASE_TS + 60)
    bid_u3 = pm.p2p_bid(USER_3, lid_auc, item.price + 500, BASE_TS + 120)
    settled = pm.p2p_settle(BASE_TS + 7 * 3600)

    write_fixture(
        "player-market/listings.json",
        {
            "module": "player-market",
            "domain_math": domain_cases,
            "db_flow": {
                "list_fixed": list_fixed,
                "buy_fixed": buy_fixed,
                "list_auction": list_auc,
                "bid_u2": bid_u2,
                "bid_u3": bid_u3,
                "settled": settled,
                "balances_after": {
                    "u1": w.balance(USER_1),
                    "u2": w.balance(USER_2),
                    "u3": w.balance(USER_3),
                },
            },
        },
    )


def gen_companies() -> None:
    kinds = ["mine", "farm", "factory", "casino"]
    # Pick valid kind keys from domain.company.KINDS
    kind_keys = list(company.KINDS.keys()) if hasattr(company, "KINDS") else kinds
    k0 = kind_keys[0]
    day_st = company.day_state(k0, GUILD_A, "2025-01-06")
    prod = company.produce(k0, 1, GUILD_A, 0.0, BASE_TS, BASE_TS + 12 * 3600, 9.0)
    sale_full = company.sale(10.0, 500.0, budget=10000)
    sale_capped = company.sale(10.0, 500.0, budget=2300)
    div_split = company.dividend_split(10000, 0.5, {USER_2: 30000, USER_3: 20000})
    st_vals = company.stake_values(100000, {USER_2: 30000, USER_3: 20000})

    bundle, clock = fresh_repos()
    w = bundle.wallet.for_guild(GUILD_A)
    co = bundle.company.for_guild(GUILD_A)
    w.set_balance(USER_1, 300000, "fixture_seed")
    w.set_balance(USER_2, 200000, "fixture_seed")

    found = co.company_found(USER_1, "帝愛商事", k0, BASE_TS)
    invest_owner = co.company_invest(USER_1, 20000, BASE_TS + 60)
    invest_stake = co.stake_invest(USER_2, USER_1, 10000, BASE_TS + 120)
    set_div = co.company_set_dividend(USER_1, 0.3, BASE_TS + 180)
    clock.set_ts(BASE_TS + 12 * 3600)
    ship = co.company_ship(USER_1, BASE_TS + 12 * 3600)
    state_after_ship = co.company_get(USER_1, BASE_TS + 12 * 3600)
    clock.set_ts(BASE_TS + 36 * 3600)
    settled = co.company_settle_all(BASE_TS + 36 * 3600)

    write_fixture(
        "companies/operations.json",
        {
            "module": "companies",
            "kind_sample": k0,
            "domain_math": {
                "daily_output_lv1": company.daily_output(k0, 1),
                "storage_cap_lv1": company.storage_cap(k0, 1),
                "daily_upkeep_lv1": company.daily_upkeep(1),
                "upgrade_cost_lv1": company.upgrade_cost(1),
                "invested_lv1": company.invested(1),
                "stake_cap_lv1": company.stake_cap(1),
                "day_state_2025_01_06": day_st,
                "produce_12h": prod,
                "sale_full": sale_full,
                "sale_capped_2300": sale_capped,
                "dividend_split": div_split,
                "stake_values": st_vals,
            },
            "db_flow": {
                "found": found,
                "owner_invest": invest_owner,
                "stake_invest": invest_stake,
                "set_dividend": set_div,
                "ship_12h": ship,
                "state_after_ship": state_after_ship,
                "settle_36h": settled,
                "u1_balance_after": w.balance(USER_1),
                "u2_balance_after": w.balance(USER_2),
            },
        },
    )


GENERATORS = [
    ("casino-common", gen_casino_common),
    ("chinchiro", gen_chinchiro),
    ("pachinko", gen_pachinko),
    ("slots", gen_slots),
    ("blackjack", gen_blackjack),
    ("roulette", gen_roulette),
    ("horse", gen_horse),
    ("arena", gen_arena),
    ("labor", gen_labor),
    ("relics", gen_relics),
    ("quiz", gen_quiz),
    ("lottery", gen_lottery),
    ("polls", gen_polls),
    ("shop", gen_shop),
    ("missions", gen_missions),
    ("weekly-ranking", gen_weekly_ranking),
    ("daily", gen_daily),
    ("transfer", gen_transfer),
    ("economy-core", gen_economy_core),
    ("stocks", gen_stocks),
    ("crypto", gen_crypto),
    ("teiai", gen_teiai),
    ("p2p-loans", gen_p2p_loans),
    ("kyosai", gen_kyosai),
    ("player-market", gen_player_market),
    ("companies", gen_companies),
]


def main() -> int:
    for name, fn in GENERATORS:
        fn()
        print(f"generated: {name}")
    print(f"done: {len(GENERATORS)} modules")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
