"""/ショップ の操作パネル: 画面の切り替え、選択肢、買う・身につける・外す・称号の表示。"""

import asyncio
from types import SimpleNamespace
from typing import Any

import discord
import pytest

from cogs.shop.cog import MAX_QTY, ShopCog, ShopView
from domain import shop
from domain.types import INITIAL_BALANCE
from infra.db.repositories import open_repositories
from tests.fakes import as_interaction, invoke, must, selects
from tests.support import make_shop_cog, make_test_bot


@pytest.fixture
def eco(tmp_path):
    return open_repositories(str(tmp_path / "t.db"))


@pytest.fixture
def cog(eco):
    return make_shop_cog(make_test_bot(repos=eco))


class It:
    """パネルの部品を押したときの interaction。values は選んだ値。"""

    def __init__(self, uid=1, values=None):
        self.user = SimpleNamespace(id=uid, display_name="テスト")
        self.guild = SimpleNamespace(id=0)
        self.data = {"values": values or []}
        self.sent, self.edits = [], []
        self.response = SimpleNamespace(send_message=self._send, edit_message=self._edit, defer=self._defer)
        self.followup = SimpleNamespace(send=self._send)

    async def _send(self, *a, **kw):
        self.sent.append(kw)

    async def _edit(self, **kw):
        self.edits.append(kw)

    async def _defer(self, **kw):
        return None


def run(coro):
    return asyncio.run(coro)


def select(view, row):
    return next(c for c in selects(view) if c.row == row)


def has(view, row):
    import discord

    return any(isinstance(c, discord.ui.Select) and c.row == row for c in view.children)


def test_command_is_a_single_top_level_guild_command():
    cmd = ShopCog.shop_panel
    assert cmd.name == "ショップ" and cmd.guild_only and cmd.parent is None
    assert "ショップ" not in {
        c.name for c in make_shop_cog(make_test_bot()).__cog_app_commands__ if hasattr(c, "commands")
    }  # 旧コマンドのグループは登録されない


def buttons(view) -> "dict[str | None, discord.ui.Button[Any]]":
    import discord

    return {c.label: c for c in view.children if isinstance(c, discord.ui.Button)}


def test_opening_shows_the_home_with_shelf_buttons_and_no_buy_select(cog):
    it = It()
    run(invoke(ShopCog.shop_panel, cog, it))
    sent = it.sent[0]
    assert (
        sent["ephemeral"] is True
        and sent["embed"].title == "🛍️ ペリカショップ"
        and "あなたの残高" in sent["embed"].footer.text
    )
    view = sent["view"]
    assert not any(has(view, r) for r in range(4))  # トップでは、買う景品の選択肢は出ない
    assert set(buttons(view)) >= {
        "🏠 トップ",
        "🏷️ 称号",
        "🎴 カード",
        "🎟️ 消耗品",
        "🐎 競馬",
        "✨ 演出・名前の色",
        "🏆 コレクション",
        "🕴️ 帝愛の競売",
        "🎒 持ち物",
    }
    assert {r.row for r in buttons(view).values()} <= {0, 1}  # ボタンは2段まで
    assert [f.name for f in sent["embed"].fields] == ["売り場", "🕴️ 帝愛の競売", "🎒 持ち物"]


def test_every_item_is_on_exactly_one_shelf():
    from cogs.shop.cog import TABS, tab_items

    shelved = [i.id for tab in TABS for i in tab_items(tab)]
    sellable = [i.id for i in shop.CATALOG if not i.limited]
    assert sorted(shelved) == sorted(sellable) and len(shelved) == len(set(shelved))
    for tab in TABS:
        prices = [i.price for i in tab_items(tab)]
        assert prices == sorted(prices)  # 安い順


def test_choosing_a_shelf_shows_only_that_shelf_and_offers_only_buyable_items(cog):
    view = ShopView(cog, 1, 0)
    it = It()
    run(view._make_tab("title")(as_interaction(it)))
    embed = it.edits[0]["embed"]
    assert embed.title == "🏷️ 称号" and all(f.name[0] in "🌱🥉🥈🥇" for f in embed.fields)  # 値段の段階ごと
    assert (
        "🌱 入門" in [f.name for f in embed.fields] and "百億の男" in embed.fields[-1].value
    )  # 最高額は、いちばん最後
    options = select(view, 2).options
    assert 0 < len(options) <= 25 and all("ペリカ" in must(o.description) for o in options)
    prices = [int(must(o.description).split("ペリカ")[0].replace(",", "")) for o in options]
    assert prices == sorted(prices)
    limited = {i.id for i in shop.CATALOG if i.limited}
    assert limited and not (limited & {o.value for o in options})  # 限定称号（買えない）は出ない
    assert buttons(view)["🏷️ 称号"].style.name == "primary"  # いまの売り場は青
    run(view._make_tab("home")(as_interaction(It())))
    assert not has(view, 2)  # トップに戻ると、買う選択肢は消える


def test_mixed_shelves_label_each_item_with_its_kind(cog):
    view = ShopView(cog, 1, 0)
    run(view._make_tab("card")(as_interaction(It())))
    labels = [o.label for o in select(view, 2).options]
    assert len(labels) == 12 and all("カード" in name for name in labels)
    run(view._make_tab("style")(as_interaction(It())))
    assert len(select(view, 2).options) == 17


