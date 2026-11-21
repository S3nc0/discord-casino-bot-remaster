"""ギルドスコープ付き永続化ポートの共通基底契約。"""

from typing import Self


class IGuildScopedRepo:
    """サーバー（guild_id）単位のビューを切り出す共通契約。"""

    def for_guild(self, guild_id: int) -> Self:
        raise NotImplementedError
