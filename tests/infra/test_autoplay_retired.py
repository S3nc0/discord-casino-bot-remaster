"""廃止した自動プレイ: 預け中の分は、起動時に残高へ戻って表が消える。"""

import sqlite3

import pytest

from domain.types import INITIAL_BALANCE
from infra.db.repositories import open_repositories


@pytest.mark.real_scope
def test_leftover_pots_are_refunded_and_the_table_is_dropped(tmp_path):
    path = str(tmp_path / "t.db")
    repos = open_repositories(path)
    repos.for_guild(5).wallet.balance(7)
    repos.db.conn.commit()
    repos.close()
    c = sqlite3.connect(path)
    c.executescript("""CREATE TABLE autoplay (guild_id INTEGER, user_id INTEGER, pot INTEGER);
        INSERT INTO autoplay VALUES (5, 7, 1150), (5, 8, 0);""")
    c.commit()
    c.close()
    again = open_repositories(path)  # bot を再起動した想定
    assert again.for_guild(5).wallet.balance(7) == INITIAL_BALANCE + 1150
    names = {r[0] for r in again.db.conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "autoplay" not in names
    assert open_repositories(path).for_guild(5).wallet.balance(7) == INITIAL_BALANCE + 1150  # 二重に戻らない
