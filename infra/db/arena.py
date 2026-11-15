"""地下闘技場（NPC戦士どうしの賭け対戦）の永続化（Economy に混ぜ込む部品）。数字と決まりは domain/arena.py、表は infra/db/schema/tables.py の arena_*。"""

import datetime
import random
import time
from typing import Optional

from domain import arena as arena_mod
from domain.errors import fail
from infra.db.base import EcoBase


class ArenaMixin(EcoBase):
    """地下闘技場：1日1回の大会の生成・賭け・精算。"""

    def _arena_today(self, now: float, tz_hours: float = 9.0) -> str:
        tz = datetime.timezone(datetime.timedelta(hours=tz_hours))
        return datetime.datetime.fromtimestamp(now, tz).date().isoformat()

    def arena_tournament_ensure(
        self, now: Optional[float] = None, tz_hours: float = 9.0, rng: Optional[random.Random] = None
    ) -> dict:
        """今日の大会を用意する（無ければ作る）。すでにあれば、そのまま返す。"""
        now = time.time() if now is None else now
        rng = rng or random.SystemRandom()
        day = self._arena_today(now, tz_hours)
        with self._lock, self._conn:
            row = self._conn.execute(
                "SELECT id FROM arena_tournaments WHERE guild_id=? AND day=?", (self._g(), day)
            ).fetchone()
            if row is None:
                fmt = arena_mod.format_today(day)
                cur = self._conn.execute(
                    "INSERT INTO arena_tournaments (guild_id, day, format, status, created) "
                    "VALUES (?, ?, ?, 'semi_betting', ?)",
                    (self._g(), day, fmt, now),
                )
                tid = cur.lastrowid
                assert tid is not None
                fighters = arena_mod.generate_fighters(fmt, rng)
                half = len(fighters) // 2
                for i, f in enumerate(fighters):
                    self._conn.execute(
                        "INSERT INTO arena_fighters (tournament_id, name, base_power, group_no, stage) "
                        "VALUES (?, ?, ?, ?, 'semi')",
                        (tid, f["name"], f["base_power"], 1 if i < half else 2),
                    )
                self._arena_seed_spectators(tid, now, rng)
            result = self.arena_tournament_get_by_day(day)
            assert result is not None
            return result

    def arena_tournament_get_by_day(self, day: str) -> Optional[dict]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM arena_tournaments WHERE guild_id=? AND day=?", (self._g(), day)
            ).fetchone()
            if row is None:
                return None
            t = dict(row)
            t["fighters"] = self.arena_fighters(t["id"])
            return t

    def arena_fighters(self, tournament_id: int) -> list:
        with self._lock:
            return [
                dict(r)
                for r in self._conn.execute(
                    "SELECT * FROM arena_fighters WHERE tournament_id=? ORDER BY id", (tournament_id,)
                )
            ]

    def _arena_seed_spectators(self, tournament_id: int, now: float, rng: random.Random) -> None:
        """観客（プレイヤー以外）の初期ランダム賭けを仕込む。帝愛の手元現金から、上限つきで補う。"""
        state = self._bank_sync(now)
        topup_left = min(arena_mod.HOUSE_TOPUP_MAX, int(state["cash"]))
        spent = 0
        for f in self.arena_fighters(tournament_id):
            for _ in range(rng.randint(*arena_mod.SPECTATOR_COUNT)):
                amt = arena_mod.initial_spectator_bets(rng)
                if spent + amt > topup_left:
                    continue
                spent += amt
                self._conn.execute(
                    "INSERT INTO arena_bets (tournament_id, stage, fighter_id, user_id, amount, created) "
                    "VALUES (?, 'semi', ?, ?, ?, ?)",
                    (tournament_id, f["id"], arena_mod.NPC_SPECTATOR, amt, now),
                )
                self._conn.execute("UPDATE arena_fighters SET bet_total = bet_total + ? WHERE id=?", (amt, f["id"]))
        if spent:
            self._bank_set(state["cash"] - spent, state["loaned"])

    def arena_bet(self, user_id: int, fighter_id: int, amount: int, now: Optional[float] = None) -> tuple:
        """戦士に賭ける。(成功か, Failure か空文字)。"""
        now = time.time() if now is None else now
        if amount < arena_mod.MIN_STAKE or amount > arena_mod.MAX_STAKE:
            return False, fail("arena_stake_range", lo=arena_mod.MIN_STAKE, hi=arena_mod.MAX_STAKE)
        with self._lock, self._conn:
            self._ensure(user_id)
            fighter = self._conn.execute("SELECT * FROM arena_fighters WHERE id=?", (fighter_id,)).fetchone()
            if fighter is None:
                return False, fail("arena_fighter_not_found")
            tournament = self._conn.execute(
                "SELECT * FROM arena_tournaments WHERE id=?", (fighter["tournament_id"],)
            ).fetchone()
            if tournament is None or tournament["guild_id"] != self._g():
                return False, fail("arena_fighter_not_found")
            if fighter["stage"] == "out":
                return False, fail("arena_fighter_eliminated")
            open_status = "semi_betting" if fighter["stage"] == "semi" else "final_betting"
            if tournament["status"] != open_status:
                return False, fail("arena_bet_closed")
            if self._balance(user_id) < amount:
                return False, fail("insufficient_balance", balance=self._balance(user_id))
            self._apply(user_id, -amount, f"闘技場:{fighter['name']}に賭け")
            self._conn.execute(
                "INSERT INTO arena_bets (tournament_id, stage, fighter_id, user_id, amount, created) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (tournament["id"], fighter["stage"], fighter_id, user_id, amount, now),
            )
            self._conn.execute("UPDATE arena_fighters SET bet_total = bet_total + ? WHERE id=?", (amount, fighter_id))
            return True, ""

    def _arena_settle_group(self, tournament_id: int, stage: str, winner: dict, losers: list) -> None:
        """1試合ぶんを精算する。敗者側の賭け（観客ぶんも含む）が、勝者側のプレイヤーの配当の原資になる。"""
        loser_ids = [f["id"] for f in losers]
        losers_pool = 0
        if loser_ids:
            placeholders = ",".join("?" * len(loser_ids))
            losers_pool = (
                self._conn.execute(
                    f"SELECT COALESCE(SUM(amount),0) FROM arena_bets WHERE tournament_id=? AND stage=? "
                    f"AND fighter_id IN ({placeholders})",
                    (tournament_id, stage, *loser_ids),
                ).fetchone()[0]
                or 0
            )
            self._conn.execute(
                f"UPDATE arena_bets SET settled=1 WHERE tournament_id=? AND stage=? AND fighter_id IN ({placeholders})",
                (tournament_id, stage, *loser_ids),
            )
            self._conn.execute(
                f"UPDATE arena_fighters SET stage='out', result='lost' WHERE id IN ({placeholders})", loser_ids
            )
        rate = arena_mod.payout_rate(len(losers) + 1)
        win_bets = self._conn.execute(
            "SELECT * FROM arena_bets WHERE tournament_id=? AND stage=? AND fighter_id=? AND settled=0",
            (tournament_id, stage, winner["id"]),
        ).fetchall()
        player_due = sum(round(b["amount"] * rate) for b in win_bets if b["user_id"] > 0)
        scale = arena_mod.payout_scale(losers_pool, player_due)
        for b in win_bets:
            pay = round(b["amount"] * rate * scale) if b["user_id"] > 0 else 0
            if pay:
                self._apply(b["user_id"], pay, "闘技場:勝利の配当", income=max(0, pay - b["amount"]))
            self._conn.execute("UPDATE arena_bets SET payout=?, settled=1 WHERE id=?", (pay, b["id"]))
        self._conn.execute("UPDATE arena_fighters SET result='won' WHERE id=?", (winner["id"],))

    def arena_run_semis(self, tournament_id: int, rng: Optional[random.Random] = None) -> Optional[dict]:
        """2組の準決勝を同時に決着させ、決勝へ進む2人を決める。"""
        rng = rng or random.SystemRandom()
        with self._lock, self._conn:
            t = self._conn.execute("SELECT * FROM arena_tournaments WHERE id=?", (tournament_id,)).fetchone()
            if t is None or t["status"] != "semi_betting":
                return None
            fighters = self.arena_fighters(tournament_id)
            finalists = []
            groups = {}
            for group_no in (1, 2):
                group = [f for f in fighters if f["group_no"] == group_no]
                bet_totals = {f["name"]: f["bet_total"] for f in group}
                win_idx = arena_mod.simulate_match(group, bet_totals, rng)
                winner, losers = group[win_idx], [f for i, f in enumerate(group) if i != win_idx]
                self._arena_settle_group(tournament_id, "semi", winner, losers)
                finalists.append(winner)
                groups[group_no] = {"winner": winner["name"], "losers": [f["name"] for f in losers]}
            for w in finalists:
                self._conn.execute("UPDATE arena_fighters SET stage='final', result=NULL WHERE id=?", (w["id"],))
            self._conn.execute("UPDATE arena_tournaments SET status='final_betting' WHERE id=?", (tournament_id,))
            return {"groups": groups, "finalists": [w["name"] for w in finalists]}

    def arena_run_final(self, tournament_id: int, rng: Optional[random.Random] = None) -> Optional[dict]:
        """決勝を決着させ、優勝者を決める。"""
        rng = rng or random.SystemRandom()
        with self._lock, self._conn:
            t = self._conn.execute("SELECT * FROM arena_tournaments WHERE id=?", (tournament_id,)).fetchone()
            if t is None or t["status"] != "final_betting":
                return None
            finalists = [f for f in self.arena_fighters(tournament_id) if f["stage"] == "final"]
            if len(finalists) != 2:
                return None
            bet_totals = {f["name"]: f["bet_total"] for f in finalists}
            win_idx = arena_mod.simulate_match(finalists, bet_totals, rng)
            champion, runner_up = finalists[win_idx], finalists[1 - win_idx]
            self._arena_settle_group(tournament_id, "final", champion, [runner_up])
            self._conn.execute("UPDATE arena_tournaments SET status='done' WHERE id=?", (tournament_id,))
            return {"champion": champion["name"], "runner_up": runner_up["name"]}

    def arena_my_bets(self, tournament_id: int, user_id: int) -> list:
        with self._lock:
            return [
                dict(r)
                for r in self._conn.execute(
                    "SELECT b.*, f.name AS fighter_name FROM arena_bets b JOIN arena_fighters f ON f.id=b.fighter_id "
                    "WHERE b.tournament_id=? AND b.user_id=? ORDER BY b.id",
                    (tournament_id, user_id),
                )
            ]

    def arena_bets_breakdown(self, tournament_id: int) -> dict:
        """戦士ごとの、誰がいくら賭けているか（大会を通じた累積）。{戦士ID: [{user_id, amount}]}（金額の多い順）。"""
        with self._lock:
            rows = self._conn.execute(
                "SELECT fighter_id, user_id, SUM(amount) AS amount FROM arena_bets WHERE tournament_id=? "
                "GROUP BY fighter_id, user_id ORDER BY fighter_id, amount DESC",
                (tournament_id,),
            ).fetchall()
        out: dict[int, list] = {}
        for r in rows:
            out.setdefault(r["fighter_id"], []).append({"user_id": r["user_id"], "amount": r["amount"]})
        return out
