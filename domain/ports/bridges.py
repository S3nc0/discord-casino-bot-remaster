"""永続化・サービス層を疎結合に合成するための Bridge / Composite 契約（名前的基底クラス）。

すべてのクラスは具象側でオーバーライドされることを前提とし、
MRO 衝突や暗黙の構造的部分型に頼らず、クライアント側からの Bridge / Strategy 差し替えを可能にする。
"""

from collections.abc import Callable
from typing import TYPE_CHECKING, Any, Optional

if TYPE_CHECKING:
    from domain.errors import Failure
    from domain.types import CryptoResult

AddAssetPart = Callable[[int, str, int], None]


class IDebtLifecycleHook:
    """台帳更新に連動する借金利息・天引き・猶予更新のブリッジ契約。"""

    def accrue_interest(self, guild_id: int, user_id: int, now: Optional[float] = None) -> int:
        return 0

    def after_debt_change(self, guild_id: int, user_id: int) -> None:
        return None

    def withhold_income(self, guild_id: int, user_id: int, income: int) -> int:
        return 0


class IStatusReader:
    """ユーザーの借金・身分・ブラックリスト状態の読み取り契約。"""

    def status_for(self, guild_id: int, user_id: int, now: Optional[float] = None) -> str:
        raise NotImplementedError

    def debt_for(self, guild_id: int, user_id: int) -> int:
        raise NotImplementedError

    def loan_blacklisted_for(self, guild_id: int, user_id: int, now: Optional[float] = None) -> bool:
        raise NotImplementedError


class IDebtOps:
    """信用取引・クイズ・預かり金・ウォレットが利用する借金・種銭操作契約。"""

    def borrow_seed_for(self, guild_id: int, user_id: int) -> tuple[Any, ...]:
        raise NotImplementedError

    def can_borrow_for_bet_for(self, guild_id: int, user_id: int, need: int) -> tuple[Any, ...]:
        raise NotImplementedError

    def seed_for(self, guild_id: int, user_id: int, amount: int) -> None:
        raise NotImplementedError

    def topup_seed_for(self, guild_id: int, user_id: int) -> int:
        raise NotImplementedError

    def owe_for(self, guild_id: int, user_id: int, shortfall: int, reason: str) -> int:
        raise NotImplementedError

    def accrue_debt_interest_for(self, guild_id: int, user_id: int, now: Optional[float] = None) -> int:
        raise NotImplementedError


class IDebtRepayHook:
    """債券償還など非収入の入金時に借金・延滞貸付へ全額充当する契約。"""

    def repay_all_of_for(self, guild_id: int, user_id: int, amount: int, label: str) -> int:
        raise NotImplementedError


class IBankIncomeSink:
    """帝愛銀行の現金・配当分配・利子源泉・胴元ピンハネ受け入れ契約。"""

    def bank_sync_for(self, guild_id: int, now: float) -> dict[str, float]:
        raise NotImplementedError

    def bank_set_for(self, guild_id: int, cash: float, loaned: float) -> None:
        raise NotImplementedError

    def bank_locks_for(self, guild_id: int, now: float) -> float:
        raise NotImplementedError

    def bank_income_for(
        self,
        guild_id: int,
        amount: int,
        share: float,
        now: Optional[float] = None,
        needs_depositors: bool = False,
    ) -> None:
        raise NotImplementedError

    def bank_pay_for(self, guild_id: int, amount: int, now: Optional[float] = None) -> int:
        raise NotImplementedError

    def house_income_for(self, guild_id: int, amount: int) -> None:
        raise NotImplementedError

    def charge_gains_tax_for(self, guild_id: int, user_id: int, profit: int, taxable: bool, what: str) -> int:
        raise NotImplementedError


class IGraceReader:
    """破産猶予の終了時刻を参照する読み取り契約。"""

    def grace_until_for(self, guild_id: int, user_id: int) -> Optional[float]:
        return None


class IGraceEnterHook:
    """破産猶予入り時に連動して実行するフック契約（例: P2P出品引き戻し）。"""

    def on_grace_enter(self, guild_id: int, user_id: int, now: float) -> None:
        return None