def test_consumables_get_a_quantity_select_and_buying_uses_it(cog, eco):
    view = ShopView(cog, 1, 0)
    run(view._make_tab("item")(as_interaction(It())))
    qty = select(view, 3)
    assert [o.value for o in qty.options] == [str(n) for n in range(1, MAX_QTY + 1)]
    run(view._on_qty(as_interaction(It(values=["3"]))))
    assert view.qty == 3 and select(view, 3).placeholder == "個数（いま 3 個）"
    eco.wallet.credit(1, 20_000, "テスト")
    pick_it = It(values=[shop.INSURANCE])
    run(view._on_buy(as_interaction(pick_it)))
    assert eco.shop.inventory(1).get(shop.INSURANCE, 0) == 0  # 選んだだけでは、買わない
    buy_it = It()
    run(view._on_purchase(as_interaction(buy_it)))
    assert (
        eco.shop.inventory(1)[shop.INSURANCE] == 3 and "購入しました" in buy_it.sent[-1]["embed"].title
    )  # 個数が反映される
    run(view._make_tab("title")(as_interaction(It())))
    assert view.qty == 1 and not has(view, 3)  # 売り場を変えると個数は1に戻り、個数の選択肢も消える


def test_buying_a_title_then_equipping_and_unequipping_from_the_inventory_screen(cog, eco):
    view = ShopView(cog, 1, 0)
    run(view._make_tab("title")(as_interaction(It())))
    run(view._on_buy(as_interaction(It(values=["title_rookie"]))))
    assert "title_rookie" not in eco.shop.inventory(1)  # 選んだだけでは、買わない
    it = It()
    run(view._on_purchase(as_interaction(it)))
    assert (
        "title_rookie" in eco.shop.inventory(1) and it.sent[-1]["ephemeral"] and eco.wallet.balance(1) < INITIAL_BALANCE
    )
    inv_it = It()
    run(view._to_inventory(as_interaction(inv_it)))
    assert (
        view.screen == "inv"
        and inv_it.edits[0]["embed"].title == "🎒 持ち物"
        and "【装備中】" not in str(inv_it.edits[0]["embed"].fields)
    )
    assert [o.value for o in select(view, 0).options] == ["title_rookie"]  # 持っているものだけ
    use_it = It(values=["title_rookie"])
    run(view._on_use(as_interaction(use_it)))
    assert eco.shop.get_profile(1)["title"] == "title_rookie" and "装備しました" in use_it.sent[-1]["embed"].title
    run(view._redraw(as_interaction(It())))
    assert "【装備中】" in str(view.embed().fields[0].value)
    off = It(values=["title"])
    run(view._on_unequip(as_interaction(off)))
    assert eco.shop.get_profile(1)["title"] is None and "外しました" in off.sent[-1]["embed"].title


def test_inventory_screen_has_unequip_and_title_toggle_and_back(cog):
    view = ShopView(cog, 1, 0, screen="inv")
    assert not has(view, 0)  # 何も持っていないので「使う」の選択肢は出ない
    assert [o.value for o in select(view, 1).options] == [
        "title",
        "card_color",
        "card_icon",
        "role",
        "skin_dice",
        "skin_table",
    ]
    labels = [label for label in buttons(view) if label]
    assert "称号を名前の後ろに付ける" in labels and "称号を名前に付けない" in labels and "🛍️ ショップ" in labels
    it = It()
    run(view._to_shop(as_interaction(it)))
    assert view.screen == "shop" and it.edits[0]["embed"].title == "🛍️ ペリカショップ"


def test_title_toggle_buttons_call_the_existing_handler(cog, monkeypatch):
    from cogs.shop import actions

    called = []

    async def fake(cog_, interaction, mode):
        called.append(mode)

    monkeypatch.setattr(actions, "set_title_display", fake)
    view = ShopView(cog, 1, 0, screen="inv")
    for mode in ("on", "off"):
        run(view._make_nick(mode)(as_interaction(It())))
    assert called == ["on", "off"]


def test_only_the_owner_can_use_the_panel(cog):
    view = ShopView(cog, 1, 0)
    other = It(uid=2)
    assert (
        run(view.interaction_check(as_interaction(other))) is False and "他の人のパネル" in other.sent[0]["embed"].title
    )
    assert run(view.interaction_check(as_interaction(It(uid=1)))) is True


def test_unused_catalog_text_no_longer_points_to_removed_commands(cog):
    text = must(ShopView(cog, 1, 0).embed().description) + must(ShopView(cog, 1, 0, screen="inv").embed().description)
    assert "/ショップ " not in text


def test_purchase_button_is_disabled_until_something_is_picked_and_resets_on_screen_change(cog, eco):
    view = ShopView(cog, 1, 0)
    run(view._make_tab("item")(as_interaction(It())))
    btn = next(c for label, c in buttons(view).items() if (label or "").startswith("🛒"))
    assert btn.disabled and btn.row == 4
    run(view._on_buy(as_interaction(It(values=[shop.INSURANCE]))))
    btn = next(c for label, c in buttons(view).items() if (label or "").startswith("🛒"))
    assert not btn.disabled and view.picked == ("shop", shop.INSURANCE)
    run(view._make_tab("title")(as_interaction(It())))
    assert view.picked is None
