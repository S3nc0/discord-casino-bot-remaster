[English](stream.md) | **日本語**

# 配信パネル仕様（`stream`、上流の取り込み）

> 状態：**Wave 5 の契約仕様**（カード S0 契約、S1 サーバー、S2 Activity、S3 チャット Bot）。担当：**S0**（このファイルと `packages/shared`） · 画面 ID：`stream` · 機能トグル：`stream` · 新しい台帳の理由：`stream_bet`、`stream_payout`、`stream_refund`。
>
> 元：上流のコミット `eff8eac`（スパチャと勝敗の賭け）と `213c555`（ボイスチャンネルの場所）。数字と日本語の文言は上流のものです。§0 に、オーナーが変えた点（決定 **D3**・**D4**、2026-11-24）をまとめました。このファイルと上流が違うときは、このファイルが正です。

## 0. 上流と違うオーナーの決定

| # | 上流 | リマスター |
| --- | --- | --- |
| D3-1 | 賭けを受け付けている最中でも、配信者が勝ち・負けを決められる。 | **勝ち・負けを決める前に、勝負を締め切っている必要がある**（`stream_not_locked`）。無効にするのは、受付中でも締切後でも、いつでもできる。 |
| D3-1 | 賭けは配信者が「締め切る」を押したときだけ閉まる。 | 勝負を始めてから **10 分たつと、自動でも閉まる**（`ROUND_AUTO_LOCK_MS = 600_000`）。配信者はそれより早く締め切れる。 |
| D3-2 | オーナー用の道具がない。 | **`/admin stream-void`** で、理由を書いて勝負（または配信のいまの勝負）を無効にできる。終わった勝負は必ず**監査ログ**に 1 行残る（§9）。 |
| D3 | — | **採用しない：** 1 人 1 勝負あたりの利益の上限、サーバーごとの配信パネル数の上限。払い戻しの側のお金の歯止めは、上流の 1 人 10,000 の上限だけです。 |
| D4 | Bot が `📺 〇〇の配信` というボイスチャンネルを作り（チャンネルの管理が必要）、終了時に消す。 | **ボイスチャンネルは自動で作らない。チャンネルの管理は要らない。** 場所は、配信者の Activity が動いているボイスチャンネル、なければ出さない（§8）。`created_vc` の列は持ち込まない。 |

## 1. プレイヤーの流れ

1. *友達が難しいボス戦に挑む。チャンネルに配信パネルを出す（または Activity から始める）。*
2. *見ている人がスパチャにメッセージを添えて送り、次の勝負は負けると見て 500 ペリカ賭ける。*
3. *配信者が勝負を始め、みんなが賭け、賭けが締まり（手動か 10 分後）、勝負があり、配信者が結果を決め、当てた人が負けた側の賭け金を山分けする。*

お金に関わることはすべてサーバーが決めます。配信者は、いつもセッションのユーザー（Activity）かインタラクションのユーザー（チャット）で、リクエストに配信者を書く欄はありません。

## 2. 数字

| 名前 | 値 | 通信の定数（`STREAM_LIMITS`） |
| --- | --- | --- |
| タイトルの長さ | 1〜100 | `titleMax` |
| 配信の URL | 任意。`http://` か `https://` で始まる。300 文字まで | `urlMax` |
| パネルの自動終了 | 開始から 24 時間 | `maxHours` |
| スパチャの最低額 | 100 | `tipMin` |
| スパチャのメッセージ | 0〜150 文字 | `tipMessageMax` |
| 賭けの最低額 | 100 | `betMin` |
| 1 人が 1 勝負に賭けられる合計（両方の賭けの合計） | 10,000 | `betMax` |
| 帝愛の控除 | 負けた側の合計の 5%、切り捨て | `rakeBps = 500` |
| 勝負の名前 | 0〜60 文字。空なら `次の勝負` | `roundLabelMax` |
| 賭けが自動で閉まる | 勝負を始めて 10 分後 | `roundAutoLockMs` |
| オーナーの無効の理由 | 1〜200 文字 | `voidReasonMax` |
| 結果に載せる払い戻しの行 | 多い順に上位 10 | `resultTopMax` |
| フィード用に持つスパチャ | 20 件 | `recentTipsMax` |