class IBankruptExecutor:
    """猶予期限切れなどから強制破産を実行する契約。"""

    def bankrupt_for(self, guild_id: int, user_id: int, forced: bool = False, escape: bool = False) -> tuple[Any, ...]:
        raise NotImplementedError


class IMarginRatioReader:
    """対象ユーザーの信用取引維持率を参照する契約。"""

    def margin_ratio_for(self, guild_id: int, user_id: int) -> Optional[float]:
        return None


class IMarginCollateralGuard:
    """現物株・債券を売るときに信用取引の維持率低下を防ぐガード契約。"""

    def check_spot_sell(
        self, guild_id: int, user_id: int, symbol: str, units: Optional[int], have: int, price: float
    ) -> Optional["Failure"]:
        return None

    def check_bond_cancel(self, guild_id: int, user_id: int, kind: str, principal: int) -> Optional["Failure"]:
        return None


class IWealthyReader:
    """サーバ内の富豪ユーザーID集合を取得する契約。"""

    def wealthy_ids_for(self, guild_id: int) -> set[int]:
        return set()


class IValuationSource:
    """ランキング純資産に合算する 1 種類の資産評価額ソース（Composite 対象）。"""

    def collect_values(self, guild_id: int, totals: dict[int, int]) -> None:
        raise NotImplementedError


class CompositeValuationSource(IValuationSource):
    """複数の IValuationSource を束ねて純資産ランキング評価額を集計する Composite。"""

    def __init__(self, sources: tuple[IValuationSource, ...]) -> None:
        self._sources = sources

    def collect_values(self, guild_id: int, totals: dict[int, int]) -> None:
        for source in self._sources:
            source.collect_values(guild_id, totals)


class IAssetCollector:
    """1 つの資産カテゴリを内訳辞書へ加算するコレクタ契約（OCP / Composite）。"""

    def collect(self, guild_id: int, add: AddAssetPart, now: float) -> None:
        raise NotImplementedError


class CompositeAssetCollector(IAssetCollector):
    """複数の IAssetCollector を束ねて順次適用する Composite。"""

    def __init__(self, collectors: tuple[IAssetCollector, ...]) -> None:
        self._collectors = collectors

    def collect(self, guild_id: int, add: AddAssetPart, now: float) -> None:
        for collector in self._collectors:
            collector.collect(guild_id, add, now)


class IAssetSeizureStep:
    """借金返済不足時の強制執行（ファーストロス差し押さえ）の 1 ステップ（OCP）。"""

    def seize(self, guild_id: int, user_id: int, need: int, reason: str, now: float) -> int:
        raise NotImplementedError


class ILiquidationStep:
    """自己破産時の保有金融資産の換金（口座現金への回収）の 1 ステップ（OCP）。"""

    def liquidate(self, guild_id: int, user_id: int, now: float) -> None:
        raise NotImplementedError


class ISeizureValueStep:
    """自己破産時の現物・馬などの競売出品と査定額算出の 1 ステップ（OCP）。"""

    def seize(self, guild_id: int, user_id: int, now: float) -> int:
        raise NotImplementedError


class IBankruptPrepHook:
    """自己破産前の資産引き戻しフック（例: P2P出品・入札の引き戻し）。"""

    def prepare(self, guild_id: int, user_id: int, now: float) -> None:
        return None


class IOverdueLoanCollector:
    """収入・償還からの天引き時に延滞中の貸付（ジュニア債権）を回収する契約。"""

    def collect_overdue_for(self, guild_id: int, user_id: int, budget: int) -> int:
        return 0

    def loan_remaining(self, loan: dict[str, Any], now: float) -> int:
        return 0


class ISpotCollateralReader:
    """信用取引の代用有価証券（現物株）読み取り契約。"""

    def holdings_for(self, guild_id: int, user_id: int) -> list[tuple[str, int, int]]:
        return []

    def crypto_sell_locked_for(
        self,
        guild_id: int,
        user_id: int,
        units: Optional[int],
        price: float,
        symbol: str,
        taxable: bool = False,
    ) -> "CryptoResult":
        raise NotImplementedError
