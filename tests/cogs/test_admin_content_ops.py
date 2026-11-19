"""運営のコンテンツ操作(cogs/admin/content_ops.py)の、コマンド経路の回帰テスト。"""

import asyncio
from types import SimpleNamespace

from cogs.admin import content_ops

GID = 123456789012345678


class Interaction:
    def __init__(self):
        self.sent = []
        self.response = SimpleNamespace(send_message=self._send)

    async def _send(self, *a, **kw):
        self.sent.append(kw)


def test_host_arena_command_path_picks_guild_and_hosts(monkeypatch):
    """#61: 以前は ApprovalCog に無い _pick_guild を呼んで AttributeError になっていた。"""
    guild = SimpleNamespace(id=GID, name="テスト鯖")
    bot = SimpleNamespace(get_guild=lambda gid: guild if gid == GID else None)
    hosted = []

    class Bridge:
        async def host_now(self, g, channel, advance, fmt):
            hosted.append((g, channel, advance, fmt))
            return "予選受付中"

    async def fake_require_bridge(interaction, b, iface, label, *rest):
        return Bridge()

    monkeypatch.setattr(content_ops, "require_bridge", fake_require_bridge)
    inter = Interaction()
    cog = SimpleNamespace(bot=bot)
    asyncio.run(content_ops.host_arena(cog, inter, str(GID), True, "duel", None))  # type: ignore[arg-type]
    assert hosted == [(guild, None, True, "duel")]
    assert "闘技場を開催しました" in inter.sent[0]["embed"].title


def test_host_arena_unknown_guild_replies_and_stops(monkeypatch):
    bot = SimpleNamespace(get_guild=lambda gid: None)

    async def must_not_be_called(*a, **kw):
        raise AssertionError("サーバーが無いのに闘技場を探した")

    monkeypatch.setattr(content_ops, "require_bridge", must_not_be_called)
    inter = Interaction()
    asyncio.run(content_ops.host_arena(SimpleNamespace(bot=bot), inter, str(GID), False, None, None))  # type: ignore[arg-type]
    assert len(inter.sent) == 1
