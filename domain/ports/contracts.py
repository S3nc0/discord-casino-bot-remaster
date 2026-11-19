"""ポートの戻り値に使う、型付きの入れ物（catalogs に依存しない値型だけを置く）。

domain/types.py は catalogs を読むため、ポート（domain/ports）からは実行時に import できない。
ポートの契約に出てくる値型は、ここに置く。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ActiveBond:
    """持っている（status='active' の）債券 1 件。破産の換金・差し押さえで使う。"""

    id: int
    kind: str
    principal: int


@dataclass(frozen=True)
class SeizedBelongings:
    """破産で没収したショップの持ち物（品 ID と個数の列。持ち物 → デイリー2倍券 → 保険券の順）。"""

    items: tuple[tuple[str, int], ...]
