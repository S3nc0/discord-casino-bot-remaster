"""証券・債券・オプション市場のアプリケーションサービス（価格進行・集計・スナップショット）。"""

from typing import Any, Optional

from domain import bonds, earnings, market, market_events
from domain import options as opt
from domain.options import name_of
from domain.ports.clock import IClock
from domain.ports.repos import (
    IBondRepo,
    ICryptoRepo,
    IEarningsRepo,
    IMarginRepo,
    IMarketDataRepo,
    IMarketEventRepo,
    IOptionRepo,
)


class MarketService:
    """市場価格の進行・ボラティリティ/決算更新・保有スナップショットを提供する。"""

    def __init__(
        self,
        market_data: IMarketDataRepo,
        market_events_repo: IMarketEventRepo,
        earnings_repo: IEarningsRepo,
        crypto: ICryptoRepo,
        margin: IMarginRepo,
        bonds_repo: IBondRepo,
        options_repo: IOptionRepo,
        clock: IClock,
    ) -> None:
        self._market = market_data
        self._market_events = market_events_repo
        self._earnings = earnings_repo
        self._crypto = crypto
        self._margin = margin
        self._bonds = bonds_repo
        self._options = options_repo
        self.clock = clock

    def latest_price(self, symbol: str = market.DEFAULT) -> float:
        latest = self._market.market_latest(symbol)
        if latest is None:
            start = market.BY_KEY[symbol].start
            self._market.market_set(self.clock.now_ts(), start, 0, symbol)
            return start
        return latest[1]

    def latest_prices(self) -> dict[str, float]:
        return {s.key: self.latest_price(s.key) for s in market.SYMBOLS}

    def day_reference(self, now: float) -> dict[str, float]:
        """値幅制限の基準になる約24時間前の価格 {銘柄: 価格}。"""
        out: dict[str, float] = {}
        for sym in market.SYMBOLS:
            hist = self._market.market_history(now - 86400, sym.key)
            if hist:
                out[sym.key] = hist[0][1]
        return out

    def step_prices(self, earnings_results: list[Any], rng: Any) -> tuple[dict[str, float], int]:
        """全銘柄の価格を1ステップ進め、(新価格辞書, 有事フラグ) を返す。"""
        current = self.latest_prices()
        fair = {k: self._market.market_fair_get(k) or p for k, p in current.items()}
        last_ts = max((self._market.market_latest(k) or (0,))[0] for k in current)
        now = self.clock.now_ts()
        announced = self._market_events.event_step(now, rng)
        if announced is not None:
            print(
                f"ボラティリティ予告: {announced['symbol']} {market_events.LEAD_MIN}分後から{market_events.DURATION_MIN}分"
            )
        self._earnings.earnings_ensure(now, self.clock.offset_hours())
        new_fair, event = market.next_prices(fair, rng, self._market_events.vol_multipliers(now))
        for r in self._earnings.earnings_release_due(now):
            hit = new_fair[r["symbol"]] * earnings.factor(r["direction"], r["size"])
            new_fair[r["symbol"]] = min(market.MAX_PRICE, max(market.MIN_PRICE, round(hit, 2)))
            earnings_results.append(r)
        ref = self.day_reference(now)
        new = {k: round(v, 2) for k, v in market.limit_to_day(new_fair, ref).items()}
        pins = market.pin_states(new_fair, ref)
        ts = max(self.clock.now_ts(), last_ts + 0.001)
        for key, p in new.items():
            self._market.market_set(ts, p, event, key)
            self._market.market_fair_set(key, new_fair[key], pins.get(key, 0), ts)
        return new, event

    def histories(self, minutes: int, now: Optional[float] = None) -> dict[str, list[Any]]:
        now = self.clock.now_ts() if now is None else now
        since = now - minutes * 60
        return {s.key: self._market.market_history(since, s.key) for s in market.SYMBOLS}

    def positions(self, guild_id: int, uid: int) -> list[tuple[str, str]]:
        """決済可能な持ち物 [(コード, 表示ラベル), ...]。"""
        crypto_g = self._crypto.for_guild(guild_id)
        margin_g = self._margin.for_guild(guild_id)
        options_g = self._options.for_guild(guild_id)
        bonds_g = self._bonds.for_guild(guild_id)
        out: list[tuple[str, str]] = []
        for symbol, _units, _cost in crypto_g.holdings(uid):
            out.append((f"spot:{symbol}", f"{market.BY_KEY[symbol].emoji} {market.BY_KEY[symbol].name} 全売却"))
        for side, symbol, *_ in margin_g.margin_positions(uid):
            name = market.BY_KEY[symbol]
            out.append((f"{side}:{symbol}", f"{name.emoji} {name.name} {market.SIDE_NAME[side]}全決済"))
        for r in options_g.option_list(uid)["active"]:
            short = r["side"] == "short"
            icon = "🎰" if short else opt.KINDS[r["kind"]][1]
            out.append((f"opt:{r['id']}", f"{icon} {name_of(r)} #{r['id']} {'買い戻し' if short else '売却'}"))
        for r in bonds_g.bond_list(uid)["active"]:
            k = bonds.KINDS[r["kind"]]
            if k.sellable:
                out.append((f"bond:{r['id']}", f"{k.emoji} {k.name} #{r['id']} 売却"))
        return out

    def holdings_snapshot(self, guild_id: int, uid: int, rng: Any) -> dict[str, Any]:
        """保有画面表示用に満期債券・オプションを決済したうえで全保有スナップショットを返す。"""
        now = self.clock.now_ts()
        crypto_g = self._crypto.for_guild(guild_id)
        margin_g = self._margin.for_guild(guild_id)
        bonds_g = self._bonds.for_guild(guild_id)
        options_g = self._options.for_guild(guild_id)
        bonds_g.bond_settle(now, rng)
        options_g.option_settle(now)
        prices = self.latest_prices()
        options = options_g.option_list(uid)
        spots = {symbol: (units, cost) for symbol, units, cost in crypto_g.holdings(uid)}
        margins = {
            (side, symbol): (units, entry, margin)
            for side, symbol, units, entry, margin in margin_g.margin_positions(uid)
        }
        bond_data = bonds_g.bond_list(uid)
        option_quotes = {
            r["id"]: (
                options_g.option_close_cost(r, now, prices)
                if r["side"] == "short"
                else options_g.option_value(r, now, prices)
            )
            for r in options["active"]
        }
        bond_quotes = {
            r["id"]: bonds_g.bond_price(r, now) for r in bond_data["active"] if bonds.KINDS[r["kind"]].sellable
        }
        margin_status = margin_g.margin_status(uid, prices) if margins else None
        return {
            "prices": prices,
            "spots": spots,
            "margins": margins,
            "options": options,
            "bond_data": bond_data,
            "option_quotes": option_quotes,
            "bond_quotes": bond_quotes,
            "margin_status": margin_status,
        }
