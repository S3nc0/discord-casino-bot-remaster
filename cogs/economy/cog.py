"""/ペリカ — 残高・デイリー・ランキング・送金・履歴。"""

import datetime
import math
from typing import TYPE_CHECKING, Any, Optional

import discord
from discord import app_commands
from discord.ext import commands, tasks

from cogs.economy import boards
from cogs.economy.boards import RankingView as RankingView  # noqa: F401
from cogs.shared import ranking, ui
from cogs.shared.amount import balance_choices
from cogs.shared.bridges import DeferredShopTitleBridge, IShopTitleBridge
from cogs.shared.confirm import confirm_action, confirmed_reply, user_session
from cogs.shared.messages import format_failure, format_history, format_memo
from cogs.shared.ranking import RankingRepos
from cogs.teiai.panel import TeiaiPanel, panel_embed
from domain import approval, shop, teiai
from domain import missions as missions_mod
from domain.ports.clock import IClock
from domain.ports.repos import (
    IAssetRepo,
    IBankRepo,
    IBondRepo,
    ICryptoRepo,
    IDebtRepo,
    IGuildRepo,
    ILoanRepo,
    INoticeRepo,
    IRecordRepo,
    IShopRepo,
    IWalletRepo,
)
from domain.ports.session import ISessionGuard
from domain.types import DAILY_BASE, DAILY_STREAK_BONUS, DAILY_STREAK_CAP
from infra import catalogs
from services.economy import EconomyService

if TYPE_CHECKING:
    from cogs.shared.bot import CasinoBot

_ECON_CFG = catalogs.economy()
_TRANSFER_CFG = _ECON_CFG.transfer
TRANSFER_FEE_RATE = _TRANSFER_CFG.fee_rate  # 送る側が、送金額の10%を手数料として払う
TRANSFER_DAILY_LIMIT = _TRANSFER_CFG.daily_limit  # 1日に送れる合計（送る金額だけで数える。手数料は含まない）
TRANSFER_CONFIRM_FROM = _TRANSFER_CFG.confirm_from  # この額以上は確認ボタンを挟む
BOARD_INTERVAL_MINUTES = _TRANSFER_CFG.board_interval_minutes  # ランキング掲示板を更新する間隔
TRANSFER_MIN_GAMES = _TRANSFER_CFG.min_games  # 送金できるのは、ゲームで3回以上遊んだ人（複数アカウントで稼ぐのを防ぐ）


def tz_label(utc_offset: float) -> str:
    return "日本時間" if utc_offset == 9 else f"UTC{utc_offset:+g}"


def reset_label(utc_offset: float) -> str:
    """日付が切り替わる（デイリーやミッションがリセットされる）時刻の表示。"""
    return f"{tz_label(utc_offset)} 0:00" if utc_offset == 9 else f"{tz_label(utc_offset)} の 0:00"


DAILY_SLOT_HOURS = _ECON_CFG.wallet.daily_slot_hours  # デイリーボーナスを受け取れる間隔（0・6・12・18時に切り替わる）


