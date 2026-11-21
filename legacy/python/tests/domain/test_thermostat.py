"""最前線サーモスタット（#32）: 符号付きの熱量・時間推移の半群性・分割不変な流入/損失・熱浴への上納と肩代わり・バッチの純額。"""

import math

import pytest

from domain import thermostat as th


def test_decay_cools_load_to_a_tenth_in_cool_days_and_capacity_returns_to_the_floor():
    hot = th.State(load=100_000.0, capacity=th.E_MIN + 500_000.0)
    cooled = th.decay(hot, th.COOL_DAYS)
    assert cooled.load == pytest.approx(10_000.0)
    assert th.decay(hot, 0) == hot
    long_after = th.decay(hot, 3650)
    assert long_after.load == pytest.approx(0.0, abs=1e-6)
    assert long_after.capacity == pytest.approx(th.E_MIN)


@pytest.mark.parametrize(
    "start",
    [
        th.State(load=420_000.0, capacity=1_700_000.0),
        th.State(load=-30_000.0, capacity=400_000.0),  # 赤字帯でも、床に届かない
        th.State(load=-200_000.0, capacity=th.E_MIN + 10_000.0),  # 途中で E_MIN の床に当たる
    ],
)
def test_decay_is_a_semigroup_so_stepping_twice_equals_stepping_once(start):
    once = th.decay(start, 9.5)
    twice = th.decay(th.decay(start, 3.25), 6.25)
    assert twice.load == pytest.approx(once.load)
    assert twice.capacity == pytest.approx(once.capacity)


def test_capacity_never_falls_below_the_floor_after_losses():
    state = th.State(load=-200_000.0, capacity=th.E_MIN + 10_000.0)
    for days in (0.5, 1, 3, 10, 100):
        assert th.decay(state, days).capacity >= th.E_MIN
    assert th.decay(state, 3).capacity == th.E_MIN  # 赤字の熱量は、器を床の側へ縮める


def test_capacity_grows_from_load_before_it_shrinks_back():
    start = th.State(load=600_000.0, capacity=th.E_MIN)
    assert th.decay(start, 5).capacity > th.E_MIN  # L が、遅れて器を育てる


def test_small_inflow_mostly_reaches_the_bank_and_the_rest_burns():
    state = th.State(load=100_000.0, capacity=400_000.0)
    after, net, burn = th.absorb_inflow(state, 1_000)
    assert net + burn == pytest.approx(1_000)
    assert net == pytest.approx(1_000 * (1 - th.COUPLING * 100_000 / 400_000), rel=0.01)  # 少額なら (1 - cL/E) 倍
    assert after.load == pytest.approx(state.load + net) and after.capacity == state.capacity


def test_huge_inflow_is_capped_at_the_room_and_the_excess_burns():
    state = th.State(load=100_000.0, capacity=400_000.0)
    room = (state.capacity - th.COUPLING * state.load) / th.COUPLING
    after, net, burn = th.absorb_inflow(state, 12_000_000)
    assert net == pytest.approx(room) and burn == pytest.approx(12_000_000 - room)
    assert th.absorb_inflow(after, 1_000_000)[1] == pytest.approx(0.0, abs=1e-3)  # もう器は一杯


@pytest.mark.parametrize("parts", [2, 7, 100])
def test_inflow_is_split_invariant(parts):
    start = th.State(load=80_000.0, capacity=500_000.0)
    whole, net_whole, burn_whole = th.absorb_inflow(start, 900_000)
    state, net_sum, burn_sum = start, 0.0, 0.0
    for _ in range(parts):
        state, net, burn = th.absorb_inflow(state, 900_000 / parts)
        net_sum, burn_sum = net_sum + net, burn_sum + burn
    assert net_sum == pytest.approx(net_whole) and burn_sum == pytest.approx(burn_whole)
    assert state.load == pytest.approx(whole.load)


def test_loss_within_the_positive_load_is_borne_entirely_by_the_bank():
    state = th.State(load=100_000.0, capacity=400_000.0)
    after, effective, bailout = th.absorb_shock(state, 60_000)
    assert effective == 60_000 and bailout == 0.0  # 黒字帯の中なら、肩代わりはない
    assert after.load == pytest.approx(40_000.0) and after.capacity == state.capacity


