"""ユーザー向け一時通知キュー（NoticeRepo）。"""

from typing import Any

from domain.errors import Notice, notice
from domain.ports.repos import INoticeRepo
from infra import catalogs
from infra.db.base import EcoDb, ScopedRepo

MAX_NOTICES = catalogs.economy().wallet.max_notices  # たまっている一言の上限（古いものから捨てる）


class NoticeRepo(ScopedRepo, INoticeRepo):
    """精算・強制執行・P2P などの結果通知を一時保持し、UI 側へ引き渡す。"""

    def __init__(self, db: EcoDb, guild_id: int = 0, strict: bool = False) -> None:
        super().__init__(db, guild_id, strict)

    def note_for(self, guild_id: int, user_id: int, code: str, **params: Any) -> None:
        notes = self._notices.setdefault((guild_id, user_id), [])
        notes.append(notice(code, **params))
        del notes[:-MAX_NOTICES]  # 本人が遊ばないまままたまり続けないよう、新しい数件だけ残す

    def _note(self, user_id: int, code: str, **params: Any) -> None:
        self.note_for(self._g(), user_id, code, **params)

    def take_notices(self, user_id: int) -> list[Notice]:
        """たまっている一言を取り出す（取り出すと空になる）。"""
        return self._notices.pop((self._g(), user_id), [])
