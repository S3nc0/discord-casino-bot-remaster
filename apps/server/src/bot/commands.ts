import {
  InteractionContextType,
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';

export type CommandContext = 'guild' | 'dm' | 'any';

export interface CommandChoiceSpec<V extends string | number = string | number> {
  readonly value: V;
  readonly name: string;
  readonly jaName: string;
}

export interface CommandOptionSpec {
  readonly kind: 'string' | 'integer' | 'number' | 'boolean' | 'user' | 'channel' | 'attachment';
  readonly name: string;
  readonly jaName: string;
  readonly description: string;
  readonly jaDescription: string;
  readonly required?: boolean;
  readonly autocomplete?: boolean;
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly choices?: readonly CommandChoiceSpec[];
}

export interface CommandLeafMetadata {
  readonly module: string;
  readonly ephemeral: boolean;
  readonly implemented?: boolean;
}

export interface CommandLeafNode extends CommandLeafMetadata {
  readonly kind: 'leaf';
  readonly name: string;
  readonly jaName: string;
  readonly description: string;
  readonly jaDescription: string;
  readonly context: CommandContext;
  readonly options?: readonly CommandOptionSpec[];
}

export interface SubcommandSpec extends CommandLeafMetadata {
  readonly name: string;
  readonly jaName: string;
  readonly description: string;
  readonly jaDescription: string;
  readonly options?: readonly CommandOptionSpec[];
}

export interface SubcommandGroupSpec {
  readonly kind: 'group';
  readonly name: string;
  readonly jaName: string;
  readonly description: string;
  readonly jaDescription: string;
  readonly subcommands: readonly SubcommandSpec[];
}

export interface CommandGroupNode {
  readonly kind: 'group';
  readonly name: string;
  readonly jaName: string;
  readonly description: string;
  readonly jaDescription: string;
  readonly context: CommandContext;
  readonly ownerOnly?: boolean;
  readonly children: readonly (
    (SubcommandSpec & { readonly kind: 'subcommand' }) | SubcommandGroupSpec
  )[];
}

export type TopLevelCommandSpec = CommandLeafNode | CommandGroupNode;

export interface ResolvedCommandMeta extends CommandLeafMetadata {
  readonly path: string;
  readonly context: CommandContext;
  readonly ownerOnly: boolean;
}

const SYMBOL_CHOICES: readonly CommandChoiceSpec<string>[] = [
  { value: 'cs', name: 'CS Token (cs)', jaName: '🪙 CSトークン' },
  { value: 'teio', name: 'Teio Heavy (teio)', jaName: '🏭 TEIO重工' },
  { value: 'numa', name: 'Numa Bio (numa)', jaName: '🧪 NUMAバイオ' },
  { value: 'gold', name: 'Gold Bullion (gold)', jaName: '🥇 GOLD地金' },
];

const PERIOD_CHOICES: readonly CommandChoiceSpec<string>[] = [
  { value: '1h', name: '1 hour', jaName: '1時間' },
  { value: '6h', name: '6 hours', jaName: '6時間' },
  { value: '24h', name: '24 hours', jaName: '24時間' },
  { value: '7d', name: '7 days', jaName: '7日' },
];

const ROULETTE_KIND_CHOICES: readonly CommandChoiceSpec<string>[] = [
  { value: 'red', name: 'Red (2x)', jaName: '赤（2倍）' },
  { value: 'black', name: 'Black (2x)', jaName: '黒（2倍）' },
  { value: 'even', name: 'Even (2x)', jaName: '偶数（2倍）' },
  { value: 'odd', name: 'Odd (2x)', jaName: '奇数（2倍）' },
  { value: 'low', name: '1-18 (2x)', jaName: '1〜18（2倍）' },
  { value: 'high', name: '19-36 (2x)', jaName: '19〜36（2倍）' },
  { value: 'dozen1', name: '1-12 (3x)', jaName: '1〜12（3倍）' },
  { value: 'dozen2', name: '13-24 (3x)', jaName: '13〜24（3倍）' },
  { value: 'dozen3', name: '25-36 (3x)', jaName: '25〜36（3倍）' },
  { value: 'number', name: 'Straight number (36x)', jaName: 'ストレート（数字・36倍）' },
];

const CASINO_GAME_CHOICES: readonly CommandChoiceSpec<string>[] = [
  { value: 'chinchiro', name: 'Chinchiro', jaName: 'チンチロ' },
  { value: 'pachinko', name: 'Pachinko', jaName: 'パチンコ' },
  { value: 'slots', name: 'Slots', jaName: 'スロット' },
  { value: 'blackjack', name: 'Blackjack', jaName: 'ブラックジャック' },
  { value: 'roulette', name: 'Roulette', jaName: 'ルーレット' },
];

const RTP_GAME_CHOICES: readonly CommandChoiceSpec<string>[] = [
  { value: '*', name: 'All casino games (*)', jaName: 'すべてのカジノゲーム（*）' },
  ...CASINO_GAME_CHOICES,
];

const RTP_LEVEL_CHOICES: readonly CommandChoiceSpec<number>[] = [
  { value: 1, name: '1: Very tight', jaName: '1: かなり渋い' },
  { value: 2, name: '2: Tight', jaName: '2: 渋い' },
  { value: 3, name: '3: Standard (default)', jaName: '3: 標準' },
  { value: 4, name: '4: Loose', jaName: '4: 甘い' },
  { value: 5, name: '5: Very loose', jaName: '5: かなり甘い' },
  { value: 6, name: '6: Generous', jaName: '6: 大盤振る舞い' },
];

const FEATURE_CHOICES: readonly CommandChoiceSpec<string>[] = [
  { value: '*', name: 'All features (*)', jaName: 'すべての機能（*）' },
  { value: 'chinchiro', name: 'Chinchiro', jaName: 'チンチロ' },
  { value: 'pachinko', name: 'Pachinko', jaName: 'パチンコ' },
  { value: 'slot', name: 'Slots', jaName: 'スロット' },
  { value: 'blackjack', name: 'Blackjack', jaName: 'ブラックジャック' },
  { value: 'roulette', name: 'Roulette', jaName: 'ルーレット' },
  { value: 'arena', name: 'Arena', jaName: '闘技場' },
  { value: 'horse', name: 'Horse racing', jaName: '競馬' },
  { value: 'market', name: 'Securities market', jaName: '証券' },
  { value: 'bonds', name: 'Bonds', jaName: '債券' },
  { value: 'kyosai', name: 'Teiai Kyosai', jaName: '帝愛共済' },
  { value: 'loan', name: 'P2P loans', jaName: '個人間融資' },
  { value: 'company', name: 'Companies', jaName: '会社' },
  { value: 'labor', name: 'Underground labor', jaName: '地下作業' },
  { value: 'quiz', name: 'Quiz', jaName: 'クイズ' },
  { value: 'raffle', name: 'Raffle / Lottery', jaName: '抽選' },
  { value: 'poll', name: 'Polls', jaName: '投票' },
  { value: 'p2p', name: 'Player market', jaName: 'P2P市場' },
  { value: 'shop', name: 'Shop', jaName: 'ショップ' },
];

const LANGUAGE_CHOICES: readonly CommandChoiceSpec<string>[] = [
  { value: 'auto', name: 'Automatic (follow Discord)', jaName: '自動（Discord に合わせる）' },
  { value: 'en', name: 'English', jaName: 'English' },
  { value: 'ja', name: 'Japanese (日本語)', jaName: '日本語' },
];

const ANNOUNCE_FLAG_CHOICES: readonly CommandChoiceSpec<number>[] = [
  { value: 1, name: 'Yes (announce)', jaName: 'する' },
  { value: 0, name: 'No (silent)', jaName: 'しない' },
];

const ADMIN_GUILD_OPT: CommandOptionSpec = {
  kind: 'string',
  name: 'guild_id',
  jaName: 'サーバー',
  description: 'Target guild ID (autocomplete)',
  jaDescription: '対象のサーバー（候補から選択）',
  autocomplete: true,
};

const ADMIN_USER_OPT: CommandOptionSpec = {
  kind: 'string',
  name: 'user_id',
  jaName: 'ユーザー',
  description: 'Target user ID or mention (autocomplete)',
  jaDescription: '対象のユーザー（候補から選択またはID）',
  autocomplete: true,
};

const ADMIN_CHANNEL_OPT: CommandOptionSpec = {
  kind: 'string',
  name: 'channel_id',
  jaName: 'チャンネル',
  description: 'Target channel ID (autocomplete)',
  jaDescription: '対象のチャンネル（候補から選択）',
  autocomplete: true,
};

/**
 * Single authoritative registry table for all Discord slash commands (matching `docs/spec/commands.md`).
 * Both command deployment and interaction routing read from this structure.
 */
export const COMMAND_SPECS: readonly TopLevelCommandSpec[] = [
  {
    kind: 'group',
    name: 'pelica',
    jaName: 'ペリカ',
    description: 'Balance, daily bonus, ranking, transfers & Teiai Bank',
    jaDescription: '💴 残高・デイリー・ランキング・送金',
    context: 'guild',
    children: [
      {
        kind: 'subcommand',
        name: 'balance',
        jaName: '残高',
        description: 'Check your (or a member’s) Pelica balance',
        jaDescription: 'いま持っているペリカを見る',
        module: 'economy',
        ephemeral: false,
        implemented: true,
        options: [
          {
            kind: 'user',
            name: 'member',
            jaName: '対象',
            description: 'Member to inspect (defaults to you)',
            jaDescription: '見たい人（空欄なら自分）',
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'daily',
        jaName: 'デイリー',
        description: 'Claim your 6-hour daily Pelica bonus',
        jaDescription: '6時間ごとのデイリーペリカを受け取る',
        module: 'economy',
        ephemeral: false,
      },
      {
        kind: 'subcommand',
        name: 'repay',
        jaName: '返済',
        description: 'Repay debt owed to Teiai Bank',
        jaDescription: '帝愛銀行からの借金を返す',
        module: 'teiai',
        ephemeral: true,
        options: [
          {
            kind: 'integer',
            name: 'amount',
            jaName: '金額',
            description: 'Amount to repay (empty = full balance)',
            jaDescription: '返す金額（空欄で払えるだけ全額）',
            minValue: 1,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'bank',
        jaName: '帝愛',
        description: 'Open Teiai Bank, trust deposits & CDS',
        jaDescription: '帝愛銀行・信託預金・CDSを開く',
        module: 'teiai',
        ephemeral: true,
      },
      {
        kind: 'subcommand',
        name: 'bankrupt',
        jaName: '破産',
        description: 'Declare bankruptcy or request a reset',
        jaDescription: '破産手続き・救済を行う',
        module: 'teiai',
        ephemeral: false,
      },
      {
        kind: 'subcommand',
        name: 'missions',
        jaName: 'ミッション',
        description: 'View today’s missions and claim rewards',
        jaDescription: '今日のミッションと達成状況を見る',
        module: 'economy',
        ephemeral: true,
      },
      {
        kind: 'subcommand',
        name: 'ranking',
        jaName: 'ランキング',
        description: 'View guild net worth and total asset rankings',
        jaDescription: 'このサーバーの純資産・総資産ランキングを見る',
        module: 'economy',
        ephemeral: false,
        options: [
          {
            kind: 'user',
            name: 'member',
            jaName: '内訳',
            description: 'Inspect one member’s asset breakdown',
            jaDescription: '資産の内訳を見たい人',
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'leaderboard',
        jaName: 'ランキング掲示',
        description: 'Pin or stop an auto-updating leaderboard embed',
        jaDescription: '自動更新されるランキング掲示を設定・停止する',
        module: 'economy',
        ephemeral: true,
        options: [
          {
            kind: 'channel',
            name: 'channel',
            jaName: 'チャンネル',
            description: 'Channel to post the live leaderboard',
            jaDescription: 'ランキングを掲示するチャンネル',
          },
          {
            kind: 'boolean',
            name: 'stop',
            jaName: '止める',
            description: 'Set true to stop and remove the board',
            jaDescription: 'True で自動更新を止めて投稿を消す',
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'transfer',
        jaName: '送金',
        description: 'Send Pelica to another member',
        jaDescription: '他のメンバーにペリカを送る',
        module: 'economy',
        ephemeral: false,
        options: [
          {
            kind: 'user',
            name: 'member',
            jaName: '相手',
            description: 'Recipient member',
            jaDescription: '送金先のメンバー',
            required: true,
          },
          {
            kind: 'integer',
            name: 'amount',
            jaName: '金額',
            description: 'Pelica amount to send',
            jaDescription: '送るペリカ',
            required: true,
            minValue: 1,
            maxValue: 1_000_000,
            autocomplete: true,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'history',
        jaName: '履歴',
        description: 'View your recent Pelica ledger history',
        jaDescription: '最近のペリカ増減を見る',
        module: 'economy',
        ephemeral: true,
      },
    ],
  },
  {
    kind: 'group',
    name: 'casino',
    jaName: 'カジノ',
    description: 'Play casino games with Pelica (virtual currency)',
    jaDescription: '🎰 ペリカを賭けて遊ぶ（遊びのゲーム用の仮想通貨です）',
    context: 'guild',
    children: [
      {
        kind: 'subcommand',
        name: 'chinchiro',
        jaName: 'チンチロ',
        description: 'Roll 3 dice against the dealer',
        jaDescription: '🎲 親とサイコロ3つで勝負する',
        module: 'casino',
        ephemeral: false,
        options: [
          {
            kind: 'integer',
            name: 'bet',
            jaName: '賭け金',
            description: 'Pelica to wager (minimum 10)',
            jaDescription: '賭けるペリカ（最低10）',
            required: true,
            minValue: 10,
            autocomplete: true,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'chinchiro-table',
        jaName: 'チンチロ卓',
        description: 'Open a multiplayer Chinchiro table',
        jaDescription: '🎲 みんなで遊べるチンチロ卓を開く',
        module: 'casino',
        ephemeral: false,
        options: [
          {
            kind: 'integer',
            name: 'bet',
            jaName: '賭け金',
            description: 'Table stake per round (minimum 10)',
            jaDescription: '1局の賭け金（最低10）',
            required: true,
            minValue: 10,
            autocomplete: true,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'pachinko',
        jaName: 'パチンコ',
        description: 'Spin the Pelica pachinko machine',
        jaDescription: '🪩 パチンコ台を回す',
        module: 'casino',
        ephemeral: false,
        options: [
          {
            kind: 'integer',
            name: 'bet',
            jaName: '賭け金',
            description: 'Wager per set (minimum 10)',
            jaDescription: '1セットの賭け金（最低10）',
            required: true,
            minValue: 10,
            autocomplete: true,
          },
          {
            kind: 'integer',
            name: 'sets',
            jaName: '回数',
            description: 'Number of sets (1-10)',
            jaDescription: '連続で回すセット数（1〜10）',
            minValue: 1,
            maxValue: 10,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'slots',
        jaName: 'スロット',
        description: 'Pull the 3-reel slot machine',
        jaDescription: '🎰 3リールスロットを回す',
        module: 'casino',
        ephemeral: false,
        options: [
          {
            kind: 'integer',
            name: 'bet',
            jaName: '賭け金',
            description: 'Pelica to wager (minimum 10)',
            jaDescription: '賭けるペリカ（最低10）',
            required: true,
            minValue: 10,
            autocomplete: true,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'blackjack',
        jaName: 'ブラックジャック',
        description: 'Play Blackjack against the dealer',
        jaDescription: '🃏 ディーラーとブラックジャックで勝負する',
        module: 'casino',
        ephemeral: false,
        options: [
          {
            kind: 'integer',
            name: 'bet',
            jaName: '賭け金',
            description: 'Pelica to wager (minimum 10)',
            jaDescription: '賭けるペリカ（最低10）',
            required: true,
            minValue: 10,
            autocomplete: true,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'roulette',
        jaName: 'ルーレット',
        description: 'Bet on colors, parity, dozens or a number',
        jaDescription: '🎡 色・偶奇・範囲・数字に賭ける',
        module: 'casino',
        ephemeral: false,
        options: [
          {
            kind: 'integer',
            name: 'bet',
            jaName: '賭け金',
            description: 'Pelica to wager (minimum 10)',
            jaDescription: '賭けるペリカ（最低10）',
            required: true,
            minValue: 10,
            autocomplete: true,
          },
          {
            kind: 'string',
            name: 'kind',
            jaName: '賭け方',
            description: 'Bet type (color/parity 2x, dozen 3x, straight 36x)',
            jaDescription: '赤黒・偶奇などは2倍、範囲(12個)は3倍、数字ぴったりは36倍',
            required: true,
            choices: ROULETTE_KIND_CHOICES,
          },
          {
            kind: 'integer',
            name: 'number',
            jaName: '数字',
            description: 'Pocket number 0-36 (straight bets only)',
            jaDescription: '「ストレート（数字）」のときだけ 0〜36 を指定',
            minValue: 0,
            maxValue: 36,
          },
        ],
      },
    ],
  },
  {
    kind: 'group',
    name: 'horse',
    jaName: '競馬',
    description: 'Raise racehorses, enter races & buy betting tickets',
    jaDescription: '🏇 競走馬を育てて走らせる・馬券を買う（毎日2回）',
    context: 'guild',
    children: [
      {
        kind: 'subcommand',
        name: 'stable',
        jaName: '厩舎',
        description: 'Manage your racehorses, stats and retirement',
        jaDescription: '自分の馬のステータスや引退を管理する',
        module: 'horse',
        ephemeral: true,
      },
      {
        kind: 'subcommand',
        name: 'card',
        jaName: '出馬表',
        description: 'Inspect today’s race card and place tickets',
        jaDescription: '今日の出馬表を見て馬券を買う',
        module: 'horse',
        ephemeral: true,
      },
    ],
  },
  {
    kind: 'group',
    name: 'arena',
    jaName: '闘技場',
    description: 'Underground arena: daily 1on1 & battle royale betting',
    jaDescription: '🏛️ 地下闘技場（1日1回、1on1・バトロワの両方を開催・NPC戦士に賭ける）',
    context: 'guild',
    children: [
      {
        kind: 'subcommand',
        name: 'tournament',
        jaName: '大会',
        description: 'View today’s arena bracket and bet on fighters',
        jaDescription: '今日の大会カードを見る・戦士に賭ける',
        module: 'arena',
        ephemeral: false,
        options: [
          {
            kind: 'string',
            name: 'format',
            jaName: '形式',
            description: 'Tournament format',
            jaDescription: '大会の形式',
            required: true,
            choices: [
              { value: 'duel', name: '1on1 Duel', jaName: '🥊 1on1' },
              { value: 'royale', name: 'Battle Royale', jaName: '⚔️ バトルロイヤル' },
            ],
          },
        ],
      },
    ],
  },
  {
    kind: 'group',
    name: 'labor',
    jaName: '地下',
    description: 'Underground labor to earn Pelica from zero',
    jaDescription: '⛏ ペリカが尽きたときの、地下の仕事',
    context: 'guild',
    children: [
      {
        kind: 'subcommand',
        name: 'work',
        jaName: '作業',
        description: 'Start mining Pelica and relics underground',
        jaDescription: '地下作業でペリカや発掘品を稼ぐ',
        module: 'labor',
        ephemeral: false,
      },
      {
        kind: 'subcommand',
        name: 'ranking',
        jaName: 'ランキング',
        description: 'View underground labor rankings',
        jaDescription: '地下作業のランキングを見る',
        module: 'labor',
        ephemeral: false,
        options: [
          {
            kind: 'string',
            name: 'period',
            jaName: '期間',
            description: 'Ranking period',
            jaDescription: '集計する期間',
            choices: [
              { value: 'total', name: 'All-time', jaName: '通算' },
              { value: 'today', name: 'Today', jaName: '今日' },
            ],
          },
        ],
      },
    ],
  },
  {
    kind: 'group',
    name: 'quiz',
    jaName: 'クイズ',
    description: 'Answer 4-choice trivia quizzes for Pelica rewards',
    jaDescription: '📰 時事ネタ・豆知識の4択に答えて、正解でペリカをもらう',
    context: 'guild',
    children: [
      {
        kind: 'subcommand',
        name: 'play',
        jaName: '挑戦',
        description: 'Answer a quiz for Pelica',
        jaDescription: 'クイズに挑戦してペリカを稼ぐ',
        module: 'quiz',
        ephemeral: true,
      },
      {
        kind: 'subcommand',
        name: 'post',
        jaName: '出題',
        description: 'Submit a new 4-choice quiz',
        jaDescription: '新しい4択クイズを出題する',
        module: 'quiz',
        ephemeral: true,
      },
      {
        kind: 'subcommand',
        name: 'withdraw',
        jaName: '取り下げ',
        description: 'Withdraw your submitted quiz',
        jaDescription: '自分が出題したクイズを取り下げる',
        module: 'quiz',
        ephemeral: true,
        options: [
          {
            kind: 'integer',
            name: 'quiz_id',
            jaName: '番号',
            description: 'Quiz ID to withdraw',
            jaDescription: '取り下げるクイズの番号',
            required: true,
            autocomplete: true,
          },
        ],
      },
    ],
  },
  {
    kind: 'group',
    name: 'poll',
    jaName: '投票',
    description: 'Create yes/no polls anyone can vote on',
    jaDescription: '🗳️ 誰でも作れる、賛成・反対の投票',
    context: 'guild',
    children: [
      {
        kind: 'subcommand',
        name: 'create',
        jaName: '作成',
        description: 'Create a timed yes/no poll',
        jaDescription: '賛成・反対の投票を作成する',
        module: 'poll',
        ephemeral: false,
        options: [
          {
            kind: 'string',
            name: 'title',
            jaName: '議題',
            description: 'Poll question (up to 200 chars)',
            jaDescription: '投票の議題（200文字まで）',
            required: true,
            minLength: 1,
            maxLength: 200,
          },
          {
            kind: 'string',
            name: 'duration',
            jaName: '期限',
            description: 'Duration (e.g. 30m, 2h, 1d)',
            jaDescription: '締切までの時間（例: 30m, 2h, 1d）',
          },
        ],
      },
    ],
  },
  {
    kind: 'leaf',
    name: 'shop',
    jaName: 'ショップ',
    description: 'Browse, buy & equip items, titles, skins and auctions',
    jaDescription: '🛍️ 景品を見る・買う・身につける（ボタンで操作）',
    context: 'guild',
    module: 'shop',
    ephemeral: true,
  },
  {
    kind: 'group',
    name: 'market',
    jaName: '証券',
    description: 'Trade stocks, margin, options, warrants & bonds',
    jaDescription: '📈 注文・保有・市況・決済（4銘柄と債券。ゲーム内の通貨・現実のお金とは無関係）',
    context: 'guild',
    children: [
      {
        kind: 'subcommand',
        name: 'board',
        jaName: '市況',
        description: 'View current prices and market charts',
        jaDescription: 'いまの相場やチャートを見る',
        module: 'market',
        ephemeral: true,
        options: [
          {
            kind: 'string',
            name: 'symbol',
            jaName: '銘柄',
            description: 'Ticker symbol for chart view',
            jaDescription: 'チャートを見たい銘柄',
            choices: SYMBOL_CHOICES,
          },
          {
            kind: 'string',
            name: 'period',
            jaName: '期間',
            description: 'Chart timeframe',
            jaDescription: 'チャートの期間',
            choices: PERIOD_CHOICES,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'holdings',
        jaName: '保有',
        description: 'View your securities, options and bond holdings',
        jaDescription: '持っている株・ポジション・債券を見る',
        module: 'market',
        ephemeral: true,
      },
      {
        kind: 'subcommand',
        name: 'settle',
        jaName: '決済',
        description: 'Close or settle an open position or bond',
        jaDescription: '持っている建玉・債券を決済する',
        module: 'market',
        ephemeral: false,
        options: [
          {
            kind: 'string',
            name: 'position',
            jaName: 'ポジション',
            description: 'Position to settle',
            jaDescription: '決済するポジション',
            required: true,
            autocomplete: true,
          },
          {
            kind: 'integer',
            name: 'percent',
            jaName: '割合',
            description: 'Percentage to close (1-100)',
            jaDescription: '決済する割合（1〜100%）',
            minValue: 1,
            maxValue: 100,
            autocomplete: true,
          },
        ],
      },
      {
        kind: 'group',
        name: 'order',
        jaName: '注文',
        description: 'Place spot, margin, option, warrant or bond orders',
        jaDescription: '現物・信用・オプション・債券の注文を出す',
        subcommands: [
          {
            name: 'spot',
            jaName: '現物',
            description: 'Buy spot shares or CS tokens',
            jaDescription: '現物株・CSトークンを買う',
            module: 'market',
            ephemeral: false,
            options: [
              {
                kind: 'string',
                name: 'symbol',
                jaName: '銘柄',
                description: 'Ticker symbol',
                jaDescription: '銘柄',
                required: true,
                choices: SYMBOL_CHOICES,
              },
              {
                kind: 'integer',
                name: 'amount',
                jaName: '金額',
                description: 'Pelica amount to spend (10-1,000,000)',
                jaDescription: '買う金額（10〜1,000,000）',
                required: true,
                minValue: 10,
                maxValue: 1_000_000,
                autocomplete: true,
              },
            ],
          },
          {
            name: 'margin',
            jaName: '信用',
            description: 'Open a leveraged long or short margin position',
            jaDescription: 'レバレッジをかけて信用買い・空売りする',
            module: 'market',
            ephemeral: false,
            options: [
              {
                kind: 'string',
                name: 'symbol',
                jaName: '銘柄',
                description: 'Ticker symbol',
                jaDescription: '銘柄',
                required: true,
                choices: SYMBOL_CHOICES,
              },
              {
                kind: 'string',
                name: 'side',
                jaName: '売買',
                description: 'Long or short direction',
                jaDescription: '買いか空売りか',
                required: true,
                choices: [
                  {
                    value: 'long',
                    name: 'Long (profit if price rises)',
                    jaName: '信用買い（上がると利益）',
                  },
                  {
                    value: 'short',
                    name: 'Short (profit if price falls)',
                    jaName: '空売り（下がると利益）',
                  },
                ],
              },
              {
                kind: 'integer',
                name: 'amount',
                jaName: '証拠金',
                description: 'Margin collateral in Pelica (10-10,000,000)',
                jaDescription: '証拠金（10〜10,000,000）',
                required: true,
                minValue: 10,
                maxValue: 10_000_000,
                autocomplete: true,
              },
              {
                kind: 'integer',
                name: 'leverage',
                jaName: 'レバレッジ',
                description: 'Leverage multiplier (1x-5x)',
                jaDescription: 'レバレッジ倍率（1〜5倍）',
                choices: [
                  { value: 1, name: '1x', jaName: '1倍' },
                  { value: 2, name: '2x', jaName: '2倍' },
                  { value: 3, name: '3x', jaName: '3倍' },
                  { value: 5, name: '5x', jaName: '5倍' },
                ],
              },
            ],
          },
          {
            name: 'call',
            jaName: 'コール',
            description: 'Buy a call option (profits on upside)',
            jaDescription: 'コールオプションを買う（上昇で利益）',
            module: 'market',
            ephemeral: false,
            options: [
              {
                kind: 'string',
                name: 'symbol',
                jaName: '銘柄',
                description: 'Ticker symbol',
                jaDescription: '銘柄',
                required: true,
                choices: SYMBOL_CHOICES,
              },
              {
                kind: 'integer',
                name: 'amount',
                jaName: '掛け金',
                description: 'Premium amount (10-10,000,000)',
                jaDescription: '掛け金（10〜10,000,000）',
                required: true,
                minValue: 10,
                maxValue: 10_000_000,
                autocomplete: true,
              },
              {
                kind: 'integer',
                name: 'target',
                jaName: '目標割合',
                description: 'Target move percentage (1-50%)',
                jaDescription: '目標の変動率（1〜50%）',
                minValue: 1,
                maxValue: 50,
              },
            ],
          },
          {
            name: 'put',
            jaName: 'プット',
            description: 'Buy a put option (profits on downside)',
            jaDescription: 'プットオプションを買う（下落で利益）',
            module: 'market',
            ephemeral: false,
            options: [
              {
                kind: 'string',
                name: 'symbol',
                jaName: '銘柄',
                description: 'Ticker symbol',
                jaDescription: '銘柄',
                required: true,
                choices: SYMBOL_CHOICES,
              },
              {
                kind: 'integer',
                name: 'amount',
                jaName: '掛け金',
                description: 'Premium amount (10-10,000,000)',
                jaDescription: '掛け金（10〜10,000,000）',
                required: true,
                minValue: 10,
                maxValue: 10_000_000,
                autocomplete: true,
              },
              {
                kind: 'integer',
                name: 'target',
                jaName: '目標割合',
                description: 'Target move percentage (1-50%)',
                jaDescription: '目標の変動率（1〜50%）',
                minValue: 1,
                maxValue: 50,
              },
            ],
          },
          {
            name: 'pair',
            jaName: 'ペア',
            description: 'Buy a pair warrant between two tickers',
            jaDescription: '2銘柄の優劣を予想するペア・ワラントを買う',
            module: 'market',
            ephemeral: false,
            options: [
              {
                kind: 'string',
                name: 'symbol',
                jaName: '銘柄',
                description: 'Outperforming ticker symbol',
                jaDescription: '勝つと予想する銘柄',
                required: true,
                choices: SYMBOL_CHOICES,
              },
              {
                kind: 'string',
                name: 'counterpart',
                jaName: '相手',
                description: 'Benchmark ticker symbol',
                jaDescription: '比べる相手の銘柄',
                required: true,
                choices: SYMBOL_CHOICES,
              },
              {
                kind: 'integer',
                name: 'amount',
                jaName: '掛け金',
                description: 'Premium amount (10-10,000,000)',
                jaDescription: '掛け金（10〜10,000,000）',
                required: true,
                minValue: 10,
                maxValue: 10_000_000,
                autocomplete: true,
              },
            ],
          },
          {
            name: 'write',
            jaName: '裸売り',
            description: 'Write (sell) a naked call or put option',
            jaDescription: 'オプションを裸売りする（権利を引き受ける）',
            module: 'market',
            ephemeral: false,
            options: [
              {
                kind: 'string',
                name: 'symbol',
                jaName: '銘柄',
                description: 'Ticker symbol',
                jaDescription: '銘柄',
                required: true,
                choices: SYMBOL_CHOICES,
              },
              {
                kind: 'string',
                name: 'kind',
                jaName: '種別',
                description: 'Option kind to write',
                jaDescription: '裸売りする種類',
                required: true,
                choices: [
                  {
                    value: 'call',
                    name: 'Naked Call (loss if rises)',
                    jaName: 'コール裸売り（上がると損）',
                  },
                  {
                    value: 'put',
                    name: 'Naked Put (loss if falls)',
                    jaName: 'プット裸売り（下がると損）',
                  },
                ],
              },
              {
                kind: 'integer',
                name: 'amount',
                jaName: '証拠金',
                description: 'Margin collateral (10-10,000,000)',
                jaDescription: '証拠金（10〜10,000,000）',
                required: true,
                minValue: 10,
                maxValue: 10_000_000,
                autocomplete: true,
              },
              {
                kind: 'integer',
                name: 'target',
                jaName: '目標割合',
                description: 'Strike offset percentage (1-50%)',
                jaDescription: '権利行使の目標割合（1〜50%）',
                minValue: 1,
                maxValue: 50,
              },
            ],
          },
          {
            name: 'bond',
            jaName: '債券',
            description: 'Purchase Teiai standard or junk bonds',
            jaDescription: '通常債・ジャンク債を購入する',
            module: 'bonds',
            ephemeral: false,
            options: [
              {
                kind: 'string',
                name: 'kind',
                jaName: '種類',
                description: 'Bond type',
                jaDescription: '債券の種類',
                required: true,
                choices: [
                  {
                    value: 'normal',
                    name: 'Normal Bond (3d, ~4%, guaranteed)',
                    jaName: '通常債（3日・約4%・元本保証）',
                  },
                  {
                    value: 'junk',
                    name: 'Junk Bond (1d, ~20%, 20% default)',
                    jaName: 'ジャンク債（1日・約20%・20%倒産）',
                  },
                ],
              },
              {
                kind: 'integer',
                name: 'amount',
                jaName: '金額',
                description: 'Principal amount (10-10,000,000)',
                jaDescription: '購入金額（10〜10,000,000）',
                required: true,
                minValue: 10,
                maxValue: 10_000_000,
                autocomplete: true,
              },
            ],
          },
        ],
      },
    ],
  },
  {
    kind: 'group',
    name: 'loan',
    jaName: '貸付',
    description: 'Peer-to-peer Pelica loans with daily simple interest',
    jaDescription: '🤝 ペリカの貸し借り（日割りの単利つき）',
    context: 'guild',
    children: [
      {
        kind: 'subcommand',
        name: 'offer',
        jaName: '提案',
        description: 'Offer a direct loan to another member',
        jaDescription: '相手を指定して貸付を提案する',
        module: 'loan',
        ephemeral: false,
        options: [
          {
            kind: 'user',
            name: 'member',
            jaName: '相手',
            description: 'Borrower member',
            jaDescription: '貸す相手',
            required: true,
          },
          {
            kind: 'integer',
            name: 'principal',
            jaName: '金額',
            description: 'Loan principal (min 100)',
            jaDescription: '元本（100以上）',
            required: true,
            minValue: 100,
            autocomplete: true,
          },
          {
            kind: 'number',
            name: 'rate',
            jaName: '日利',
            description: 'Daily interest rate (%)',
            jaDescription: '日利（%）',
            required: true,
            minValue: 0,
          },
          {
            kind: 'integer',
            name: 'days',
            jaName: '期間',
            description: 'Loan term in days (1-30)',
            jaDescription: '返済期間（1〜30日）',
            required: true,
            minValue: 1,
            maxValue: 30,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'request',
        jaName: '募集',
        description: 'Post an open P2P loan request',
        jaDescription: '誰でも貸せる公開募集を出す',
        module: 'loan',
        ephemeral: false,
        options: [
          {
            kind: 'integer',
            name: 'principal',
            jaName: '金額',
            description: 'Requested principal (min 100)',
            jaDescription: '借りたい金額（100以上）',
            required: true,
            minValue: 100,
          },
          {
            kind: 'number',
            name: 'rate',
            jaName: '日利',
            description: 'Offered daily interest rate (%)',
            jaDescription: '提示する日利（%）',
            required: true,
            minValue: 0,
          },
          {
            kind: 'integer',
            name: 'days',
            jaName: '期間',
            description: 'Loan term in days (1-30)',
            jaDescription: '返済期間（1〜30日）',
            required: true,
            minValue: 1,
            maxValue: 30,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'repay',
        jaName: '返済',
        description: 'Repay an active P2P loan',
        jaDescription: '借りている個人間融資を返済する',
        module: 'loan',
        ephemeral: false,
        options: [
          {
            kind: 'integer',
            name: 'loan_id',
            jaName: '貸付',
            description: 'Loan ID to repay',
            jaDescription: '返済する貸付',
            required: true,
            autocomplete: true,
          },
          {
            kind: 'integer',
            name: 'amount',
            jaName: '金額',
            description: 'Repayment amount (empty = full remaining)',
            jaDescription: '返済金額（空欄で残額すべて）',
            minValue: 1,
            maxValue: 10_000_000,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'list',
        jaName: '一覧',
        description: 'List active loans and open loan requests',
        jaDescription: '進行中の貸付や公開募集の一覧を見る',
        module: 'loan',
        ephemeral: false,
      },
    ],
  },
  {
    kind: 'group',
    name: 'kyosai',
    jaName: '共済',
    description: 'Teiai Kyosai mutual shares, auctions, transfers & motions',
    jaDescription: '🏛️ 帝愛共済（配当と、最後の損の負担・口の競りと譲渡・動議）',
    context: 'guild',
    children: [
      {
        kind: 'subcommand',
        name: 'status',
        jaName: '状況',
        description: 'View Kyosai pool, dividends and your shares',
        jaDescription: '共済の状況・配当・持ち口を見る',
        module: 'kyosai',
        ephemeral: true,
      },
      {
        kind: 'subcommand',
        name: 'bid',
        jaName: '入札',
        description: 'Bid on a Teiai Kyosai unit auction',
        jaDescription: '共済の口に入札する',
        module: 'kyosai',
        ephemeral: true,
        options: [
          {
            kind: 'integer',
            name: 'amount',
            jaName: '金額',
            description: 'Bid amount in Pelica',
            jaDescription: '入札額',
            required: true,
            minValue: 1,
            maxValue: 1_000_000_000,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'offer',
        jaName: '譲渡',
        description: 'Offer Kyosai units to another member',
        jaDescription: '他のメンバーに共済の口を譲る提案を出す',
        module: 'kyosai',
        ephemeral: false,
        options: [
          {
            kind: 'user',
            name: 'member',
            jaName: '相手',
            description: 'Buyer member',
            jaDescription: '譲る相手',
            required: true,
          },
          {
            kind: 'integer',
            name: 'units',
            jaName: '口数',
            description: 'Number of units (1-10,000)',
            jaDescription: '譲る口数（1〜10,000）',
            required: true,
            minValue: 1,
            maxValue: 10_000,
          },
          {
            kind: 'integer',
            name: 'price',
            jaName: '値段',
            description: 'Total sale price in Pelica (0-100,000)',
            jaDescription: '合計の値段（0〜100,000）',
            required: true,
            minValue: 0,
            maxValue: 100_000,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'accept',
        jaName: '受諾',
        description: 'Accept a Kyosai unit transfer offer',
        jaDescription: '届いた共済の譲渡を受ける',
        module: 'kyosai',
        ephemeral: false,
        options: [
          {
            kind: 'integer',
            name: 'offer_id',
            jaName: '番号',
            description: 'Transfer offer ID',
            jaDescription: '譲渡番号',
            required: true,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'cancel',
        jaName: '取消',
        description: 'Cancel your Kyosai unit transfer offer',
        jaDescription: '出した共済の譲渡を取り消す',
        module: 'kyosai',
        ephemeral: true,
        options: [
          {
            kind: 'integer',
            name: 'offer_id',
            jaName: '番号',
            description: 'Transfer offer ID',
            jaDescription: '譲渡番号',
            required: true,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'propose',
        jaName: '提案',
        description: 'Propose a Kyosai interest surcharge motion',
        jaDescription: '共済の上乗せ金利についての動議を提案する',
        module: 'kyosai',
        ephemeral: false,
        options: [
          {
            kind: 'number',
            name: 'premium',
            jaName: '上乗せ金利',
            description: 'Proposed premium rate (0.001-100%)',
            jaDescription: '上乗せする金利（0.001〜100%）',
            required: true,
            minValue: 0.001,
            maxValue: 100,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'vote',
        jaName: '投票',
        description: 'Vote on an active Kyosai governance motion',
        jaDescription: '進行中の共済動議に投票する',
        module: 'kyosai',
        ephemeral: true,
        options: [
          {
            kind: 'string',
            name: 'choice',
            jaName: '賛否',
            description: 'Vote yes or no',
            jaDescription: '賛成か反対か',
            required: true,
            choices: [
              { value: 'yes', name: 'Yes', jaName: '賛成' },
              { value: 'no', name: 'No', jaName: '反対' },
            ],
          },
          {
            kind: 'integer',
            name: 'motion_id',
            jaName: '番号',
            description: 'Motion ID (defaults to current)',
            jaDescription: '動議番号（空欄で現在の動議）',
          },
        ],
      },
    ],
  },
  {
    kind: 'group',
    name: 'company',
    jaName: '会社',
    description: 'Found a Teiai subsidiary, produce goods & take stakes',
    jaDescription: '🏢 会社（帝愛の子会社を作って、製品を売る）',
    context: 'guild',
    children: [
      {
        kind: 'subcommand',
        name: 'found',
        jaName: '設立',
        description: 'Found a new Teiai subsidiary company',
        jaDescription: '新しい子会社を設立する',
        module: 'company',
        ephemeral: false,
        options: [
          {
            kind: 'string',
            name: 'name',
            jaName: '社名',
            description: 'Company name (1-12 characters)',
            jaDescription: '社名（1〜12文字）',
            required: true,
            minLength: 1,
            maxLength: 12,
          },
          {
            kind: 'string',
            name: 'kind',
            jaName: '事業所',
            description: 'Business facility type',
            jaDescription: '事業所の種類',
            required: true,
            choices: [
              { value: 'farm', name: 'Farm', jaName: '🌾 農場' },
              { value: 'mine', name: 'Mine', jaName: '⛏ 採掘場' },
            ],
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'status',
        jaName: '状況',
        description: 'Inspect your company production and funds',
        jaDescription: '自分の会社の生産・資金・維持費を見る',
        module: 'company',
        ephemeral: true,
      },
      {
        kind: 'subcommand',
        name: 'invest',
        jaName: '出資',
        description: 'Invest Pelica into another member’s company',
        jaDescription: '他の人の会社に出資して持分を得る',
        module: 'company',
        ephemeral: false,
        options: [
          {
            kind: 'user',
            name: 'owner',
            jaName: '社長',
            description: 'Company owner',
            jaDescription: '会社の社長',
            required: true,
          },
          {
            kind: 'integer',
            name: 'amount',
            jaName: '金額',
            description: 'Investment amount (min 1,000)',
            jaDescription: '出資額（1,000以上）',
            required: true,
            minValue: 1000,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'dividend',
        jaName: '配当率',
        description: 'Set your company’s profit dividend ratio',
        jaDescription: '会社の配当率を設定する',
        module: 'company',
        ephemeral: true,
        options: [
          {
            kind: 'integer',
            name: 'percent',
            jaName: '割合',
            description: 'Dividend ratio (0-100%)',
            jaDescription: '配当率（0〜100%）',
            required: true,
            minValue: 0,
            maxValue: 100,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'holdings',
        jaName: '持分',
        description: 'View your external company equity stakes',
        jaDescription: '他社への出資持分を見る',
        module: 'company',
        ephemeral: true,
      },
    ],
  },
  {
    kind: 'leaf',
    name: 'help',
    jaName: 'help',
    description: 'Beginner’s guide with interactive topic buttons',
    jaDescription: '📖 はじめての人向けの案内（ボタンでくわしい説明）',
    context: 'any',
    module: 'bot',
    ephemeral: true,
    implemented: true,
  },
  {
    kind: 'leaf',
    name: 'settings',
    jaName: '設定',
    description: 'View or update your personal language and app preferences',
    jaDescription: '⚙️ 言語などの個人設定を確認・変更する',
    context: 'any',
    module: 'settings',
    ephemeral: true,
    implemented: true,
    options: [
      {
        kind: 'string',
        name: 'language',
        jaName: '言語',
        description: 'Preferred language for bot replies and the Activity',
        jaDescription: 'Bot とアクティビティの表示言語',
        choices: LANGUAGE_CHOICES,
      },
    ],
  },
  {
    kind: 'group',
    name: 'admin',
    jaName: '運営',
    description: '[Admin] Bot owner server, economy & event controls (DM only)',
    jaDescription: '[管理者] Bot を使えるサーバーの管理。Bot とのDMで使えます',
    context: 'dm',
    ownerOnly: true,
    children: [
      {
        kind: 'subcommand',
        name: 'grant',
        jaName: '付与',
        description: '[Admin] Credit Pelica to a guild member',
        jaDescription: '[管理者] 指定ユーザーの残高を増やす',
        module: 'admin',
        ephemeral: true,
        options: [
          { ...ADMIN_GUILD_OPT, required: true },
          { ...ADMIN_USER_OPT, required: true },
          {
            kind: 'integer',
            name: 'amount',
            jaName: '金額',
            description: 'Pelica amount to grant (1-10,000,000)',
            jaDescription: '付与する金額（1〜10,000,000）',
            required: true,
            minValue: 1,
            maxValue: 10_000_000,
          },
          {
            kind: 'string',
            name: 'reason',
            jaName: '理由',
            description: 'Optional audit reason',
            jaDescription: '台帳に残す理由（任意）',
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'set-balance',
        jaName: '残高設定',
        description: '[Admin] Set a member balance or debt directly',
        jaDescription: '[管理者] 指定ユーザーの残高または借金を設定する',
        module: 'admin',
        ephemeral: true,
        options: [
          { ...ADMIN_GUILD_OPT, required: true },
          { ...ADMIN_USER_OPT, required: true },
          {
            kind: 'integer',
            name: 'amount',
            jaName: '金額',
            description: 'Target balance (negative sets Teiai debt)',
            jaDescription: '設定後の残高（負数で帝愛の借金を設定）',
            required: true,
            minValue: -1_000_000_000,
            maxValue: 1_000_000_000,
          },
          {
            kind: 'string',
            name: 'reason',
            jaName: '理由',
            description: 'Optional audit reason',
            jaDescription: '台帳に残す理由（任意）',
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'pachinko-stats',
        jaName: 'パチンコ統計',
        description: '[Admin] Compare actual vs expected pachinko payouts',
        jaDescription: '[管理者] パチンコの実測値と期待値を集計する',
        module: 'admin',
        ephemeral: true,
        options: [
          ADMIN_GUILD_OPT,
          {
            kind: 'integer',
            name: 'days',
            jaName: '日数',
            description: 'Lookback window in days (1-365)',
            jaDescription: '集計する日数（1〜365）',
            minValue: 1,
            maxValue: 365,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'click-history',
        jaName: 'クリック履歴',
        description: '[Admin] Inspect hourly underground click diagnostics',
        jaDescription: '[管理者] 地下作業の時間別クリック統計を見る',
        module: 'admin',
        ephemeral: true,
        options: [
          { ...ADMIN_GUILD_OPT, required: true },
          { ...ADMIN_USER_OPT, required: true },
          {
            kind: 'integer',
            name: 'hours',
            jaName: '時間',
            description: 'Hours to inspect (1-336)',
            jaDescription: '確認する時間数（1〜336）',
            minValue: 1,
            maxValue: 336,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'host-race',
        jaName: '競馬開催',
        description: '[Admin] Start an ad-hoc special horse race',
        jaDescription: '[管理者] 特別競馬レースを今すぐ開催する',
        module: 'admin',
        ephemeral: true,
        options: [
          { ...ADMIN_GUILD_OPT, required: true },
          {
            kind: 'integer',
            name: 'entry_min',
            jaName: '申し込み分',
            description: 'Entry window in minutes (1-120)',
            jaDescription: '出走申し込みの受付時間（分・1〜120）',
            minValue: 1,
            maxValue: 120,
          },
          {
            kind: 'integer',
            name: 'bet_min',
            jaName: '発売分',
            description: 'Betting window in minutes (1-120)',
            jaDescription: '馬券の発売時間（分・1〜120）',
            minValue: 1,
            maxValue: 120,
          },
          ADMIN_CHANNEL_OPT,
        ],
      },
      {
        kind: 'subcommand',
        name: 'host-arena',
        jaName: '闘技場開催',
        description: '[Admin] Start or advance the guild arena tournament',
        jaDescription: '[管理者] 闘技場の大会を開催・即決着させる',
        module: 'admin',
        ephemeral: true,
        options: [
          { ...ADMIN_GUILD_OPT, required: true },
          {
            kind: 'boolean',
            name: 'advance',
            jaName: '即決着',
            description: 'Resolve the current round immediately',
            jaDescription: '現在の試合をすぐに決着させる',
          },
          {
            kind: 'string',
            name: 'fmt',
            jaName: '形式',
            description: 'Arena format',
            jaDescription: '大会の形式',
            choices: [
              { value: 'duel', name: '1on1 Duel', jaName: '1on1' },
              { value: 'royale', name: 'Battle Royale', jaName: 'バトルロイヤル' },
            ],
          },
          ADMIN_CHANNEL_OPT,
        ],
      },
      {
        kind: 'subcommand',
        name: 'announce',
        jaName: 'お知らせ',
        description: '[Admin] Post an announcement embed to guilds',
        jaDescription: '[管理者] サーバーにお知らせを投稿する',
        module: 'admin',
        ephemeral: true,
        options: [
          ADMIN_GUILD_OPT,
          {
            kind: 'attachment',
            name: 'image',
            jaName: '画像',
            description: 'Optional announcement image (up to 8MB)',
            jaDescription: '添付する画像（8MBまで）',
          },
          {
            kind: 'string',
            name: 'title',
            jaName: '見出し',
            description: 'Embed title (up to 200 chars)',
            jaDescription: 'お知らせの見出し（200文字まで）',
            maxLength: 200,
          },
          ADMIN_CHANNEL_OPT,
        ],
      },
      {
        kind: 'subcommand',
        name: 'purge-messages',
        jaName: '発言削除',
        description: '[Admin] Delete the bot’s own messages in a channel',
        jaDescription: '[管理者] 指定チャンネルから Bot の発言を削除する',
        module: 'admin',
        ephemeral: true,
        options: [
          { ...ADMIN_GUILD_OPT, required: true },
          { ...ADMIN_CHANNEL_OPT, required: true },
        ],
      },
      {
        kind: 'subcommand',
        name: 'server-list',
        jaName: 'サーバー一覧',
        description: '[Admin] List approved, pending and denied guilds',
        jaDescription: '[管理者] 許可・承認待ち・拒否サーバーの一覧を見る',
        module: 'admin',
        ephemeral: true,
      },
      {
        kind: 'subcommand',
        name: 'server-allow',
        jaName: 'サーバー許可',
        description: '[Admin] Approve a guild to use the casino',
        jaDescription: '[管理者] 指定サーバーでの利用を許可する',
        module: 'admin',
        ephemeral: true,
        options: [
          {
            kind: 'string',
            name: 'guild_id',
            jaName: 'サーバーid',
            description: 'Numeric guild ID',
            jaDescription: '許可するサーバーID',
            required: true,
          },
        ],
      },
      {
        kind: 'subcommand',
        name: 'server-revoke',
        jaName: 'サーバー取消',
        description: '[Admin] Revoke guild approval and leave',
        jaDescription: '[管理者] サーバーの許可を取り消して退出する',
        module: 'admin',
        ephemeral: true,
        options: [
          {
            kind: 'string',
            name: 'guild_id',
            jaName: 'サーバーid',
            description: 'Numeric guild ID',
            jaDescription: '取り消すサーバーID',
            required: true,
          },
        ],
      },
      {
        kind: 'group',
        name: 'event',
        jaName: 'イベント',
        description: '[Admin] Manage manual casino bonus events',
        jaDescription: '[管理者] ボーナスイベントを開始・終了する',
        subcommands: [
          {
            name: 'start',
            jaName: '開始',
            description: '[Admin] Start a manual casino bonus event',
            jaDescription: '[管理者] 手動ボーナスイベントを開始する',
            module: 'admin',
            ephemeral: true,
            options: [
              {
                kind: 'string',
                name: 'game',
                jaName: 'ゲーム',
                description: 'Casino game to boost',
                jaDescription: '対象のカジノゲーム',
                required: true,
                choices: CASINO_GAME_CHOICES,
              },
              {
                kind: 'integer',
                name: 'minutes',
                jaName: '時間',
                description: 'Event duration in minutes (1-180)',
                jaDescription: '開催時間（分・1〜180）',
                minValue: 1,
                maxValue: 180,
              },
              {
                kind: 'integer',
                name: 'boost',
                jaName: '上乗せ率',
                description: 'Net profit boost percentage (1-300%)',
                jaDescription: '勝ち分への上乗せ率（%・1〜300）',
                minValue: 1,
                maxValue: 300,
              },
              ADMIN_GUILD_OPT,
              ADMIN_CHANNEL_OPT,
            ],
          },
          {
            name: 'stop',
            jaName: '終了',
            description: '[Admin] Stop active manual bonus events',
            jaDescription: '[管理者] 開催中の手動イベントを終了する',
            module: 'admin',
            ephemeral: true,
            options: [ADMIN_GUILD_OPT],
          },
        ],
      },
      {
        kind: 'group',
        name: 'rtp',
        jaName: '還元率',
        description: '[Admin] Configure per-guild casino RTP levels',
        jaDescription: '[管理者] サーバー別の還元率レベルを設定・確認する',
        subcommands: [
          {
            name: 'set',
            jaName: '設定',
            description: '[Admin] Set casino RTP level (1-6) for a guild',
            jaDescription: '[管理者] サーバーの還元率レベル（1〜6）を変更する',
            module: 'admin',
            ephemeral: true,
            options: [
              { ...ADMIN_GUILD_OPT, required: true },
              {
                kind: 'string',
                name: 'game',
                jaName: 'ゲーム',
                description: 'Target casino game or * for all',
                jaDescription: '対象のゲーム（* ですべて）',
                required: true,
                choices: RTP_GAME_CHOICES,
              },
              {
                kind: 'integer',
                name: 'level',
                jaName: 'レベル',
                description: 'RTP level (1 tight .. 6 generous)',
                jaDescription: '還元率レベル（1=渋い 〜 6=大盤振る舞い）',
                required: true,
                choices: RTP_LEVEL_CHOICES,
              },
            ],
          },
          {
            name: 'list',
            jaName: '一覧',
            description: '[Admin] List current guild RTP levels',
            jaDescription: '[管理者] 現在の還元率レベル一覧を見る',
            module: 'admin',
            ephemeral: true,
            options: [ADMIN_GUILD_OPT],
          },
        ],
      },
      {
        kind: 'group',
        name: 'feature',
        jaName: '機能',
        description: '[Admin] Pause or resume guild features',
        jaDescription: '[管理者] サーバー内の各機能を停止・再開する',
        subcommands: [
          {
            name: 'off',
            jaName: '停止',
            description: '[Admin] Pause new starts for a feature',
            jaDescription: '[管理者] 指定した機能の新規開始を止める',
            module: 'admin',
            ephemeral: true,
            options: [
              { ...ADMIN_GUILD_OPT, required: true },
              {
                kind: 'string',
                name: 'feature',
                jaName: '機能',
                description: 'Feature key or * for all',
                jaDescription: '止める機能（* ですべて）',
                required: true,
                choices: FEATURE_CHOICES,
              },
            ],
          },
          {
            name: 'on',
            jaName: '再開',
            description: '[Admin] Resume a paused feature',
            jaDescription: '[管理者] 止めている機能を再開する',
            module: 'admin',
            ephemeral: true,
            options: [
              { ...ADMIN_GUILD_OPT, required: true },
              {
                kind: 'string',
                name: 'feature',
                jaName: '機能',
                description: 'Feature key or * for all',
                jaDescription: '再開する機能（* ですべて）',
                required: true,
                choices: FEATURE_CHOICES,
              },
            ],
          },
          {
            name: 'list',
            jaName: '一覧',
            description: '[Admin] Show feature toggle status for guilds',
            jaDescription: '[管理者] 各機能の稼働状況を見る',
            module: 'admin',
            ephemeral: true,
            options: [ADMIN_GUILD_OPT],
          },
        ],
      },
      {
        kind: 'group',
        name: 'raffle',
        jaName: '抽選',
        description: '[Admin] Start, repost or cancel a guild raffle',
        jaDescription: '[管理者] サーバー内の抽選を開催・再掲示・中止する',
        subcommands: [
          {
            name: 'start',
            jaName: '開催',
            description: '[Admin] Start a ticket pool raffle',
            jaDescription: '[管理者] 抽選会を開催する',
            module: 'admin',
            ephemeral: true,
            options: [
              { ...ADMIN_GUILD_OPT, required: true },
              {
                kind: 'integer',
                name: 'fee',
                jaName: '掛金',
                description: 'Entry fee in Pelica (min 500)',
                jaDescription: '参加費（500以上）',
                minValue: 500,
              },
              {
                kind: 'integer',
                name: 'minutes',
                jaName: '募集時間',
                description: 'Entry window in minutes (1-1,440)',
                jaDescription: '募集時間（分・1〜1440）',
                minValue: 1,
                maxValue: 1440,
              },
              ADMIN_CHANNEL_OPT,
            ],
          },
          {
            name: 'repost',
            jaName: '再掲示',
            description: '[Admin] Repost the active raffle panel',
            jaDescription: '[管理者] 開催中の抽選パネルを再掲示する',
            module: 'admin',
            ephemeral: true,
            options: [{ ...ADMIN_GUILD_OPT, required: true }, ADMIN_CHANNEL_OPT],
          },
          {
            name: 'cancel',
            jaName: '中止',
            description: '[Admin] Cancel the active raffle and refund',
            jaDescription: '[管理者] 開催中の抽選を中止して全額返金する',
            module: 'admin',
            ephemeral: true,
            options: [{ ...ADMIN_GUILD_OPT, required: true }],
          },
        ],
      },
      {
        kind: 'group',
        name: 'quiz',
        jaName: 'クイズ',
        description: '[Admin] Manage server trivia quizzes',
        jaDescription: '[管理者] クイズの追加・一括追加・一覧・削除を行う',
        subcommands: [
          {
            name: 'add',
            jaName: '追加',
            description: '[Admin] Open the quiz creation modal',
            jaDescription: '[管理者] モーダルでクイズを1問追加する',
            module: 'admin',
            ephemeral: true,
            options: [
              {
                kind: 'integer',
                name: 'announce',
                jaName: '告知',
                description: 'Announce when added',
                jaDescription: '追加をサーバーに告知するか',
                choices: ANNOUNCE_FLAG_CHOICES,
              },
              ADMIN_GUILD_OPT,
              ADMIN_CHANNEL_OPT,
            ],
          },
          {
            name: 'bulk',
            jaName: '一括追加',
            description: '[Admin] Bulk import quizzes from a UTF-8 file',
            jaDescription: '[管理者] UTF-8 テキストファイルから一括追加する',
            module: 'admin',
            ephemeral: true,
            options: [
              {
                kind: 'attachment',
                name: 'file',
                jaName: 'ファイル',
                description: 'Quiz text file (.txt/.md, up to 200KB)',
                jaDescription: 'クイズファイル（.txt/.md・200KBまで）',
                required: true,
              },
              {
                kind: 'integer',
                name: 'announce',
                jaName: '告知',
                description: 'Announce when imported',
                jaDescription: '追加をサーバーに告知するか',
                choices: ANNOUNCE_FLAG_CHOICES,
              },
              ADMIN_GUILD_OPT,
              ADMIN_CHANNEL_OPT,
            ],
          },
          {
            name: 'list',
            jaName: '一覧',
            description: '[Admin] List registered quizzes',
            jaDescription: '[管理者] 登録されているクイズの一覧を見る',
            module: 'admin',
            ephemeral: true,
          },
          {
            name: 'delete',
            jaName: '削除',
            description: '[Admin] Delete a quiz by ID',
            jaDescription: '[管理者] 指定番号のクイズを削除する',
            module: 'admin',
            ephemeral: true,
            options: [
              {
                kind: 'integer',
                name: 'quiz_id',
                jaName: '番号',
                description: 'Quiz ID to delete',
                jaDescription: '削除するクイズ番号',
                required: true,
              },
            ],
          },
        ],
      },
    ],
  },
];

function contextsFor(context: CommandContext): InteractionContextType[] {
  switch (context) {
    case 'guild':
      return [InteractionContextType.Guild];
    case 'dm':
      return [InteractionContextType.BotDM, InteractionContextType.PrivateChannel];
    case 'any':
      return [
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel,
      ];
  }
}

function addOption(
  builder: SlashCommandBuilder | SlashCommandSubcommandBuilder,
  spec: CommandOptionSpec,
): void {
  const required = spec.required ?? false;
  switch (spec.kind) {
    case 'string':
      builder.addStringOption((opt) => {
        opt
          .setName(spec.name)
          .setNameLocalizations({ ja: spec.jaName })
          .setDescription(spec.description)
          .setDescriptionLocalizations({ ja: spec.jaDescription })
          .setRequired(required);
        if (spec.minLength !== undefined) opt.setMinLength(spec.minLength);
        if (spec.maxLength !== undefined) opt.setMaxLength(spec.maxLength);
        if (spec.autocomplete) opt.setAutocomplete(true);
        if (spec.choices) {
          opt.addChoices(
            ...spec.choices.map((c) => ({
              name: c.name,
              name_localizations: { ja: c.jaName },
              value: String(c.value),
            })),
          );
        }
        return opt;
      });
      return;
    case 'integer':
      builder.addIntegerOption((opt) => {
        opt
          .setName(spec.name)
          .setNameLocalizations({ ja: spec.jaName })
          .setDescription(spec.description)
          .setDescriptionLocalizations({ ja: spec.jaDescription })
          .setRequired(required);
        if (spec.minValue !== undefined) opt.setMinValue(spec.minValue);
        if (spec.maxValue !== undefined) opt.setMaxValue(spec.maxValue);
        if (spec.autocomplete) opt.setAutocomplete(true);
        if (spec.choices) {
          opt.addChoices(
            ...spec.choices.map((c) => ({
              name: c.name,
              name_localizations: { ja: c.jaName },
              value: Number(c.value),
            })),
          );
        }
        return opt;
      });
      return;
    case 'number':
      builder.addNumberOption((opt) => {
        opt
          .setName(spec.name)
          .setNameLocalizations({ ja: spec.jaName })
          .setDescription(spec.description)
          .setDescriptionLocalizations({ ja: spec.jaDescription })
          .setRequired(required);
        if (spec.minValue !== undefined) opt.setMinValue(spec.minValue);
        if (spec.maxValue !== undefined) opt.setMaxValue(spec.maxValue);
        if (spec.autocomplete) opt.setAutocomplete(true);
        if (spec.choices) {
          opt.addChoices(
            ...spec.choices.map((c) => ({
              name: c.name,
              name_localizations: { ja: c.jaName },
              value: Number(c.value),
            })),
          );
        }
        return opt;
      });
      return;
    case 'boolean':
      builder.addBooleanOption((opt) =>
        opt
          .setName(spec.name)
          .setNameLocalizations({ ja: spec.jaName })
          .setDescription(spec.description)
          .setDescriptionLocalizations({ ja: spec.jaDescription })
          .setRequired(required),
      );
      return;
    case 'user':
      builder.addUserOption((opt) =>
        opt
          .setName(spec.name)
          .setNameLocalizations({ ja: spec.jaName })
          .setDescription(spec.description)
          .setDescriptionLocalizations({ ja: spec.jaDescription })
          .setRequired(required),
      );
      return;
    case 'channel':
      builder.addChannelOption((opt) =>
        opt
          .setName(spec.name)
          .setNameLocalizations({ ja: spec.jaName })
          .setDescription(spec.description)
          .setDescriptionLocalizations({ ja: spec.jaDescription })
          .setRequired(required),
      );
      return;
    case 'attachment':
      builder.addAttachmentOption((opt) =>
        opt
          .setName(spec.name)
          .setNameLocalizations({ ja: spec.jaName })
          .setDescription(spec.description)
          .setDescriptionLocalizations({ ja: spec.jaDescription })
          .setRequired(required),
      );
      return;
  }
}

function buildSubcommand(spec: SubcommandSpec): SlashCommandSubcommandBuilder {
  const sub = new SlashCommandSubcommandBuilder()
    .setName(spec.name)
    .setNameLocalizations({ ja: spec.jaName })
    .setDescription(spec.description)
    .setDescriptionLocalizations({ ja: spec.jaDescription });
  for (const option of spec.options ?? []) addOption(sub, option);
  return sub;
}

function buildSubcommandGroup(spec: SubcommandGroupSpec): SlashCommandSubcommandGroupBuilder {
  const group = new SlashCommandSubcommandGroupBuilder()
    .setName(spec.name)
    .setNameLocalizations({ ja: spec.jaName })
    .setDescription(spec.description)
    .setDescriptionLocalizations({ ja: spec.jaDescription });
  for (const sub of spec.subcommands) group.addSubcommand(buildSubcommand(sub));
  return group;
}

/** Build validated discord.js JSON payloads for every top-level command in `COMMAND_SPECS`. */
export function buildSlashCommands(
  specs: readonly TopLevelCommandSpec[] = COMMAND_SPECS,
): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return specs.map((spec) => {
    const builder = new SlashCommandBuilder()
      .setName(spec.name)
      .setNameLocalizations({ ja: spec.jaName })
      .setDescription(spec.description)
      .setDescriptionLocalizations({ ja: spec.jaDescription })
      .setContexts(...contextsFor(spec.context));

    if (spec.kind === 'leaf') {
      for (const option of spec.options ?? []) addOption(builder, option);
      return builder.toJSON();
    }

    for (const child of spec.children) {
      if (child.kind === 'subcommand') {
        builder.addSubcommand(buildSubcommand(child));
      } else {
        builder.addSubcommandGroup(buildSubcommandGroup(child));
      }
    }
    return builder.toJSON();
  });
}

function indexCommandLeaves(): ReadonlyMap<string, ResolvedCommandMeta> {
  const map = new Map<string, ResolvedCommandMeta>();
  for (const top of COMMAND_SPECS) {
    if (top.kind === 'leaf') {
      map.set(top.name, {
        path: top.name,
        context: top.context,
        ownerOnly: false,
        module: top.module,
        ephemeral: top.ephemeral,
        ...(top.implemented !== undefined ? { implemented: top.implemented } : {}),
      });
      continue;
    }

    const ownerOnly = top.ownerOnly ?? false;
    for (const child of top.children) {
      if (child.kind === 'subcommand') {
        const path = `${top.name} ${child.name}`;
        map.set(path, {
          path,
          context: top.context,
          ownerOnly,
          module: child.module,
          ephemeral: child.ephemeral,
          ...(child.implemented !== undefined ? { implemented: child.implemented } : {}),
        });
      } else {
        for (const sub of child.subcommands) {
          const path = `${top.name} ${child.name} ${sub.name}`;
          map.set(path, {
            path,
            context: top.context,
            ownerOnly,
            module: sub.module,
            ephemeral: sub.ephemeral,
            ...(sub.implemented !== undefined ? { implemented: sub.implemented } : {}),
          });
        }
      }
    }
  }
  return map;
}

export const COMMAND_META_BY_PATH: ReadonlyMap<string, ResolvedCommandMeta> = indexCommandLeaves();

/** Extract the canonical space-separated command path from an incoming chat input interaction. */
export function getCommandPath(
  interaction: Pick<ChatInputCommandInteraction, 'commandName' | 'options'>,
): string {
  const group = interaction.options.getSubcommandGroup(false);
  const subcommand = interaction.options.getSubcommand(false);
  return [interaction.commandName, group, subcommand]
    .filter((part): part is string => Boolean(part))
    .join(' ');
}

/** Look up command metadata (context, ownerOnly, ephemeral, module) by path. */
export function getCommandMeta(path: string): ResolvedCommandMeta | undefined {
  return COMMAND_META_BY_PATH.get(path);
}