スパチャの手数料・1 日の上限・必要なゲーム回数・確認のしきい値は、**送金の数字**そのものです（[transfer.ja.md](transfer.ja.md)：手数料 10% 切り上げで上乗せ、1 日 20,000、3 回以上プレイ、5,000 から確認）。ここには書き写さず、コードにも写しません。

## 3. パネルとスパチャ

- **開始。** チャットの `/stream start title [url]`（日本語名 `/配信 開始`）か、Activity の開始フォーム。1 人が同時に出せるパネルは 1 つ（`stream_already_live`）。パネルは `開始 + 24 時間` で自動で閉じます。サーバー全体のパネル数に上限はありません。
- **パネルの内容。** 配信者、場所（§8。わかるとき）、URL（あれば）、スパチャの合計と件数、いまの勝負（名前、状態、勝ち・負けの合計と当たったときの倍率の目安、賭けた人数、賭けが閉まる時刻）、パネルが自動で閉じる時刻。フッターに決まりごと。配信中は赤（`0xE62117`）、終わるとボタンを外します。
- **チャットのボタン**（再起動しても動く custom id。Bot の `cid()` ルーターを使う）：`💸 スパチャ`、`🏆 勝ちに賭ける`、`💀 負けに賭ける`、`🎛️ 配信者メニュー`。
- **スパチャ。** 配信者は自分の配信に送れません（`stream_self_tip`）。100 以上（`stream_tip_min`）、メッセージは 150 文字まで。お金の動きは `/pelica transfer`（`/ペリカ 送金`）と同じです。送る側は `金額 + 手数料`（手数料は 10% を切り上げ）を払い、配信者は `金額` を受け取ります（帝愛の借金の天引きは通常の送金と同じ）。`ref_type = 'stream'`、`ref_id = 配信の id` の `transfer_out` / `transfer_in` / `transfer_fee` の行になります。1 日 20,000 の上限は送金と合わせて数え、3 回以上プレイが必要で、借金があると断られ（`stream_debt`）、5,000 から確認が出ます。
- **スパチャのカード。** 確定のあと、Bot がパネルのチャンネルに色つきの埋め込みを**メンションなし**で出します。作者は `{name}　💸 {amount}ペリカ`、本文はメッセージ。色は額で決まります（`streamTipColor`）：20,000 以上 赤 `#E62117`、10,000 以上 赤紫 `#E91E63`、5,000 以上 橙 `#F57C00`、2,000 以上 黄 `#FFCA28`、1,000 以上 緑 `#1DE9B6`、500 以上 水色 `#00E5FF`、それ未満は青 `#1E88E5`。パネルの合計も更新します。
- メッセージは `StreamTipped` イベントと小さなメモリ上のリング（`recentTips`、20 件）にしか残りません。再起動後は空のことがあります。

## 4. 状態機械

**配信：** `live` → `ended`。配信者が `⏹️ 配信を終える`（確認つき）で終えるか、1 分ごとのジョブが `endsAt` に達したとき（`cause: timeout`）に終わります。決まっていない勝負は、先に同じトランザクションで**無効**にします（全員に返金）。パネルは `⏹️ 配信終了: …` になり、ボタンが外れます。

**勝負**（1 つの配信に、決まっていない勝負は 1 つだけ。ユニーク索引で守る）：

```
 (なし) --開始--> 受付中(open) --締切（配信者）/ 10分のタイマー--> 締切(locked) --勝ち・負け（配信者）--> 精算済み
                     |                                              |
                     +------ 無効（配信者・オーナー・配信の終了・24時間の自動終了） ------+--> 無効(void)
```

