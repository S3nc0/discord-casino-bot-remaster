"""帝愛銀行の最前線サーモスタット（#32）。数字の調整は catalogs/teiai.yaml の thermostat。

銀行に出入りするペリカは、金庫に届く前にここを通る。状態は2つの熱量:

- 短期熱量 L: 最近の純熱収支（流入でプラス、損失でマイナス）。COOL_DAYS 日で 1/10 に冷める
- 長期キャパシティ E: 受け止められる器の大きさ。L から遅れて動き、E_MIN を下回らない

流入 G は、まず L < 0（赤字帯）の穴埋めに素通しで使い、0 を超えた残りだけを器に通す。
器に収まる分は銀行に入り、あふれた分（burn）は熱浴へ消える。
損失 S は、まず L > 0（黒字帯）の分を銀行が全額負い、0 を割った残りだけを負側の器に通す。
器に収まる分は銀行が負い、あふれた分（bailout）は熱浴が肩代わりする。債務としては記録しない。

流入どうし・損失どうしは、1回でまとめて通しても小口に分けて通しても結果が同じ（分割不変）。
流入と損失の順番は入れ替えると結果が変わるので、同じバッチで両方が出る処理は、
先に純額へまとめてから absorb_net で1回だけ通す。
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
COUPLING = _CFG.coupling  # c: |L| が器をどれだけ塞ぐか。1.0 未満にすると負側で器が詰まりうる


@dataclass(frozen=True)
class State:
    load: float = 0.0  # L（符号付き）
    capacity: float = E_MIN  # E


def decay(state: State, days: float) -> State:
    """days 日ぶん時間を進める（厳密解。2回に分けて進めても、1回で進めても同じ）。

    E は符号付きの L のまま更新し、E_MIN で床を打つ。一度 E_MIN を割る軌道は、
    次の入出金まで割ったままなので、床を打っても分割して進めた結果と一致する。
    """
    if days <= 0:
        return state
    fall_l, fall_e = math.exp(-LAMBDA_L * days), math.exp(-LAMBDA_E * days)
    capacity = E_MIN + (state.capacity - E_MIN) * fall_e + state.load * (fall_e - fall_l)
    return replace(state, load=state.load * fall_l, capacity=max(E_MIN, capacity))


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
    fill = min(gain, max(-state.load, 0.0))  # 赤字帯の穴埋めは素通し
    load = state.load + fill
    rest = compute_net(gain - fill, max(load, 0.0), state.capacity)
    net = fill + rest
    return replace(state, load=load + rest), net, gain - net


def absorb_shock(state: State, loss: float) -> tuple[State, float, float]:
    """損失 loss を通す。(新しい状態, 銀行が負う分 effective, 熱浴が肩代わりする分 bailout)。"""
    if loss <= 0:
        return state, 0.0, 0.0
    covered = min(loss, max(state.load, 0.0))  # 黒字帯の分は銀行が全額負う
    load = state.load - covered
    rest = compute_net(loss - covered, max(-load, 0.0), state.capacity)
    effective = covered + rest
    return replace(state, load=load - rest), effective, loss - effective


def absorb_net(state: State, amount: float) -> tuple[State, float, float]:
    """バッチの純額 amount（流入がプラス、流出がマイナス）を1回だけ通す。(新しい状態, burn, bailout)。"""
    if amount > 0:
        state, _, burn = absorb_inflow(state, amount)
        return state, burn, 0.0
    state, _, bailout = absorb_shock(state, -amount)
    return state, 0.0, bailout
