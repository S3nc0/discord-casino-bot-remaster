"""地下闘技場: 形式決定・戦士生成・武器強度・試合シミュレーション・配当計算の純粋ロジック・永続化。"""

import random

import pytest

from domain import arena as a
from infra.db.repositories import open_repositories

U, V = 1, 2
NOW = 1_000_000.0
TZ = 9.0  # 本番の utc_offset_hours


@pytest.fixture
def repos(tmp_path):
    bundle = open_repositories(str(tmp_path / "t.db"))
    try:
        bundle.wallet.credit(U, 50_000, "テスト")
        bundle.wallet.credit(V, 50_000, "テスト")
        yield bundle
    finally:
        bundle.close()


def test_group_size_matches_format():
    assert a.group_size("duel") == 2 and a.group_size("royale") == 4


def test_semi_groups_matches_format():
    assert a.semi_groups("duel") == 2 and a.semi_groups("royale") == 4


def test_win_weights_favor_the_stronger_fighter_and_sum_to_one():
    fighters = [{"name": "強い", "base_power": 80, "bet_total": 0}, {"name": "弱い", "base_power": 20, "bet_total": 0}]
    w = a.win_weights(fighters)
    assert w[0] > w[1]
    assert abs(sum(w) - 1) < 1e-9


def test_match_odds_are_higher_for_the_weaker_fighter_and_respect_the_cap():
    fighters = [{"name": "強い", "base_power": 60, "bet_total": 0}, {"name": "弱い", "base_power": 40, "bet_total": 0}]
    odds = a.match_odds(fighters)
    assert odds["弱い"] > odds["強い"] > 1.0
    assert all(o <= a.MAX_ODDS for o in odds.values())


def test_match_odds_boost_raises_the_odds_but_never_past_the_cap():
    fighters = [{"name": "強い", "base_power": 60, "bet_total": 0}, {"name": "弱い", "base_power": 40, "bet_total": 0}]
    plain = a.match_odds(fighters)
    boosted = a.match_odds(fighters, boost=a.FINAL_ODDS_BOOST)
    assert boosted["強い"] > plain["強い"] and boosted["弱い"] > plain["弱い"]  # 決勝は、より高いオッズになる
    assert all(o <= a.MAX_ODDS for o in boosted.values())


def test_generate_fighters_count_matches_format_and_names_are_unique():
    rng = random.Random(1)
    duel = a.generate_fighters("duel", rng)
    assert len(duel) == 4 and len({f["name"] for f in duel}) == 4  # 1on1: 2組×2人
    rng2 = random.Random(1)
    royale = a.generate_fighters("royale", rng2)
    assert len(royale) == 16 and len({f["name"] for f in royale}) == 16  # バトロワ: 4組×4人
    assert all(a.BASE_POWER_MIN <= f["base_power"] <= a.BASE_POWER_MAX for f in duel + royale)