def test_shock_beyond_zero_goes_through_the_negative_cap_and_the_excess_is_bailed_out():
    state = th.State(load=100_000.0, capacity=400_000.0)
    after, effective, bailout = th.absorb_shock(state, 2_000_000)
    assert effective + bailout == pytest.approx(2_000_000)
    rest = th.compute_net(1_900_000, 0.0, state.capacity)  # 0 を割ったところからは、負側の器に通す
    assert effective == pytest.approx(100_000 + rest) and rest <= state.capacity / th.COUPLING  # 黒字帯 + 負側の器まで
    assert after.load == pytest.approx(state.load - effective) and after.load < 0


def test_inflow_refills_a_negative_load_in_full_before_anything_burns():
    state = th.State(load=-50_000.0, capacity=400_000.0)
    after, net, burn = th.absorb_inflow(state, 30_000)
    assert net == 30_000 and burn == 0.0 and after.load == pytest.approx(-20_000.0)
    after, net, burn = th.absorb_inflow(after, 1_000_000)
    assert net == pytest.approx(20_000 + th.compute_net(980_000, 0.0, state.capacity))  # 0 まで素通し、その先は器に通す
    assert net <= 1_000_000  # 流入より多くは入らない


@pytest.mark.parametrize("load", [50_000.0, -120_000.0])
def test_shock_is_split_invariant_even_across_zero(load):
    start = th.State(load=load, capacity=600_000.0)
    whole, eff_whole, bail_whole = th.absorb_shock(start, 1_500_000)
    state, eff_sum, bail_sum = start, 0.0, 0.0
    for _ in range(30):
        state, eff, bail = th.absorb_shock(state, 1_500_000 / 30)
        eff_sum, bail_sum = eff_sum + eff, bail_sum + bail
    assert eff_sum == pytest.approx(eff_whole) and bail_sum == pytest.approx(bail_whole)
    assert state.load == pytest.approx(whole.load)


def test_inflow_is_split_invariant_from_a_negative_load():
    start = th.State(load=-90_000.0, capacity=500_000.0)
    whole, net_whole, burn_whole = th.absorb_inflow(start, 900_000)
    state, net_sum, burn_sum = start, 0.0, 0.0
    for _ in range(45):
        state, net, burn = th.absorb_inflow(state, 900_000 / 45)
        net_sum, burn_sum = net_sum + net, burn_sum + burn
    assert net_sum == pytest.approx(net_whole) and burn_sum == pytest.approx(burn_whole)
    assert state.load == pytest.approx(whole.load)


def test_absorb_net_routes_the_sign_and_makes_a_batch_order_independent():
    start = th.State(load=30_000.0, capacity=300_000.0)
    flows = [400_000, -250_000, 90_000, -700_000]
    after, burn, bailout = th.absorb_net(start, sum(flows))  # 純額 -460,000
    expected, _, expected_bailout = th.absorb_shock(start, 460_000)
    assert burn == 0.0 and bailout == pytest.approx(expected_bailout) and after == expected
    assert th.absorb_net(start, 0) == (start, 0.0, 0.0)
    up, burn, bailout = th.absorb_net(start, 2_000_000)
    assert bailout == 0.0 and burn == pytest.approx(th.absorb_inflow(start, 2_000_000)[2])


def test_zero_or_negative_amounts_change_nothing():
    state = th.State(load=1.0, capacity=th.E_MIN)
    assert th.absorb_inflow(state, 0) == (state, 0.0, 0.0)
    assert th.absorb_shock(state, -5) == (state, 0.0, 0.0)
    assert th.compute_net(100, 0, 0) == 0.0


def test_steady_inflow_settles_at_the_analytic_equilibrium():
    q, dt = 150_000.0, 1 / 24  # 1日 15万ペリカが、1時間ごとに入る
    state = th.State()
    for _ in range(24 * 400):
        state = th.decay(state, dt)
        state, _net, _burn = th.absorb_inflow(state, q * dt)
    ratio = state.load / state.capacity
    # 定常では、入る分 q(1 - cL/E) と冷める分 λ_L·L が釣り合い、器は E_MIN + (λ_L/λ_E - 1)·L になる
    assert q * (1 - th.COUPLING * ratio) == pytest.approx(th.LAMBDA_L * state.load, rel=0.03)
    assert state.capacity == pytest.approx(th.E_MIN + (th.LAMBDA_L / th.LAMBDA_E - 1) * state.load, rel=0.03)
    assert math.isfinite(state.load) and 0 < ratio < 1 / th.COUPLING