| 操作 | 誰が | 必要なこと | 断るときのコード |
| --- | --- | --- | --- |
| 開始 | 配信者 | 配信中、決まっていない勝負がない、名前 60 文字以内 | `stream_ended`、`stream_not_streamer`、`stream_round_active`、`stream_bad_label` |
| 賭ける | 配信者以外 | 勝負が `open` で `autoLockAt` より前、リクエストがいまの勝負を指している | `stream_no_open_round`（勝負なし・締切済み・`autoLockAt` を過ぎた）、`stream_round_changed`、`stream_self_bet`、`stream_bad_side`、`stream_debt`、`stream_bet_min`、`stream_other_side`、`stream_bet_max`、`insufficient_funds` |
| 締切 | 配信者 | 勝負が `open` | `stream_no_round`、`stream_round_changed`、`stream_no_open_round`（もう締切済み） |
| 勝ち・負け | 配信者 | 勝負が**`locked`** | `stream_no_round`、`stream_round_changed`、**`stream_not_locked`**（まだ受付中） |
| 無効 | 配信者、またはオーナー（`/admin stream-void`） | 勝負が `open` か `locked` | `stream_no_round`、`stream_round_changed`、`stream_round_settled`（もう払い済み） |
| 終了 | 配信者 | 配信中 | `stream_ended`、`stream_not_streamer` |

- **自動の締切は、遅延評価で正確。** 1 分ごとのジョブ（`stream.lockDue`）が `locked` を保存して `StreamRoundLocked { cause: 'auto' }` を出しますが、サーバーは `now >= autoLockAt` の `open` の勝負を、`bet`・`view`・`settle` でも締切済みとして扱うので、ジョブの合間でも 10 分は秒単位で守られます。
- 締切・精算・無効はどれも `roundId` を持つので、ダブルクリックや古いメニューが次の勝負に効くことはありません。書き込みはすべて `idempotencyKey` つきで、精算と終了は 1 つの `store.transaction` の中で行の状態を守るので、ダブルクリックとタイマーが重なっても 1 回だけ精算されます。
- 機能トグル `stream` を止めると、`start`・`tip`・`bet` を断ります（新しいパネルと新しいお金）。**`open`・`lock`・`settle`・`void`・`end` は止めていても使えます**（配信者メニューは止まりません）。預かったお金は必ず精算できます。

## 5. 賭け

- 賭け金は**その場でエスクロー**します：`stream_bet`（sink、マイナス）、`ref_type = 'stream_round'`、`ref_id = 勝負の id`。賭けごとに 1 行。同じ側にもう一度賭けると、その人の賭け金に足されます。側は変えられません（`stream_other_side`）。配信者は賭けられません（`stream_self_bet`）。借金があると賭けられません（`stream_debt`）。1 人 1 勝負で合計 10,000 まで（`stream_bet_max` に、すでに賭けた額が出ます）。
- 断るときは、台帳の行を 1 つも書く前に断ります。
- 検査の順番：配信中 → 機能が動いている → 勝負が受付中で、指されている → 配信者ではない → 側が正しい → 借金 → 100 以上 → 反対側 → 上限 → 残高。（お金の操作と同じく、呼び出し全体をユーザーごとのセッションロックで囲みます。）

## 6. 精算（山分け）

入力：その勝負の賭け、勝った側（`win` か `lose`）。すべて整数。

```
winnerTotal = 当たった側の賭け金の合計
loserTotal  = 外れた側の賭け金の合計
rake        = floor(loserTotal * 500 / 10000)
pot         = loserTotal - rake
payout(i)   = stake(i) + floor(pot * stake(i) / winnerTotal)       当たった人 i ごと
dust        = pot - sum(floor(pot * stake(i) / winnerTotal))
```

- 控除と端数（dust）は払い戻さず、帝愛銀行の収入になります（ほかの胴元の取り分と同じ）。**ペリカは新しく作りません**：払い戻しの合計 = winnerTotal + pot − dust ≤ winnerTotal + loserTotal = 賭け金の合計。
- **払い戻しではなく返金**（`stream_refund`、faucet、賭け金ちょうど）：勝負が**無効**（どの理由でも）、**片側だけ**（片方の合計が 0）、または誰も賭けなかったとき。結果の `refunded` は `true`。
- 払い戻しの行は `stream_payout`（faucet）。賭け金を超えた分は収入なので、ゲームの払い戻しと同じく帝愛の**借金の天引き**（`debt_withholding`）がかかります。賭け金の部分は天引きしません。
- 当たった人は、必ず賭け金に 0 以上の分け前を足して受け取ります。賭け金より少なくなることはありません。
- 精算は、勝負の状態の変更と監査ログの行（§9）といっしょに **1 つの `store.transaction`** で行います。すべての払い戻し・返金の行と状態の変更が入るか、どれも入らないかです。