def test_weapon_bonus_scales_with_bets_and_caps():
    assert a.weapon_bonus(0) == 0.0
    assert 0 < a.weapon_bonus(a.WEAPON_SCALE // 2) < a.WEAPON_CAP
    assert a.weapon_bonus(a.WEAPON_SCALE) == a.WEAPON_CAP
    assert a.weapon_bonus(a.WEAPON_SCALE * 10) == a.WEAPON_CAP  # 上限を超えない


def test_effective_power_is_boosted_by_bets():
    assert a.effective_power(50, 0) == 50
    assert a.effective_power(50, a.WEAPON_SCALE) == 50 * (1 + a.WEAPON_CAP)


def test_simulate_match_favors_the_stronger_and_more_bet_fighter_but_not_always():
    fighters = [{"name": "強い", "base_power": 80}, {"name": "弱い", "base_power": 20}]
    wins = [0, 0]
    for i in range(2000):
        wins[a.simulate_match(fighters, {}, random.Random(i))] += 1
    assert wins[0] > wins[1] * 2  # 強いほうが勝ちやすい
    assert wins[1] > 0  # だが、必ず勝てるわけではない


def test_simulate_match_weapon_bonus_increases_win_chance():
    fighters = [{"name": "A", "base_power": 50}, {"name": "B", "base_power": 50}]
    plain = sum(a.simulate_match(fighters, {}, random.Random(i)) == 0 for i in range(2000)) / 2000
    boosted = sum(a.simulate_match(fighters, {"A": a.WEAPON_SCALE}, random.Random(i)) == 0 for i in range(2000)) / 2000
    assert boosted > plain + 0.1  # 賭け総額ぶんの武器で、勝ちやすくなる


def test_payout_scale_caps_at_available_pool_and_never_exceeds_one():
    assert a.payout_scale(10_000, 5_000) == 1.0  # 原資が十分なら、満額
    assert a.payout_scale(2_000, 4_000) == 0.5  # 足りなければ、比例して減る
    assert a.payout_scale(0, 1_000) == 0.0
    assert a.payout_scale(10_000, 0) == 1.0  # 配当が無いなら、常に満額（0倍）扱い


def test_battle_frames_loser_reaches_zero_and_winner_survives():
    frames = a.battle_frames(3, winner_idx=1, rng=random.Random(1), frames=6)
    assert len(frames) == 7  # 初期状態 + 6コマ
    assert frames[0] == [100, 100, 100]
    last = frames[-1]
    assert last[1] > 0
    assert last[0] == 0 and last[2] == 0


def test_arena_tournament_ensure_creates_once_per_format_and_is_idempotent(repos):
    duel1 = repos.arena.arena_tournament_ensure("duel", NOW, TZ, rng=random.Random(1))
    duel2 = repos.arena.arena_tournament_ensure("duel", NOW, TZ, rng=random.Random(2))  # 2回目は作り直さない
    assert duel1["id"] == duel2["id"]
    assert len(duel1["fighters"]) == 4
    assert len({f["group_no"] for f in duel1["fighters"]}) == 2

    royale = repos.arena.arena_tournament_ensure("royale", NOW, TZ, rng=random.Random(1))
    assert royale["id"] != duel1["id"]  # 1on1とバトロワは、別の大会として両立する
    assert len(royale["fighters"]) == 16
    assert len({f["group_no"] for f in royale["fighters"]}) == 4


def test_arena_tournaments_ensure_today_creates_both_formats(repos):
    both = repos.arena.arena_tournaments_ensure_today(NOW, TZ, rng=random.Random(1))
    assert {t["format"] for t in both} == {"duel", "royale"}


def test_arena_bet_validates_range_eliminated_and_closed_stage(repos):
    t = repos.arena.arena_tournament_ensure("duel", NOW, TZ, rng=random.Random(1))
    fid = t["fighters"][0]["id"]
    assert repos.arena.arena_bet(U, fid, a.MIN_STAKE - 1, NOW)[0] is False
    assert repos.arena.arena_bet(U, fid, a.MAX_STAKE + 1, NOW)[0] is False
    before = repos.wallet.balance(U)
    ok, reason = repos.arena.arena_bet(U, fid, 1_000, NOW)
    assert ok and reason == ""
    assert repos.wallet.balance(U) == before - 1_000
    repos.arena.arena_run_semis(t["id"], rng=random.Random(1))
    fighters_after = repos.arena.arena_fighters(t["id"])
    eliminated = next(f for f in fighters_after if f["stage"] == "out")
    assert repos.arena.arena_bet(V, eliminated["id"], 1_000, NOW)[0] is False  # 脱落した戦士には賭けられない


def test_arena_run_semis_advances_exactly_two_finalists_and_settles_group_bets(repos):
    t = repos.arena.arena_tournament_ensure("duel", NOW, TZ, rng=random.Random(3))
    fighters = t["fighters"]
    repos.arena.arena_bet(U, fighters[0]["id"], 2_000, NOW)
    repos.arena.arena_bet(V, fighters[1]["id"], 2_000, NOW)
    before = repos.wallet.balance(U) + repos.wallet.balance(V)
    result = repos.arena.arena_run_semis(t["id"], rng=random.Random(5))
    assert result is not None and len(result["finalists"]) == 2
    after_fighters = repos.arena.arena_fighters(t["id"])
    assert sum(1 for f in after_fighters if f["stage"] == "final") == 2
    assert sum(1 for f in after_fighters if f["stage"] == "out") == len(fighters) - 2
    bets = repos.arena.arena_my_bets(t["id"], U) + repos.arena.arena_my_bets(t["id"], V)
    assert all(b["settled"] for b in bets)
    after = repos.wallet.balance(U) + repos.wallet.balance(V)
    assert after <= before + 2_000 * (a.MAX_ODDS - 1)  # 新しいペリカを大量発生させていない


def test_arena_run_semis_for_royale_advances_four_finalists(repos):
    t = repos.arena.arena_tournament_ensure("royale", NOW, TZ, rng=random.Random(3))
    result = repos.arena.arena_run_semis(t["id"], rng=random.Random(5))
    assert result is not None and len(result["finalists"]) == 4  # 4組の準決勝→決勝は4人
    after_fighters = repos.arena.arena_fighters(t["id"])
    assert sum(1 for f in after_fighters if f["stage"] == "final") == 4
    assert sum(1 for f in after_fighters if f["stage"] == "out") == 12


def test_arena_run_final_crowns_champion_and_pays_without_minting_money(repos):
    t = repos.arena.arena_tournament_ensure("duel", NOW, TZ, rng=random.Random(3))
    repos.arena.arena_run_semis(t["id"], rng=random.Random(5))
    finalists = [f for f in repos.arena.arena_fighters(t["id"]) if f["stage"] == "final"]
    repos.arena.arena_bet(U, finalists[0]["id"], 3_000, NOW)
    repos.arena.arena_bet(V, finalists[1]["id"], 3_000, NOW)
    before = repos.wallet.balance(U) + repos.wallet.balance(V)
    result = repos.arena.arena_run_final(t["id"], rng=random.Random(7))
    assert result is not None and result["champion"] in (finalists[0]["name"], finalists[1]["name"])
    after = repos.wallet.balance(U) + repos.wallet.balance(V)
    # 負けた側の賭け(3,000)が原資。決勝はオッズにブーストがかかるが、原資を超えて配当しない
    assert after - before <= 3_000
    tour = repos.arena.arena_tournament_get_by_day(repos.arena.arena_today(NOW, TZ), "duel")
    assert tour is not None and tour["status"] == "done"


def test_arena_run_final_for_royale_settles_three_losers_at_once(repos):
    t = repos.arena.arena_tournament_ensure("royale", NOW, TZ, rng=random.Random(3))
    repos.arena.arena_run_semis(t["id"], rng=random.Random(5))
    pre_finalist_ids = {f["id"] for f in repos.arena.arena_fighters(t["id"]) if f["stage"] == "final"}
    result = repos.arena.arena_run_final(t["id"], rng=random.Random(7))
    assert result is not None
    assert len(result["runner_up"]) == 3  # 決勝は4人同時なので、負けは3人
    after_fighters = {f["id"]: f for f in repos.arena.arena_fighters(t["id"])}
    finalists_after = [after_fighters[fid] for fid in pre_finalist_ids]
    assert sum(1 for f in finalists_after if f["result"] == "won") == 1
    assert sum(1 for f in finalists_after if f["result"] == "lost") == 3


def test_arena_payout_scales_down_when_pool_is_insufficient(repos):
    t = repos.arena.arena_tournament_ensure("duel", NOW, TZ, rng=random.Random(3))
    fighters = t["fighters"]
    group1 = [f for f in fighters if f["group_no"] == 1]
    # 勝つ方に大量、負ける方には少額だけ賭けておく（原資が足りない状況を作る）
    repos.wallet.credit(U, 100_000, "テスト")
    winner_bias = group1[0]
    repos.arena.arena_bet(U, winner_bias["id"], a.MAX_STAKE, NOW)
    repos.arena.arena_bet(V, group1[1]["id"], a.MIN_STAKE, NOW)
    before = repos.wallet.balance(U)
    repos.arena.arena_run_semis(t["id"], rng=random.Random(1))
    my_bet = next(b for b in repos.arena.arena_my_bets(t["id"], U) if b["fighter_id"] == winner_bias["id"])
    if my_bet["payout"] > 0:  # 勝っていれば、配当は原資（負け分）を超えない
        assert my_bet["payout"] <= a.MIN_STAKE * a.MAX_ODDS + 1
    assert repos.wallet.balance(U) - before == my_bet["payout"]  # 賭け金はbet時点で引かれ済み。差分=配当そのもの
