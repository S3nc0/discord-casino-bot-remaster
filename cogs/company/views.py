"""会社の画面の部品（CompanyPanel と、金額・種類の入力）。"""

import time
from typing import Optional

import discord

from cogs.company.embeds import company_embed, guide_embed, kind_label
from cogs.shared import ui
from cogs.shared.messages import format_failure
from domain import company as company_mod
from domain.errors import fail
from domain.ports.repos import ICompanyRepo


def parse_amount(raw: str) -> Optional[int]:
    """入力された金額。空なら 0（＝全額）、数字でなければ None。"""
    raw = raw.replace(",", "").strip()
    if not raw:
        return 0
    return int(raw) if raw.isdigit() else None


class AmountModal(discord.ui.Modal):
    """出資する額・引き出す額の入力。"""

    def __init__(self, panel: "CompanyPanel", mode: str):
        super().__init__(title="会社へ出資する" if mode == "invest" else "会社資金を引き出す")
        self.panel, self.mode = panel, mode
        self.amount = discord.ui.TextInput(
            label="金額（ペリカ）" if mode == "invest" else "金額（空欄なら全額）",
            required=mode == "invest",
            max_length=12,
        )
        self.add_item(self.amount)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        amount = parse_amount(self.amount.value)
        if amount is None:
            await interaction.response.send_message(
                embed=ui.error_embed("金額が正しくありません", "半角の数字で入れてください。"), ephemeral=True
            )
            return
        repo = self.panel.repo(interaction)
        if self.mode == "invest":
            ok, result = repo.company_invest(interaction.user.id, amount, time.time())
            done = "出資しました"
        else:
            ok, result = repo.company_withdraw(interaction.user.id, amount or None, time.time())
            done = "引き出しました"
        if not ok:
            await interaction.response.send_message(
                embed=ui.error_embed("できません", format_failure(result)), ephemeral=True
            )
            return
        await self.panel.redraw(interaction, done)


class KindView(ui.OwnerView):
    """事業所の種類を変える（建設費と在庫を失い、Lv1 から建て直す）。"""

    def __init__(self, panel: "CompanyPanel", user_id: int, current: str):
        super().__init__(user_id, timeout=180)
        self.panel = panel
        select = discord.ui.Select(
            placeholder="新しい種類を選ぶ",
            options=[
                discord.SelectOption(label=company_mod.KIND_NAMES[k], value=k)
                for k in company_mod.KINDS
                if k != current
            ],
        )
        select.callback = self._on_pick
        self.add_item(select)

    def embed(self) -> discord.Embed:
        return ui.embed(
            "🏗️ 事業所の種類を変える",
            f"それまでの**建設費と在庫を失い**、会社資金から {ui.pelica(company_mod.BUILD_COSTS[0])} を払って"
            " Lv1 から建て直します。元には戻せません。",
            ui.GOLD,
        )

    async def _on_pick(self, interaction: discord.Interaction) -> None:
        kind = ui.selected_values(interaction)[0]
        ok, reason = self.panel.repo(interaction).company_change_kind(interaction.user.id, kind, time.time())
        if not ok:
            await interaction.response.send_message(
                embed=ui.error_embed("変えられません", format_failure(reason)), ephemeral=True
            )
            return
        self.stop()
        await interaction.response.edit_message(
            embed=ui.ok_embed("建て直しました", f"事業所は {kind_label(kind)} Lv1 になりました。"), view=None
        )


class CompanyPanel(ui.OwnerView):
    """`/会社 状況` の画面。出荷・出資・引き出し・増築・種類の変更を、ボタンで行う。"""

    def __init__(self, repo: ICompanyRepo, user_id: int, guild_id: int) -> None:
        super().__init__(
            user_id, timeout=600, owner_message="これは他の人の会社です。`/会社 状況` で自分の会社を開けます。"
        )
        self._repo = repo
        self.user_id, self.guild_id = user_id, guild_id
        self._build()

    def repo(self, interaction: discord.Interaction) -> ICompanyRepo:
        return self._repo.for_guild(ui.guild_id_of(interaction))

    def embed(self) -> discord.Embed:
        c = self._repo.for_guild(self.guild_id).company_get(self.user_id, time.time())
        return company_embed(c) if c else guide_embed()

    def _build(self) -> None:
        self.clear_items()
        c = self._repo.for_guild(self.guild_id).company_get(self.user_id, time.time())
        if c is None:
            return
        buttons = [
            ("📦 出荷する", discord.ButtonStyle.success, self._on_ship, c["stock_value"] <= 0, 0),
            ("💴 出資する", discord.ButtonStyle.primary, self._on_invest, False, 0),
            ("🏧 引き出す", discord.ButtonStyle.secondary, self._on_withdraw, c["funds"] <= 0, 0),
            ("🏗️ 増築する", discord.ButtonStyle.primary, self._on_upgrade, c["upgrade_cost"] is None, 1),
            ("🔁 種類を変える", discord.ButtonStyle.danger, self._on_kind, len(company_mod.KINDS) < 2, 1),
            ("🔄 更新", discord.ButtonStyle.secondary, self._on_refresh, False, 1),
        ]
        for label, style, cb, disabled, row in buttons:
            b = discord.ui.Button(label=label, style=style, disabled=disabled, row=row)
            b.callback = cb
            self.add_item(b)

    async def redraw(self, interaction: discord.Interaction, note: str = "") -> None:
        self._build()
        embed = self.embed()
        if note:
            embed.description = f"{embed.description}\n✅ {note}"
        await interaction.response.edit_message(embed=embed, view=self)

    async def _fail(self, interaction: discord.Interaction, reason: object) -> None:
        await interaction.response.send_message(
            embed=ui.error_embed("できません", format_failure(reason)), ephemeral=True
        )

    async def _on_ship(self, interaction: discord.Interaction) -> None:
        ok, result = self.repo(interaction).company_ship(interaction.user.id, time.time())
        if not ok:
            return await self._fail(interaction, result)
        note = f"出荷しました: 会社資金 +{ui.pelica(result['paid'])}（ピンハネ {ui.pelica(result['pinhane'])}）"
        if result.get("dividends"):
            note += f"\n出資者へ配当 {ui.pelica(result['dividends'])} を配りました（会社資金から）"
        if result["left"]:
            note += f"。帝愛の買取予算が足りず、{ui.pelica(result['left'])} 分は在庫に残りました"
        await self.redraw(interaction, note)

    async def _on_invest(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_modal(AmountModal(self, "invest"))

    async def _on_withdraw(self, interaction: discord.Interaction) -> None:
        await interaction.response.send_modal(AmountModal(self, "withdraw"))

    async def _on_upgrade(self, interaction: discord.Interaction) -> None:
        ok, result = self.repo(interaction).company_upgrade(interaction.user.id, time.time())
        if not ok:
            return await self._fail(interaction, result)
        await self.redraw(interaction, f"増築しました: 事業所は Lv{result} になりました")

    async def _on_kind(self, interaction: discord.Interaction) -> None:
        c = self.repo(interaction).company_get(interaction.user.id, time.time())
        if c is None:
            return await self._fail(interaction, fail("company_none"))
        view = KindView(self, interaction.user.id, c["kind"])
        await interaction.response.send_message(embed=view.embed(), view=view, ephemeral=True)

    async def _on_refresh(self, interaction: discord.Interaction) -> None:
        await self.redraw(interaction)