**計算例**（上流の仕様より）：勝ちに A が 1,000・B が 3,000、負けに C が 2,000、配信者が**勝った**場合。winnerTotal 4,000、loserTotal 2,000、控除 100、pot 1,900。A = 1,000 + floor(1,900 × 1,000 / 4,000) = **1,475**、B = 3,000 + floor(1,900 × 3,000 / 4,000) = **4,425**、端数 0。出ていく合計 5,900 ≤ 入った合計 6,000、帝愛の取り分は 100、C は 0。

**倍率の目安**（`streamOddsBps`）：自分の側の合計 `mine`、相手側の合計 `other` として、賭け金に対する `10,000 + floor((other − floor(other × 500 / 10,000)) × 10,000 / mine)` ベーシスポイント。x1.475 は 14,750 です。どちらかの側が 0 なら `null`。目安にすぎません。

**結果の投稿**（チャット）：見出し `🏁 {title} の勝負の結果`、頭（`結果: **🏆 配信者の勝ち**`、返金の文、または無効の文）、払い戻し上位 10 人を `<@id> **金額**` で、まだいれば `ほか N人`、`帝愛の控除: {rake}`、当たった側に誰もいなければ `当てた人はいませんでした。`。オーナーが無効にしたときは理由の行が付きます。メンションなしで投稿します。

## 7. ジョブ

| ジョブ | 間隔 | すること |
| --- | --- | --- |
| `stream.lockDue` | 1 分 | `autoLockAt` を過ぎた受付中の勝負を締め切り（`StreamRoundLocked` `cause: auto`）、自動締切のお知らせを 1 回だけ出す。 |
| `stream.closeDue` | 1 分 | `endsAt <= now` の配信ごとに、いまの勝負を無効にし（`cause: timeout`）、配信を終え（`StreamEnded` `cause: timeout`）、パネルを更新する。 |

どちらも拒否されていないサーバーごとに動き、1 つのサーバーが失敗しても、ほかは止まりません。状態は DB だけなので、再起動しても何も失われず、取りこぼした分は次の回で追いつきます。パネルのメッセージの書き換えは間引きます（1 パネルにつき 2〜3 秒に 1 回まで、最新の状態が勝つ）。

## 8. 場所（決定 D4）

- `StreamView.location` は `{ channelId, source: 'activity' }` か `null` です。サーバーが決めるのは、**Activity から配信を始めたときだけ**です。Discord にアクティビティのインスタンスを問い合わせ（`GET /applications/{app}/activity-instances/{instanceId}`。トークンの検証ですでに使っています）、`location.channel_id` がボイスチャンネルならそれを使います。クライアントの入力は使いません。
- チャットから始めた配信には場所がありません。Bot は `Guilds` インテントだけで、ボイス状態のキャッシュを持たず、それは変えません。
- **Bot はチャンネルを作らず、名前も変えず、消しません。チャンネルの管理の権限は要りません。** `created_vc` の列と `📺 〇〇の配信` のチャンネルは持ち込みません。チャットのパネルは、`location` があるときだけ `📍 場所: <#channel>` を出します。

## 9. オーナーの道具と監査ログ（決定 D3-2）

**`/admin stream-void`**（オーナー専用。ほかの `/admin` と同じ、サーバーを指定する管理コマンド）：

| オプション | 意味 |
| --- | --- |
| `target`（文字列、必須） | `stream:<id>` = その配信のいまの勝負、`round:<id>` = その勝負、数字だけなら勝負の id。 |
| `reason`（文字列、必須） | 1〜200 文字。チャンネルの投稿に出て、監査ログに残る。 |
| `guild_id` | 対象のサーバー（ほかの管理コマンドと同じ。候補から選択）。 |

