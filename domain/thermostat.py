"""帝愛銀行の最前線サーモスタット（#32）。数字の調整は catalogs/teiai.yaml の thermostat。

銀行に出入りするペリカは、金庫に届く前にここを通る。状態は2つの熱量と、熱浴への借り:

- 短期熱量 L: 最近、銀行が実際に受け止めた額。COOL_DAYS 日で 1/10 に冷める
- 長期キャパシティ E: 受け止められる器の大きさ。L から遅れて育ち、E_MIN へ向かってゆっくり縮む
- ベイルアウト債務 D: 損失のとき、熱浴（系の外）が肩代わりした額の累計

流入 G のうち、器に収まる分（net）だけが銀行に入り、あふれた分（burn）は熱浴へ消える。
損失 S も同じ関数で、銀行が負う分（effective）と、熱浴が肩代わりする分（bailout）に分ける。
どちらも、受け止めた分だけ L が増える。そのため、1回でまとめて通しても、小口に分けて通しても、結果は同じ（分割不変）。
"""

import math
from dataclasses import dataclass, replace

from domain.ports import get_catalogs

_CFG = get_catalogs().teiai().thermostat

ENFORCE = _CFG.enforce  # False の間は観測だけ（銀行の現金には手を付けず、消える額・肩代わりの額を記録する）
COOL_DAYS = _CFG.cool_days
LAMBDA_L = math.log(10) / COOL_DAYS  # L の減衰率（1日あたり）
LAMBDA_E = LAMBDA_L / _CFG.memory_ratio  # E の減衰率（L より遅い）
E_MIN = float(_CFG.capacity_min)
COUPLING = _CFG.coupling  # c: L が器をどれだけ塞ぐか
BAILOUT_SCALE = float(_CFG.bailout_scale)  # K: 債務がこの額に達すると、余剰の還元が止まる
PAYOUT_MAX = _CFG.payout_max  # ρ_max: 債務がないときの還元率


@dataclass(frozen=True)
class State:
    load: float = 0.0  # L
    capacity: float = E_MIN  # E
    bailout_debt: float = 0.0  # D


def decay(state: State, days: float) -> State:
    """days 日ぶん時間を進める（厳密解。2回に分けて進めても、1回で進めても同じ）。"""
    if days <= 0:
        return state
    fall_l, fall_e = math.exp(-LAMBDA_L * days), math.exp(-LAMBDA_E * days)
    capacity = E_MIN + (state.capacity - E_MIN) * fall_e + state.load * (fall_e - fall_l)
    return replace(state, load=state.load * fall_l, capacity=capacity)


def compute_net(amount: float, load: float, capacity: float) -> float:
    """amount のうち、器（capacity と load で決まる）に収まる分。amount が大きいほど、上限 (E - cL)/c に張り付く。"""
    if amount <= 0 or capacity <= 0:
        return 0.0
    room = max(capacity - COUPLING * load, 0.0) / COUPLING
    return room * -math.expm1(-COUPLING * amount / capacity)


def absorb_inflow(state: State, gain: float) -> tuple[State, float, float]:
    """流入 gain を通す。(新しい状態, 銀行に入る分 net, 熱浴へ消える分 burn)。"""
    if gain <= 0:
        return state, 0.0, 0.0
    net = compute_net(gain, state.load, state.capacity)
    return replace(state, load=state.load + net), net, gain - net


def absorb_shock(state: State, loss: float) -> tuple[State, float, float]:
    """損失 loss を通す。(新しい状態, 銀行が負う分 effective, 熱浴が肩代わりする分 bailout)。肩代わりは債務に積む。"""
    if loss <= 0:
        return state, 0.0, 0.0
    effective = compute_net(loss, state.load, state.capacity)
    bailout = loss - effective
    return (
        replace(state, load=state.load + effective, bailout_debt=state.bailout_debt + bailout),
        effective,
        bailout,
    )


def payout_ratio(bailout_debt: float) -> float:
    """余剰のうち、還元に回してよい割合 ρ。債務が残っているほど絞られ、BAILOUT_SCALE 以上で 0。"""
    return PAYOUT_MAX * max(0.0, 1.0 - bailout_debt / BAILOUT_SCALE)


def repay_bailout(state: State, amount: float) -> tuple[State, float]:
    """債務を amount まで返す。(新しい状態, 実際に返した額)。"""
    paid = min(max(amount, 0.0), state.bailout_debt)
    return replace(state, bailout_debt=state.bailout_debt - paid), paid