def slot_of(now: datetime.datetime) -> int:
    """いまが、何番目の「受け取りの時間帯」か（6時間ごとに1つ進む）。"""
    return now.date().toordinal() * (24 // DAILY_SLOT_HOURS) + now.hour // DAILY_SLOT_HOURS


def next_slot(clock: IClock) -> datetime.datetime:
    """次にデイリーボーナスを受け取れる時刻。"""
    now = clock.now()
    start = datetime.datetime.combine(now.date(), datetime.time(), tzinfo=now.tzinfo)
    return start + datetime.timedelta(hours=(now.hour // DAILY_SLOT_HOURS + 1) * DAILY_SLOT_HOURS)


def next_slot_label(clock: IClock, utc_offset: float) -> str:
    t = next_slot(clock)
    return f"{t.hour}:00（{tz_label(utc_offset)}）"


def next_reset(clock: IClock) -> datetime.datetime:
    now = clock.now()
    return datetime.datetime.combine(now.date() + datetime.timedelta(days=1), datetime.time(), tzinfo=now.tzinfo)


def manage_guild_or_owner():
    """サーバー管理権限を持つ人、または Bot の持ち主（owner_ids）だけが使える。"""

    def predicate(interaction: discord.Interaction) -> bool:
        if interaction.user.id in approval.owner_ids(ui.bot_of(interaction).config):
            return True
        perms = interaction.permissions
        if perms.manage_guild:
            return True
        raise app_commands.MissingPermissions(["manage_guild"])

    return app_commands.check(predicate)


class EconomyCog(commands.Cog):
    def __init__(
        self,
        bot: commands.Bot,
        config: dict[str, Any],
        economy_svc: EconomyService,
        wallet: IWalletRepo,
        records: IRecordRepo,
        bank: IBankRepo,
        debt: IDebtRepo,
        loans: ILoanRepo,
        shop_repo: IShopRepo,
        notices: INoticeRepo,
        crypto: ICryptoRepo,
        bonds_repo: IBondRepo,
        assets: IAssetRepo,
        guild_repo: IGuildRepo,
        sessions: ISessionGuard,
        clock: IClock,
        *,
        shop_bridge: Optional[IShopTitleBridge] = None,
    ):
        self.bot = bot
        self._config = config
        self._economy_svc = economy_svc
        self._wallet = wallet
        self._records = records
        self._bank = bank
        self._debt = debt
        self._loans = loans
        self._shop = shop_repo
        self._notices = notices
        self._crypto = crypto
        self._bonds = bonds_repo
        self._assets = assets
        self._guild_repo = guild_repo
        self._sessions = sessions
        self._clock = clock
        self._shop_bridge: IShopTitleBridge = shop_bridge if shop_bridge is not None else DeferredShopTitleBridge(bot)
        self._ranking_repos = RankingRepos(
            wallet=wallet,
            crypto=crypto,
            bonds=bonds_repo,
            assets=assets,
        )

    group = app_commands.Group(name="ペリカ", description="💴 残高・デイリー・ランキング・送金")

    @group.command(name="残高", description="ペリカの残高と成績を表示")
    @app_commands.rename(member="対象")
    @app_commands.describe(member="見たい人（省略時: 自分）")
    async def balance(self, interaction: discord.Interaction, member: Optional[discord.Member] = None):
        target = member or interaction.user
        gid = ui.guild_id_of(interaction)
        wallet = self._wallet.for_guild(gid)
        shop_repo = self._shop.for_guild(gid)
        # 他の人を見るだけで、その人の口座（初期支給つき）が作られないよう、読み取り専用で調べる
        s = wallet.stats(target.id) if target.id == interaction.user.id else wallet.peek_stats(target.id)
        if s is None:
            return await interaction.response.send_message(
                embed=ui.embed(f"💴 {target.display_name} の残高", "まだ遊んでいません（口座がありません）。", ui.INFO)
            )
        rank = wallet.rank_of(target.id)
        # ショップで買ったカードの色・アイコン・称号を反映する
        prof = shop_repo.get_profile(target.id)  # カタギでないときは、装備が差し押さえ中で、空になって返る
        color_item, icon_item, title_item = (shop.BY_ID.get(prof[k]) for k in ("card_color", "card_icon", "title"))
        icon = icon_item.value if icon_item else "💴"
        title_line = f"## 🏷️ {title_item.name}\n" if title_item else ""
        e = ui.embed(
            f"{icon} {target.display_name} の残高",
            f"{title_line}# {ui.pelica(s['balance'])}",
            color_item.value if color_item and isinstance(color_item.value, int) else ui.GOLD,
        )
        e.set_thumbnail(url=target.display_avatar.url)
        e.add_field(name="身分", value=teiai.STATUS_LABEL[wallet.display_status(target.id)], inline=True)
        if s.get("debt"):
            e.add_field(
                name="帝愛への借金",
                value=f"{ui.pelica(s['debt'])}（収入の{int(teiai.REPAY_RATE * 100)}%が天引きで返済されます。`/ペリカ 返済` で自分から返せます）\n"
                f"⏳ 帝愛の利息（トイチ）: 1日ごとに借金の{teiai.DEBT_RATE_PER_DAY:.0%}が加わります（{teiai.DEBT_INTEREST_CEILING:,}ペリカまで）",
                inline=False,
            )
        if rank:
            e.add_field(name="このサーバーでの順位（純資産）", value=f"{rank[0]}位 / {rank[2]}人", inline=True)
        owned, collection_total = shop.collection_value(shop_repo.inventory(target.id))
        if (
            owned and prof["frozen"]
        ):  # 借金中・延滞中・破産者は、ショップの品が差し押さえ中（完済してカタギに戻ると返る）
            e.add_field(
                name=f"🏆 コレクション（資産価値 {ui.pelica(collection_total)}）",
                value="🔒 帝愛により差し押さえ中（借金を完済して、カタギに戻ると返されます）",
                inline=False,
            )
        elif owned:  # ショップのコレクション。持っているものが、絵文字で並ぶ
            e.add_field(
                name=f"🏆 コレクション（資産価値 {ui.pelica(collection_total)}）",
                value=" ".join(i.value for i in owned),
                inline=False,
            )
        raw = shop_repo.get_profile(target.id, raw=True)
        if prof["frozen"] and any(raw[slot] for slot in shop_repo.SLOTS):
            e.add_field(
                name="🔒 称号・カード・演出",
                value="差し押さえ中です（借金を完済して、カタギに戻ると使えます）",
                inline=False,
            )
        held = self._crypto.for_guild(gid).crypto_values().get(target.id, 0)
        if held:
            e.add_field(name="証券（現物）の評価額", value=ui.pelica(held), inline=True)
        bonds = self._bonds.for_guild(gid).bond_values().get(target.id, 0)
        if bonds:
            e.add_field(name="債券（預けている元本）", value=ui.pelica(bonds), inline=True)
        e.add_field(name="遊んだ回数", value=f"{s['games_played']:,}回", inline=True)
        e.add_field(name="最大の勝ち", value=ui.pelica(s["biggest_win"]), inline=True)
        e.add_field(
            name="連続ログイン",
            value=f"{s['daily_streak']}日" if s["daily_streak"] else "まだ受け取っていません",
            inline=True,
        )
        play = self._records.for_guild(gid).play_summary(target.id)
        if play["plays"]:
            e.add_field(
                name="勝率", value=f"{play['wins'] * 100 // play['plays']}%（{play['plays']:,}戦）", inline=True
            )
            e.add_field(name="ゲームの損益", value=f"{play['net_total']:+,}ペリカ", inline=True)
        if play["best_streak"] >= 2:
            e.add_field(name="最大連勝", value=f"{play['best_streak']}連勝", inline=True)
        e.set_footer(text="勝率・損益は、集計を始めてからのゲームの分です")
        await interaction.response.send_message(embed=e)

    @group.command(name="デイリー", description="6時間ごとにもらえる無料ボーナス")
    async def daily(self, interaction: discord.Interaction):
        now = self._clock.now()
        outcome = self._economy_svc.claim_daily(ui.guild_id_of(interaction), interaction.user.id, now, slot_of(now))
        result = outcome.result
        utc_offset = self._economy_svc.utc_offset()
        if not result.ok:
            return await interaction.response.send_message(
                embed=ui.warn_embed(
                    "まだ受け取れません",
                    f"次は **{next_slot_label(self._clock, utc_offset)}**（<t:{int(next_slot(self._clock).timestamp())}:R>）から受け取れます。\n"
                    f"ボーナスは6時間ごと（0・6・12・18時）です。\n連続ログイン: **{result.streak}日**",
                ),
                ephemeral=True,
            )
        next_bonus = DAILY_BASE + DAILY_STREAK_BONUS * min(result.streak, DAILY_STREAK_CAP)
        boost = "🎟️ デイリー2倍券を使った！\n" if result.boosted else ""
        if result.guarded:
            boost += f"🛡️ 連続守り券を **{result.guarded}枚** 使って、連続ログインをつないだ！\n"
        debt_line = ""
        if result.skimmed:
            debt_line += f"🕴️ 帝愛にピンハネされた: **{ui.pelica(result.skimmed)}**（借金は減りません）\n"
        if result.repaid:
            debt_line += f"💸 借金の返済に天引きされた: **{ui.pelica(result.repaid)}**\n"
        if result.seed:
            debt_line += f"🕴️ 帝愛が種銭を貸し付けた: **{ui.pelica(result.seed)}**（借金に加わります）\n"
        memo = outcome.memo
        await interaction.response.send_message(
            embed=ui.ok_embed(
                "デイリーボーナス",
                f"{boost}**+{ui.pelica(result.amount)}**\n{debt_line}連続ログイン: **{result.streak}日**（明日は {ui.pelica(next_bonus)}）\n残高: **{ui.pelica(result.balance)}**\n\n"
                f"🕛 次のボーナスは **{next_slot_label(self._clock, utc_offset)}**（<t:{int(next_slot(self._clock).timestamp())}:R>）から。6時間ごと（0・6・12・18時）に受け取れます。",
            )
        )
        if memo:  # 本人にだけ見える
            await interaction.followup.send(embed=ui.embed("🕴️ 黒服の噂話", format_memo(memo), ui.DARK), ephemeral=True)

    @group.command(name="返済", description="帝愛への借金を、手元のペリカから返す（金額を省くと、返せる限り全額）")
    @app_commands.rename(amount="金額")
    @app_commands.describe(amount="返す額（省略で全額）")
    async def repay(self, interaction: discord.Interaction, amount: Optional[app_commands.Range[int, 1]] = None):
        debt_repo = self._debt.for_guild(ui.guild_id_of(interaction))
        ok, result = debt_repo.repay_debt(interaction.user.id, amount)
        if not ok:
            return await interaction.response.send_message(
                embed=ui.error_embed("返せません", format_failure(result)), ephemeral=True
            )
        left = debt_repo.debt(interaction.user.id)
        text = f"帝愛に **{ui.pelica(result)}** 返しました。" + (
            f"\n残りの借金: **{ui.pelica(left)}**" if left else "\n**借金を完済しました！**"
        )
        await interaction.response.send_message(embed=ui.ok_embed("返済しました", text), ephemeral=True)

    @group.command(name="帝愛", description="帝愛銀行（預金・準備率）・破産猶予・CDS（破綻保証）・種銭の画面")
    async def teiai_panel(self, interaction: discord.Interaction):
        gid, uid = ui.guild_id_of(interaction), interaction.user.id
        await interaction.response.send_message(
            embed=panel_embed(
                self._bank.for_guild(gid),
                self._debt.for_guild(gid),
                self._wallet.for_guild(gid),
                uid,
            ),
            view=TeiaiPanel(
                self._bank,
                self._debt,
                self._wallet,
                self._notices,
                uid,
                shop_bridge=self._shop_bridge,
            ),
            ephemeral=True,
        )

    @group.command(
        name="破産",
        description="自己破産する（全財産とショップの全品を差し押さえ、貸付は免責・借金は圧縮。元に戻せない）",
    )
    async def bankrupt(self, interaction: discord.Interaction):
        gid, uid = ui.guild_id_of(interaction), interaction.user.id
        debt_repo = self._debt.for_guild(gid)
        loans_repo = self._loans.for_guild(gid)
        if debt_repo.status(uid) == teiai.BANKRUPT:
            return await interaction.response.send_message(
                embed=ui.error_embed(
                    "すでに破産者です",
                    "借金を完済すると、カタギに戻ります（貸付だけは、完済から7日、借りられません）。",
                ),
                ephemeral=True,
            )
        if debt_repo.debt(uid) <= 0 and not loans_repo.loan_list(uid)["borrowed"]:
            return await interaction.response.send_message(
                embed=ui.error_embed("破産できません", "借金も、貸付の借り入れもありません。"), ephemeral=True
            )
        warning = (
            "**全財産（現金・CSトークン・空売り・債券）と、ショップで買った全品（称号・カード・演出・コレクション・消耗品）を差し押さえ**、"
            f"換金（ショップの品は購入額の{int(teiai.SEIZE_RATE * 100)}%）して、帝愛 → 貸付（古い順）の順に配当します。\n"
            "・貸付の残りは**免責**（貸した人の損になります）\n"
            f"・帝愛の借金は、残っていても **{teiai.BANKRUPT_FLOOR:,}ペリカまで圧縮**\n"
            f"・身分が🔴**破産者**になり、**完済して{teiai.BLACKLIST_DAYS}日たつまで、貸付を借りられません**\n"
            "・**元に戻せません。**"
        )
        ok = await confirm_action(interaction, "自己破産しますか？", warning, "破産する")
        if ok is not True:
            return
        ok, result = debt_repo.bankrupt(uid)
        if not ok:
            return await interaction.followup.send(
                embed=ui.error_embed("破産できません", format_failure(result)), ephemeral=True
            )
        lines = [
            f"差し押さえた額: **{ui.pelica(result['seized'])}**（うちショップの品の換金 {ui.pelica(result['shop_value'])}）",
            f"帝愛への配当: **{ui.pelica(result['senior_paid'])}**",
            f"貸付への配当: **{ui.pelica(result['junior_paid'])}**（免責になった貸付の残り: {ui.pelica(result['forgiven'])}）",
            f"帝愛の借金: 圧縮のあと **{ui.pelica(result['debt'])}**",
        ]
        if result["seed"]:
            lines.append(f"🕴️ 帝愛が種銭 **{ui.pelica(result['seed'])}** を貸し付けました（借金に加わります）。")
        await interaction.followup.send(  # 公開（見せ場）。誰が破産したかも出す
            embed=ui.embed(f"🔴 {interaction.user.display_name} が自己破産しました", "\n".join(lines), ui.ERROR)
        )
        self._notices.for_guild(gid).take_notices(uid)
        guild = interaction.guild
        if guild is not None:
            member = guild.get_member(uid) or interaction.user
            if isinstance(member, discord.Member):
                await self._shop_bridge.after_bankruptcy(guild, member)  # 色ロールとニックネームを、すぐに反映する

    @group.command(name="ミッション", description="今日のミッションと進み具合を見る")
    async def missions(self, interaction: discord.Interaction):
        now = self._clock.now()
        records = self._records.for_guild(ui.guild_id_of(interaction))
        status = records.mission_status(interaction.user.id, now.date())
        lines = []
        for m, progress, done in status:
            bar = "🟩" * (10 * min(progress, m.target) // m.target) + "⬜" * (
                10 - 10 * min(progress, m.target) // m.target
            )
            mark = "✅" if done else "🔸"
            shown = m.target if done else progress
            lines.append(f"{mark} **{m.name}**　報酬 {ui.pelica(m.reward)}\n{bar} {shown:,} / {m.target:,}")
        tomorrow = next_reset(self._clock)
        streak, best = records.win_streak(interaction.user.id)
        lines.append(
            f"\n※ 賭け金 {ui.pelica(missions_mod.MIN_BET)} 以上のゲームだけが数えられます。連勝はその日の分だけです。"
        )
        lines.append(f"🎁 3つ全部で、さらに **+{ui.pelica(missions_mod.COMPLETE_BONUS)}**")
        lines.append(f"🔥 いまの連勝: **{streak}** ／ 自己ベスト: **{best}**")
        lines.append(
            f"🕛 次の更新: **{reset_label(self._economy_svc.utc_offset())}**（<t:{int(tomorrow.timestamp())}:R>）"
        )
        await interaction.response.send_message(
            embed=ui.embed("📜 今日のミッション", "\n".join(lines), ui.GOLD), ephemeral=True
        )

    @group.command(
        name="ランキング",
        description="このサーバーで、ペリカの多い順に並べる（総資産・資産の内訳も見られる）",
    )
    @app_commands.rename(member="内訳")
    @app_commands.describe(member="この人の資産の内訳を見る（省略でランキング）")
    async def ranking(self, interaction: discord.Interaction, member: Optional[discord.Member] = None):
        gid = ui.guild_id_of(interaction)
        if member is not None:
            e = ranking.build_breakdown_embed(self._ranking_repos.for_guild(gid), member.id, member.display_name)
            return await interaction.response.send_message(
                embed=e, ephemeral=True, allowed_mentions=discord.AllowedMentions.none()
            )
        view = RankingView(self._ranking_repos, interaction.user.id, gid)
        await interaction.response.send_message(
            embed=view.embed("normal"), view=view, allowed_mentions=discord.AllowedMentions.none()
        )

    # ------------------- 自動で更新されるランキング掲示板（boards.py へ委譲） ------------------- #
    def _board_embed(self, guild_id: int) -> discord.Embed:
        return boards.board_embed(self._ranking_repos, guild_id, BOARD_INTERVAL_MINUTES)

    async def _refresh_board(self, board: dict) -> None:
        await boards.refresh_board(self.bot, self._ranking_repos, self._guild_repo, board, BOARD_INTERVAL_MINUTES)

    async def cog_load(self):
        self.refresh_boards.start()

    async def cog_unload(self) -> None:
        self.refresh_boards.cancel()

    @tasks.loop(minutes=BOARD_INTERVAL_MINUTES)
    async def refresh_boards(self):
        for board in self._guild_repo.list_leaderboards():
            try:
                await self._refresh_board(board)
            except Exception as exc:  # 1つのサーバーの失敗で、他のサーバーの更新を止めない
                print(f"ランキング掲示板の更新に失敗: {board}: {exc!r}")

    @refresh_boards.before_loop
    async def _before_refresh(self):
        await self.bot.wait_until_ready()

    @commands.Cog.listener()
    async def on_guild_remove(self, guild: discord.Guild):
        self._guild_repo.delete_leaderboard(guild.id)

    async def _delete_board_message(self, guild: discord.Guild, board: Optional[dict]) -> None:
        await boards.delete_board_message(guild, board)

    @group.command(
        name="ランキング掲示", description="[管理者] ランキングを投稿して自動で更新する／止める（サーバー管理）"
    )
    @app_commands.rename(channel="チャンネル", stop="止める")
    @app_commands.describe(
        channel=f"ランキングを置くチャンネル（{BOARD_INTERVAL_MINUTES}分ごとに自動で更新。1サーバーに1つ）",
        stop="掲示を止めて、投稿を削除する（このときチャンネルは不要）",
    )
    @manage_guild_or_owner()
    async def board_set(
        self, interaction: discord.Interaction, channel: Optional[discord.TextChannel] = None, stop: bool = False
    ):
        await boards.board_set(
            self._ranking_repos, self._guild_repo, interaction, channel, stop, BOARD_INTERVAL_MINUTES
        )

    async def _board_unset(self, interaction: discord.Interaction):
        await boards.board_unset(self._guild_repo, interaction)

    async def _transfer_autocomplete(self, interaction: discord.Interaction, current: str):
        """送る金額の欄に、残高を見せる。"""
        return balance_choices(self._wallet, interaction, current, 1, 1_000_000)

    @group.command(name="送金", description="ほかの人にペリカを送る（手数料10%）")
    @app_commands.rename(member="相手", amount="金額")
    @app_commands.describe(member="送る相手", amount="送る金額")
    @app_commands.autocomplete(amount=_transfer_autocomplete)
    async def transfer(
        self, interaction: discord.Interaction, member: discord.Member, amount: app_commands.Range[int, 1, 1_000_000]
    ):
        if member.bot:
            return await interaction.response.send_message(
                embed=ui.error_embed("送れません", "Bot には送金できません。"), ephemeral=True
            )
        # 送金の間は「プレイ中」にする。ゲーム中に残高を逃がして負けや倍払いを避ける／確認待ちの間にゲームを始める、を防ぐ
        async with user_session(self._sessions, interaction, "いまは送れません") as ok:
            if not ok:
                return
            gid = ui.guild_id_of(interaction)
            uid = interaction.user.id
            fee = math.ceil(round(amount * TRANSFER_FEE_RATE, 6))
            # 確認ボタンを出す前に、残高を先に調べる（足りないのに確認だけさせない）
            if self._wallet.for_guild(gid).balance(uid) < amount + fee:
                return await interaction.response.send_message(
                    embed=ui.error_embed(
                        "送金できません", f"残高が足りません（送金額 {amount:,} + 手数料 {fee:,} が必要です）。"
                    ),
                    ephemeral=True,
                )
            reply = await confirmed_reply(
                interaction,
                amount >= TRANSFER_CONFIRM_FROM,
                "送金しますか？",
                f"{member.mention} に **{ui.pelica(amount)}** を送ります。\n手数料: {ui.pelica(fee)}（合計 {ui.pelica(amount + fee)} が引かれます）",
                "送金する",
                confirm_fn=confirm_action,
            )
            if reply is None:
                return
            now = self._clock.now()
            res = self._economy_svc.transfer(
                gid,
                uid,
                member.id,
                amount,
                TRANSFER_FEE_RATE,
                TRANSFER_DAILY_LIMIT,
                TRANSFER_MIN_GAMES,
                now=now,
            )
            if not res.ok:
                return await reply(embed=ui.error_embed("送金できません", format_failure(res.reason)), ephemeral=True)
            await reply(
                embed=ui.ok_embed(
                    "送金しました",
                    f"{member.mention} に **{ui.pelica(res.received)}** を送りました。\n"
                    f"手数料: {ui.pelica(res.fee)}　あなたの残高: **{ui.pelica(res.sender_balance)}**",
                ),
                allowed_mentions=discord.AllowedMentions(users=[member]),
            )

    @group.command(name="履歴", description="最近の増減を表示（自分だけに見えます）")
    async def history(self, interaction: discord.Interaction):
        rows = self._wallet.for_guild(ui.guild_id_of(interaction)).history(
            interaction.user.id, 60
        )  # 1ゲームは複数の行なので、多めに読んでまとめる
        lines = format_history(rows, 12)
        await interaction.response.send_message(
            embed=ui.embed("🧾 最近の増減", "\n".join(lines) or "まだ記録がありません。", ui.INFO),
            ephemeral=True,
            allowed_mentions=discord.AllowedMentions.none(),
        )


async def setup(bot: "CasinoBot"):
    await bot.add_cog(
        EconomyCog(
            bot,
            config=bot.config,
            economy_svc=bot.services.economy,
            wallet=bot.repos.wallet,
            records=bot.repos.records,
            bank=bot.repos.bank,
            debt=bot.repos.debt,
            loans=bot.repos.loans,
            shop_repo=bot.repos.shop,
            notices=bot.repos.notices,
            crypto=bot.repos.crypto,
            bonds_repo=bot.repos.bonds,
            assets=bot.repos.assets,
            guild_repo=bot.repos.guild,
            sessions=bot.sessions,
            clock=bot.services.clock,
        )
    )