- `open` か `locked` の勝負を無効にします。賭けた全員に賭け金ちょうどを返し（`stream_refund`）、結果は `outcome: void`、`cause: owner`。パネルを更新し、結果の投稿に `運営が無効にしました。理由: …` が付きます。配信そのものは続きます。
- 断る場合：存在しない id、またはいまの勝負がない配信 → `stream_void_target`。理由が空か長すぎる → `stream_void_reason`。もう払い済みの勝負 → `stream_round_settled`（払ったお金は取り戻せません）。
- 機能トグルが止まっていても使えます。

**監査ログ。** 終わった勝負（勝ち・負け・配信者による無効・オーナーによる無効・配信の終了・自動終了）は、同じトランザクションで `StreamAuditEntry` を 1 行書きます：勝負と配信の id、サーバー、配信者、名前、開始・締切・終了の時刻、結果、理由（cause）、**誰が決めた／無効にしたか**（`actorId`。タイマーなら null）、オーナーの理由、賭けた人数、勝ちと負けの合計、控除、`refunded`、**当てた人の上位**（最大 10 人、金額つき）。オーナー専用で、Activity には送りません。DB がある限り残します。

## 10. 不正への対策

| 危険 | 対策 | 状態 |
| --- | --- | --- |
| 八百長：配信者がわざと負け、仲間の「負け」の賭けを当てさせる | 配信者は賭けられない。1 人 1 勝負 10,000 まで。**理由つきのオーナーの無効**。**監査ログ**（配信者・合計・上位の当たり・誰が決めたか）。サーバーごとに機能を止められる | 採用（D3-2） |
| 八百長：儲けに上限がない | 1 人 1 勝負あたりの利益の上限 | **採用しない**（D3） |
| 後出し：配信の結果を見てから賭ける | **勝負を始めて 10 分で賭けが自動で閉まる**。**勝ち・負けは、締め切ったあとだけ** | 採用（D3-1） |
| 配信者が締切済みの勝負を何時間も放置する | パネル全体が 24 時間で自動終了して無効になる | 上流のまま。追加のタイマーはなし |
| スパチャのメッセージの悪用 | 150 文字、メンションなし、`tipperId` をイベントに残す、機能を止められる。リンクは消さない | 上流のまま |
| パネルのスパム | 1 人 1 パネル。サーバー全体の上限はなし | **採用しない**（D3） |
| スパチャが送金の抜け道になる | 送金と同じサービス・ルール・1 日の上限 | 上流のまま |
| 借金のある人の賭け | 借金があると賭けられない。払い戻しの利益は借金の天引きを通る | 上流のまま |
| タイマー・ダブルクリック・精算の競合 | 1 つのトランザクションで状態を守る。リクエストに id。冪等キー | 上流のまま |

## 11. お金と不変条件

| お金の動き | 理由 | 区分 |
| --- | --- | --- |
| スパチャ：送る側 | `transfer_out`（−金額）、`transfer_fee`（−手数料） | transfer、sink |
| スパチャ：配信者 | `transfer_in`（+金額） | transfer |
| 賭け | `stream_bet` | sink（エスクロー） |
| 払い戻し | `stream_payout` | faucet |
| 返金（無効・片側だけ・配信の終了） | `stream_refund` | faucet |

`tests/invariants` のコマンド（S1）：`streamStart`、`streamOpen`、`streamBet`、`streamLock`、`streamSettle`、`streamVoid`、`streamEnd`、`streamCloseDue`、`streamTip`。勝負ごとの確認：返金なら全員が賭け金ちょうどを受け取る。そうでなければ、当てた人は全員が賭け金以上を受け取り、出ていく合計 ≤ 入った合計。控除 + 端数 = 入った合計 − 出ていく合計 ≥ 0。残高がマイナスにならない。1 つの勝負は 1 回しか払わない。受付中の勝負への `settle` は何も変えない。

