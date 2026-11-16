"""Cog 拡張モジュールの一覧管理とロード（main.py とテストで単一正本を共有）。

各 Cog は起動時に `BotBridges` へ自身のブリッジ契約を登録し、利用側は呼び出し時に解決する
（ロード順に依存しない構成）。
"""

import traceback

from discord.ext import commands

COG_MODULES: tuple[str, ...] = (
    "cogs.p2p.cog",
    "cogs.shop.cog",
    "cogs.arena.cog",
    "cogs.casino.cog",
    "cogs.economy.cog",
    "cogs.event.cog",
    "cogs.help.cog",
    "cogs.horse.cog",
    "cogs.labor.cog",
    "cogs.loan.cog",
    "cogs.market.bond_cog",
    "cogs.market.cog",
    "cogs.quiz.cog",
    "cogs.raffle.cog",
    "cogs.weekly.cog",
    "cogs.admin.cog",
)


async def load_all_cogs(bot: commands.Bot) -> list[str]:
    """定義済みのすべての Cog を読み込み、失敗したモジュール名のリストを返す。"""
    failed: list[str] = []
    for module in COG_MODULES:
        try:
            await bot.load_extension(module)
            print(f"✓ ロード: {module}")
        except Exception:
            print(f"✗ 失敗: {module}")
            traceback.print_exc()
            failed.append(module)
    return failed
