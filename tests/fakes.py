"""discord の型を受け取る関数へ、テスト用のフェイクを渡すための境界。

テストのフェイク（SimpleNamespace や小さなクラス）は、discord の型を名前のうえで継承していない。
そのまま渡すと Pyright が型の不一致として報告するため、型の検査はここで明示的に切り、
テスト本体ではフェイクの属性（送ったメッセージなど）を型付きのまま読めるようにする。
"""

from collections.abc import Callable, Coroutine
from typing import Any, cast

import discord
from discord import app_commands
from discord.ext import commands

Coro = Coroutine[Any, Any, Any]


def invoke(command: "app_commands.Command[Any, ..., Any] | discord.ui.Item[Any]", *args: object) -> Coro:
    """スラッシュコマンド・ボタンの callback を、フェイクの引数で呼ぶ。"""
    callback: Callable[..., Coro] = command.callback
    return callback(*as_interaction(args))


def as_interaction(fake: object) -> "discord.Interaction[Any]":
    return cast("discord.Interaction[Any]", fake)


def as_guild(fake: object) -> discord.Guild:
    return cast(discord.Guild, fake)


def as_member(fake: object) -> discord.Member:
    return cast(discord.Member, fake)


def as_user(fake: object) -> discord.User:
    return cast(discord.User, fake)


def as_channel(fake: object) -> discord.TextChannel:
    return cast(discord.TextChannel, fake)


def as_message(fake: object) -> discord.Message:
    return cast(discord.Message, fake)


def as_choice(fake: object) -> "app_commands.Choice[Any]":
    return cast("app_commands.Choice[Any]", fake)


def as_bot(fake: object) -> commands.Bot:
    return cast(commands.Bot, fake)
