"""会社の画面に出す文言（プレゼンテーション静的テキスト層）。"""

KIND_MARK: dict[str, str] = {"farm": "🌾", "mine": "⛏"}

KIND_BLURB: dict[str, str] = {
    "farm": "天候で生産量と相場が大きく動く。倉庫に貯めて、高い日に出荷すると伸びる",
    "mine": "生産も相場も安定。堅実に稼ぐ",
}

# 日替わりの状態（catalogs/company.yaml の conditions の key）
CONDITION_TEXT: dict[str, str] = {
    "sunny": "☀️ 晴れ",
    "rain": "🌧️ 恵みの雨",
    "bumper": "🌾 豊作",
    "drought": "🥀 日照り",
    "storm": "🌀 嵐",
    "season": "🍂 旬",
    "steady": "⛏ 平常操業",
}

PANEL_HINT = (
    "製品は時間で倉庫に貯まり、「出荷」で今日の相場で帝愛に売れます。売上は会社資金に入ります。\n"
    "維持費は、毎日 0時に会社資金から引かれます。払えない日が続くと倒産します。"
)