## 12. 契約（`packages/shared`）

| 項目 | 場所 | 値 |
| --- | --- | --- |
| 台帳の理由 | `ledger.ts` | `stream_bet`（sink、−1）、`stream_payout`（faucet、+1）、`stream_refund`（faucet、+1）。`quiz_author_pay` の後ろに追加 |
| 履歴のラベル | `screen.casino.history.reason.stream_*` | 配信の賭け、配信の払い戻し、配信の返金（EN：Stream bet / Stream payout / Stream refund） |
| 画面 | `ids.ts` `SCREEN_IDS` | `stream`。ラベルは `screen.stream` |
| id | `ids.ts` | `StreamId`、`StreamRoundId`（正の整数） |
| ルーム | `rooms.ts` | `rooms.stream(guildId, streamId)` = `stream:{guild}:{id}`。`{ kind: 'stream' }` として解析。同じサーバーのセッションなら誰でも入れる。`stream:join`（ack は呼んだ人の `StreamView`）で入り、`stream:leave` で出る |
| イベント | `events.ts` | `StreamStarted`、`StreamTipped`、`StreamBetPlaced`、`StreamRoundOpened`、`StreamRoundLocked`、`StreamRoundSettled`、`StreamEnded`（必須なのは後ろの 5 つ。`StreamStarted` と `StreamBetPlaced` は、配信の一覧と合計をポーリングなしで更新するための追加）。どれも `userId` を持たないので、ソケット層の既定（「その 1 人にだけ送る」）で漏れることはありません。S1 が配信のルームへ流します。 |
| ルールのコード | `stream.ts` `STREAM_RULES` | 22 個（§13）。メッセージのキーは `screen.stream.rule.<rule>`。汎用の `error` コードと並べて `StreamError.rule` で送る |
| ルート | `activity/stream.ts` `STREAM_ROUTES` | 下の表 |
| 機能キー | `apps/server/src/bot/admin-tools.ts`、`commands.ts` | `stream`（`bot.admin.feature.stream`：`配信（スパチャ・勝敗の賭け）` / `Streams (tips & win/lose bets)`） |

**HTTP ルート**（すべて `/api` の下。セッショントークン。サーバーとユーザーはトークンから。書き込みは `idempotencyKey` つきで、再送しても同じ結果）：

| ルート | メソッド | リクエスト | レスポンス |
| --- | --- | --- | --- |
| `/api/stream` | GET | | `StreamList`（サーバーの配信中の一覧と、自分の配信） |
| `/api/stream/view` | GET | `StreamViewQuery { streamId }` | `StreamView` |
| `/api/stream/start` | POST | `StreamStartRequest { title, url? }` | `StreamStartResponse` |
| `/api/stream/tip` | POST | `StreamTipRequest { streamId, amount, message? }` | `StreamTipResponse`（+ amount, fee, received, withheld） |
| `/api/stream/bet` | POST | `StreamBetRequest { streamId, roundId, side, amount }` | `StreamBetResponse`（+ side, total） |
| `/api/stream/round/open` | POST | `StreamOpenRequest { streamId, label? }` | `StreamWriteResponse` |
| `/api/stream/round/lock` | POST | `StreamRoundRequest { streamId, roundId }` | `StreamWriteResponse` |
| `/api/stream/round/settle` | POST | `StreamSettleRequest { streamId, roundId, winner }` | `StreamSettleResponse`（+ result） |
| `/api/stream/round/void` | POST | `StreamRoundRequest` | `StreamSettleResponse` |
| `/api/stream/end` | POST | `StreamEndRequest { streamId }` | `StreamEndResponse`（+ voided） |

書き込みのレスポンスはすべて `{ replayed, balance, stream: StreamView, … }` です。リクエストのスキーマは未知のプロパティを断るので、`streamerId`・`userId`・払い戻しの額を紛れ込ませることはできません。断るときは `StreamError`：汎用の `ErrorCode`（`forbidden`、`conflict`、`not_found`、`feature_disabled`、`insufficient_funds`、`rate_limited` など）に、`rule` と `params` が付きます。レート制限：スパチャと賭けに、既存のユーザーごとの HTTP リミッターを使います。

