"""SQLite 接続・再入可能トランザクション・サーバー単位スコープ共通基盤。

abc.ABC や 28-Mixin の巨大基底クラスを持たず、すべてのリポジトリが独立して
1 つの EcoDb（接続・ロック・通知ストア・トランザクション）をコンポジションで共有する。
"""

import copy
import os
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import TYPE_CHECKING, Self

if TYPE_CHECKING:
    from domain.errors import Notice


class EcoDb:
    """1 つの SQLite データベースに対して共有される接続・ロック・再入可能トランザクション・一時通知ストア。"""

    def __init__(self, db_path: str) -> None:
        db_dir = os.path.dirname(db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        self.db_path = db_path
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.notices: dict[tuple[int, int], list["Notice"]] = {}
        self._tx_depth = 0

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """ロック付き再入可能トランザクション。最外層のみで COMMIT / ROLLBACK する。"""
        with self.lock:
            is_outer = self._tx_depth == 0
            self._tx_depth += 1
            try:
                if is_outer:
                    with self.conn:
                        yield self.conn
                else:
                    yield self.conn
            finally:
                self._tx_depth -= 1

    def close(self) -> None:
        with self.lock:
            self.conn.close()


def validate_guild_id(guild_id: int) -> int:
    gid = int(guild_id)
    if gid <= 0:
        raise ValueError(f"サーバーIDが不正です: {guild_id!r}")
    return gid


class ScopedRepo:
    """EcoDb とサーバーID（guild_id）に紐づくリポジトリ共通基底（コンポジション用）。"""

    def __init__(self, db: EcoDb, guild_id: int = 0, strict: bool = False) -> None:
        self._db = db
        self._db_path = db.db_path
        self._conn = db.conn
        self._lock = db.lock
        self._notices = db.notices
        self.guild_id = guild_id
        self._strict = strict

    def for_guild(self, guild_id: int) -> Self:
        """指定サーバーIDにスコープされた同一接続共有ビューを返す。"""
        view = copy.copy(self)
        view.guild_id = validate_guild_id(guild_id)
        view._strict = False
        return view

    def _g(self) -> int:
        if self._strict and self.guild_id == 0:
            raise RuntimeError("サーバーが指定されていません。for_guild(サーバーID) を通して使ってください。")
        return self.guild_id