**ビュー。** `StreamView` は、配信、いまの勝負（合計、ベーシスポイントの倍率の目安、`autoLockAt`）、直近 20 件のスパチャ、`location`、`me`（配信者か、残高、この勝負での自分の賭け、上限までの残り）を持ちます。スパチャの手数料・1 日の残りの上限・確認のしきい値は、既存の `GET /api/life/transfer` のビューから取り、画面側で重複させません。

## 13. 文言

ルールのメッセージ（`screen.stream.rule.<コード>`）。先頭の 16 個の日本語は上流のままです。最後の 6 個は D3 と管理コマンドのための新規です。

| コード | EN | JA |
| --- | --- | --- |
| `stream_bad_title` | Write a title of 1 to {max} characters. | 配信のタイトルは 1〜{max}文字 で書いてください。 |
| `stream_bad_url` | The URL must start with https:// or http:// (a full web address). | URL は https:// か http:// で始めてください。 |
| `stream_already_live` | You already have a live panel. Close it first with "End stream". | 配信中のパネルがあります。先に「⏹️ 配信を終える」で閉じてください。 |
| `stream_ended` | This stream has ended. | この配信は終わりました。 |
| `stream_not_streamer` | Only the streamer can do this (or the stream has ended). | これは配信者だけが使えます（または、配信が終わっています）。 |
| `stream_self_tip` | You can't send a super chat to your own stream. | 自分の配信には、スパチャを送れません。 |
| `stream_tip_min` | Super chats start at {min} Pelica. | スパチャは {min}ペリカ から送れます。 |
| `stream_bad_label` | Round names are up to {max} characters. | 勝負の名前は {max}文字 までにしてください。 |
| `stream_round_active` | A round is still undecided. Settle or void it before starting a new one. | 決まっていない勝負があります。勝敗を決めるか、無効にしてから始めてください。 |
| `stream_no_open_round` | Bets are not open right now. | いまは賭けを受け付けていません。 |
| `stream_no_round` | There is no undecided round. | 決まっていない勝負がありません。 |
| `stream_bad_side` | That is not a valid side to bet on. | 賭ける側が正しくありません。 |
| `stream_self_bet` | The streamer can't bet on their own round. | 配信者は、自分の勝負に賭けられません。 |
| `stream_other_side` | You already bet on the other side of this round (you can't switch sides). | この勝負には、もう反対の側に賭けています（側は変えられません）。 |
| `stream_bet_min` | Bets start at {min} Pelica. | 賭けは {min}ペリカ からです。 |
| `stream_bet_max` | You can bet up to {max} Pelica per round (you have already bet {already} Pelica). | 1回の勝負に賭けられるのは、1人 {max}ペリカ までです（いま {already}ペリカ 賭けています）。 |
| `stream_not_locked` | Close the bets first. A win or loss can be declared only after the bets are locked (you can void a round at any time). | 先に「🔒 賭けを締め切る」を押してください。勝敗を決められるのは、賭けを締め切ったあとです（無効にするのは、いつでもできます）。 |
| `stream_round_changed` | That round is no longer the current one. | その勝負は、もう終わっています（いまの勝負ではありません）。 |
| `stream_round_settled` | That round has already paid out, so it cannot be voided. | この勝負は、もう精算が終わっているので、無効にできません。 |
| `stream_debt` | You cannot send super chats or bet while you have Teiai debt. | 借金があるあいだは、スパチャも賭けもできません。 |
| `stream_void_reason` | Write a reason of 1 to {max} characters. | 理由を 1〜{max}文字 で書いてください。 |
| `stream_void_target` | No stream or round matches that id. | その番号の配信も勝負も見つかりません。 |

共通ラベル（Activity とチャット）：`screen.stream.side.win|lose`（`🏆 配信者の勝ち` / `💀 配信者の負け`）、`screen.stream.round.open|locked`（`賭けを受付中` / `締切（勝敗を待っています）`）、`screen.stream.round.default`（`次の勝負`）、`screen.stream.odds`（`（当たれば約 {odds}倍）`）。

チャットの文言は `packages/shared/i18n` の `bot.stream.*` にあります（EN と JA、`pnpm i18n:check` で突き合わせ）：`panel.*`（配信中・終了の見出し、配信者、場所、スパチャ、勝負、勝ち、負け、賭けた人、勝負なし、自動で閉じる、自動の締切、フッター）、`btn.*`（4 つのボタン）、`tip.*`（フォーム、金額、メッセージ、カードの作者、確認の見出し・本文・ボタン、送信後の見出し・本文、エラーの見出し）、`bet.*`（フォーム、金額、完了の見出し・本文、エラーの見出し）、`round.*`（フォーム、名前、開始の見出し・本文、自動の締切のお知らせ）、`menu.*`（見出し、6 つのボタン、配信者だけの案内、締切）、`settle.*`、`end.*`、`result.*`、`help.*`。上流にあった文言の日本語は上流のままです。D3・D4 のための追加（自動の締切の行、オーナーの無効の行、場所のヘルプ）は新規です。管理：`bot.admin.feature.stream`、`bot.admin.streamVoid.title|body|errTitle`。

パネルの並び（日本語、上流）：`🔴 配信中: {title}` / `⏹️ 配信終了: {title}`、`配信者: <@id>`、`📍 場所: <#id>`、`📺 {url}`、`💸 スパチャ **{amount}**（{count}件）`、空行、`🎲 **{label}** ・ 賭けを受付中`、`🏆 勝ち **{amount}** （当たれば約 {x.xx}倍）`、`💀 負け **{amount}** …`、`賭けた人 {n}人`、または `🎲 いまは勝負がありません（配信者が「🎛️ 配信者メニュー」から始めます）`、`このパネルは <t:{ends}:R> に自動で閉じます`。ボタン：`💸 スパチャ`（danger）、`🏆 勝ちに賭ける`（success）、`💀 負けに賭ける`（secondary）、`🎛️ 配信者メニュー`（primary）。配信者メニュー（本人だけに見える、600 秒、配信者だけ）：`🎲 勝負を始める`、`🔒 賭けを締め切る`、`🏆 勝った`、`💀 負けた`、`↩️ 無効にする（全額返す）`、`⏹️ 配信を終える`。勝ち・負け・無効は `勝敗を決めますか？`（`取り消せません。`）で確認、終了は `配信を終えますか？` で確認します。

## 14. データモデル（S1 向け）

S1 がリベースしたときの、次の空き番号のマイグレーションにします。STRICT テーブル、ミリ秒のタイムスタンプ、スノーフレークは TEXT。

- `streams(id, guild_id, streamer_id, title, url, channel_id, message_id, voice_channel_id, started_at, ends_at, ended_at, tips, tip_count, status CHECK live/ended)`。部分ユニーク索引 `(guild_id, streamer_id) WHERE status = 'live'`。`created_vc` はなし。
- `stream_rounds(id, stream_id, guild_id, label, status CHECK open/locked/win/lose/void, created_at, auto_lock_at, locked_at, settled_at)`。`stream_id WHERE status IN ('open','locked')` のユニーク索引。
- `stream_bets(round_id, guild_id, user_id, side CHECK win/lose, amount CHECK > 0, PRIMARY KEY (round_id, user_id))`。
- `stream_round_audit(round_id PK, stream_id, guild_id, streamer_id, label, opened_at, locked_at, ended_at, outcome, cause, actor_id, reason, bettors, win_total, lose_total, rake, refunded, top JSON)`。状態の変更といっしょに書く。

## 15. 持ち込まないもの

上流の自動のボイスチャンネルとチャンネルの管理の権限（D4）、賭けの受付中に勝ち・負けを決められること（D3-1）、利益の上限とサーバーごとのパネル数の上限（採用しない、D3）。上流のまま残すもの：`start` は配信者のアカウントがなければ作ること、機能トグルは精算と終了を止めないこと。
