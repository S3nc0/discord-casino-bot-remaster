import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { PRICE_SCALE, QUANTITY_SCALE } from '@casino/shared';
import { formatPelica, t } from '@casino/shared/i18n';
import {
  MARKET_SYMBOLS,
  optionStrikeMicros,
  shortOptionMarginRequired,
  type SymbolKey,
} from '@casino/domain/finance';
import type { FinanceServices } from '../finance/index.ts';
import { AppError } from '../runtime/errors.ts';
import {
  EPHEMERAL,
  activityRow,
  cid,
  embed,
  formatNumber,
  idemKeyOf,
  reply,
  requireGuild,
  signedPelica,
  unwrapService,
  updateMessage,
  type ChatCtx,
  type ParsedCid,
} from './chat-kit.ts';

function requireFinance(ctx: ChatCtx): FinanceServices {
  if (!ctx.deps.finance) throw new AppError('internal');
  return ctx.deps.finance;
}

const SYMBOL_KEYS: ReadonlySet<string> = new Set(MARKET_SYMBOLS.map((s) => s.key));

function isSymbol(value: string): value is SymbolKey {
  return SYMBOL_KEYS.has(value);
}

const units = (milli: number): string => (milli / QUANTITY_SCALE).toFixed(3);

// ------------------------------------------------------------------ /pelica bankrupt

async function askBankruptcy(
  ctx: ChatCtx,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const { locale } = ctx;
  const finance = requireFinance(ctx);
  const guildId = requireGuild(interaction);
  ctx.deps.economy.ensureMember(guildId, interaction.user.id);
  const debt = finance.teiai.getDebt(guildId, interaction.user.id);
  const e = embed(
    'error',
    t(locale, 'bot.bank.bankrupt.confirmTitle'),
    t(locale, 'bot.bank.bankrupt.confirmBody', { debt: formatPelica(locale, debt) }),
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(cid('bk', 'confirm', interaction.user.id))
      .setLabel(t(locale, 'bot.bank.bankrupt.btnConfirm'))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(cid('bk', 'cancel', interaction.user.id))
      .setLabel(t(locale, 'common.cancel'))
      .setStyle(ButtonStyle.Secondary),
  );
  await reply(interaction, { embeds: [e], components: [row], flags: EPHEMERAL });
}

async function bankruptcyButton(
  ctx: ChatCtx,
  interaction: ButtonInteraction,
  id: ParsedCid,
): Promise<void> {
  const { locale } = ctx;
  // The prompt is ephemeral, but the id names the only person who may press it.
  if (id.args[0] !== interaction.user.id) throw new AppError('forbidden', { reason: 'owner_only' });
  if (id.action === 'cancel') {
    await updateMessage(interaction, {
      embeds: [embed('neutral', t(locale, 'bot.bank.bankrupt.cancelled'))],
      components: [],
    });
    return;
  }
  const finance = requireFinance(ctx);
  const guildId = requireGuild(interaction);
  const report = unwrapService(finance.teiai.declareBankruptcy(guildId, interaction.user.id));
  await updateMessage(interaction, {
    embeds: [embed('neutral', t(locale, 'bot.bank.bankrupt.done'))],
    components: [],
  });
  const e = embed(
    'error',
    t(locale, 'bot.bank.bankrupt.title'),
    t(locale, 'bot.bank.bankrupt.public', { user: `<@${interaction.user.id}>` }),
  ).addFields(
    {
      name: t(locale, 'bot.bank.bankrupt.seized'),
      value: formatPelica(locale, report.seized),
      inline: true,
    },
    {
      name: t(locale, 'bot.bank.bankrupt.paid'),
      value: formatPelica(locale, report.seniorPaid),
      inline: true,
    },
    { name: t(locale, 'bot.label.debt'), value: formatPelica(locale, report.debt), inline: true },
  );
  await reply(interaction, { embeds: [e], components: [activityRow(locale, 'bank')] });
}

// ------------------------------------------------------------------ /market settle

interface PositionChoice {
  id: string;
  label: string;
}

/** What the member holds and can close, as `kind:key` ids (`spot:cs`, `long:cs`, `option:12`, `bond:3`). */
function listPositions(ctx: ChatCtx, guildId: string, userId: string): PositionChoice[] {
  const { locale } = ctx;
  const { stocks } = requireFinance(ctx);
  const out: PositionChoice[] = [];
  for (const s of stocks.getSpotHoldings(guildId, userId)) {
    out.push({
      id: `spot:${s.symbol}`,
      label: t(locale, 'bot.market.pos.spot', {
        symbol: s.symbol.toUpperCase(),
        units: units(s.units_milli),
      }),
    });
  }
  for (const m of stocks.listMarginPositions(guildId, userId)) {
    out.push({
      id: `${m.side}:${m.symbol}`,
      label: t(locale, m.side === 'long' ? 'bot.market.pos.long' : 'bot.market.pos.short', {
        symbol: m.symbol.toUpperCase(),
        units: units(m.units_milli),
      }),
    });
  }
  for (const o of stocks.listOpenOptions(guildId, userId)) {
    out.push({
      id: `option:${o.id}`,
      label: t(
        locale,
        o.side === 'long' ? 'bot.market.pos.optionLong' : 'bot.market.pos.optionShort',
        {
          id: o.id,
          kind: o.kind.toUpperCase(),
          symbol: o.symbol.toUpperCase(),
        },
      ),
    });
  }
  for (const b of stocks.listActiveBonds(guildId, userId)) {
    out.push({
      id: `bond:${b.id}`,
      label: t(locale, 'bot.market.pos.bond', {
        id: b.id,
        principal: formatNumber(locale, b.principal),
      }),
    });
  }
  return out;
}

export async function autocompleteSettle(
  ctx: ChatCtx,
  interaction: AutocompleteInteraction,
): Promise<boolean> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'position' || !ctx.deps.finance || !interaction.guildId) return false;
  const needle = String(focused.value).toLowerCase();
  const choices = listPositions(ctx, interaction.guildId, interaction.user.id)
    .filter((p) => needle === '' || p.id.includes(needle) || p.label.toLowerCase().includes(needle))
    .slice(0, 25)
    .map((p) => ({ name: p.label.slice(0, 100), value: p.id }));
  await interaction.respond(choices);
  return true;
}

async function settlePosition(
  ctx: ChatCtx,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const { locale } = ctx;
  const { stocks } = requireFinance(ctx);
  const guildId = requireGuild(interaction);
  const userId = interaction.user.id;
  ctx.deps.economy.ensureMember(guildId, userId);
  const position = interaction.options.getString('position', true).trim().toLowerCase();
  const percent = interaction.options.getInteger('percent') ?? 100;
  if (percent < 1 || percent > 100) throw new AppError('invalid_payload');
  const [kind, key = ''] = position.split(':');
  const idem = idemKeyOf(interaction);
  const e = embed('success', t(locale, 'bot.market.settle.title'));

  if (kind === 'spot' && isSymbol(key)) {
    const held = stocks.getSpotHoldings(guildId, userId).find((s) => s.symbol === key);
    if (!held) throw new AppError('not_found');
    const sellUnits =
      percent === 100 ? held.units_milli : Math.floor((held.units_milli * percent) / 100);
    const res = unwrapService(
      stocks.sellSpot(guildId, userId, key, sellUnits, undefined, { idempotencyKey: idem }),
    );
    e.setDescription(
      t(locale, 'bot.market.settle.spot', {
        symbol: key.toUpperCase(),
        units: units(res.unitsMilli),
      }),
    ).addFields(
      {
        name: t(locale, 'bot.market.settle.proceeds'),
        value: formatPelica(locale, res.money),
        inline: true,
      },
      { name: t(locale, 'bot.label.fee'), value: formatPelica(locale, res.fee), inline: true },
      {
        name: t(locale, 'bot.market.settle.tax'),
        value: formatPelica(locale, res.tax),
        inline: true,
      },
      {
        name: t(locale, 'bot.label.balance'),
        value: formatPelica(locale, res.balance),
        inline: true,
      },
    );
  } else if ((kind === 'long' || kind === 'short') && isSymbol(key)) {
    const res = unwrapService(
      stocks.closeMargin(guildId, userId, kind, key, undefined, { idempotencyKey: idem, percent }),
    );
    e.setDescription(
      t(locale, 'bot.market.settle.margin', {
        symbol: key.toUpperCase(),
        side: kind.toUpperCase(),
      }),
    ).addFields(
      {
        name: t(locale, 'bot.market.settle.pnl'),
        value: signedPelica(locale, res.pnl),
        inline: true,
      },
      {
        name: t(locale, 'bot.market.settle.returned'),
        value: formatPelica(locale, res.returned),
        inline: true,
      },
      {
        name: t(locale, 'bot.market.settle.tax'),
        value: formatPelica(locale, res.tax),
        inline: true,
      },
    );
    if (res.owed > 0) {
      e.addFields({
        name: t(locale, 'bot.market.settle.owed'),
        value: formatPelica(locale, res.owed),
        inline: true,
      });
    }
  } else if (kind === 'option') {
    const id = Number(key);
    if (!Number.isInteger(id)) throw new AppError('invalid_payload');
    const opt = stocks.listOpenOptions(guildId, userId).find((o) => o.id === id);
    if (!opt) throw new AppError('not_found');
    if (opt.side === 'long') {
      const value = unwrapService(stocks.sellOptionEarly(guildId, userId, id, undefined, idem));
      e.setDescription(t(locale, 'bot.market.settle.optionSold', { id })).addFields({
        name: t(locale, 'bot.market.settle.proceeds'),
        value: formatPelica(locale, value),
        inline: true,
      });
    } else {
      const res = unwrapService(stocks.buybackOption(guildId, userId, id, undefined, idem));
      e.setDescription(t(locale, 'bot.market.settle.optionBought', { id })).addFields(
        {
          name: t(locale, 'bot.market.settle.cost'),
          value: formatPelica(locale, res.cost),
          inline: true,
        },
        {
          name: t(locale, 'bot.market.settle.returned'),
          value: formatPelica(locale, res.marginReturned),
          inline: true,
        },
      );
    }
  } else if (kind === 'bond') {
    const id = Number(key);
    if (!Number.isInteger(id)) throw new AppError('invalid_payload');
    const value = unwrapService(stocks.sellBondEarly(guildId, userId, id, undefined, idem));
    e.setDescription(t(locale, 'bot.market.settle.bondSold', { id })).addFields({
      name: t(locale, 'bot.market.settle.proceeds'),
      value: formatPelica(locale, value),
      inline: true,
    });
  } else {
    throw new AppError('invalid_payload');
  }
  await reply(interaction, { embeds: [e], components: [activityRow(locale, 'market')] });
}

// ------------------------------------------------------------------ /market order write

async function writeNaked(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const { stocks } = requireFinance(ctx);
  const guildId = requireGuild(interaction);
  const userId = interaction.user.id;
  ctx.deps.economy.ensureMember(guildId, userId);
  const symbol = interaction.options.getString('symbol', true);
  const kind = interaction.options.getString('kind', true);
  const margin = interaction.options.getInteger('amount', true);
  const target = interaction.options.getInteger('target');
  if (!isSymbol(symbol) || (kind !== 'call' && kind !== 'put'))
    throw new AppError('invalid_payload');

  // The player gives the collateral to post; the service wants units. Largest size whose margin fits.
  const spot = stocks.getPricesMicros()[symbol];
  const strike = optionStrikeMicros(kind, spot, symbol, target ?? undefined);
  let unitsMilli = Math.floor(
    (margin * QUANTITY_SCALE * PRICE_SCALE) / Math.max(1, Math.round((strike * 20) / 100)),
  );
  while (unitsMilli > 0 && shortOptionMarginRequired(strike, unitsMilli) > margin) unitsMilli -= 1;
  if (unitsMilli <= 0) throw new AppError('invalid_payload', { reason: 'option_too_small' });

  const opt = unwrapService(
    stocks.writeOption({
      guildId,
      userId,
      kind,
      symbol,
      unitsMilli,
      ...(target === null ? {} : { customTargetPct: target }),
      idempotencyKey: idemKeyOf(interaction),
    }),
  );
  const e = embed(
    'success',
    `${t(locale, 'screen.market')} · ${t(locale, 'bot.market.write.title', {
      kind: kind.toUpperCase(),
      symbol: symbol.toUpperCase(),
      id: opt.id,
    })}`,
    t(locale, 'bot.market.write.body'),
  ).addFields(
    {
      name: t(locale, 'bot.market.write.margin'),
      value: formatPelica(locale, opt.margin),
      inline: true,
    },
    {
      name: t(locale, 'bot.market.write.premium'),
      value: formatPelica(locale, opt.premium),
      inline: true,
    },
    {
      name: t(locale, 'bot.market.write.expires'),
      value: `<t:${Math.floor(opt.expires_at / 1000)}:R>`,
      inline: true,
    },
    {
      name: t(locale, 'bot.label.balance'),
      value: formatPelica(locale, ctx.deps.economy.getBalance(guildId, userId)),
      inline: true,
    },
  );
  await reply(interaction, { embeds: [e], components: [activityRow(locale, 'market')] });
}

// ------------------------------------------------------------------ /loan list

async function listLoans(ctx: ChatCtx, interaction: ChatInputCommandInteraction): Promise<void> {
  const { locale } = ctx;
  const { loans } = requireFinance(ctx);
  const guildId = requireGuild(interaction);
  const userId = interaction.user.id;
  const rows = loans.listLoansFor(guildId, userId);
  const e = embed('primary', t(locale, 'screen.loans'));
  if (rows.length === 0) {
    e.setDescription(t(locale, 'bot.loan.none'));
  } else {
    e.setDescription(
      rows
        .map((l) => {
          const lender = l.lender_id === userId;
          const other = lender ? l.borrower_id : l.lender_id;
          const remaining = loans.remainingOf(l);
          const due = l.due_at === null ? '' : ` · <t:${Math.floor(l.due_at / 1000)}:R>`;
          return (
            t(locale, lender ? 'bot.loan.lineLender' : 'bot.loan.lineBorrower', {
              id: l.id,
              user: `<@${other}>`,
              status: t(locale, `bot.loan.status.${l.status}`),
              principal: formatNumber(locale, l.principal),
              rate: (l.rate_bps / 100).toFixed(2),
              days: l.term_days,
              remaining: formatNumber(locale, remaining),
            }) + due
          );
        })
        .join('\n'),
    );
  }
  await reply(interaction, { embeds: [e], components: [activityRow(locale, 'loans')] });
}

// ------------------------------------------------------------------ /company holdings

async function companyHoldings(
  ctx: ChatCtx,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const { locale } = ctx;
  const { companies } = requireFinance(ctx);
  const guildId = requireGuild(interaction);
  const rows = companies.listStakesOf(guildId, interaction.user.id);
  const e = embed('primary', t(locale, 'bot.company.holdingsTitle'));
  if (rows.length === 0) {
    e.setDescription(t(locale, 'bot.company.holdingsNone'));
  } else {
    e.setDescription(
      rows
        .map((r) =>
          t(locale, 'bot.company.holdingLine', {
            owner: `<@${r.ownerId}>`,
            name: r.name,
            level: r.level,
            amount: formatNumber(locale, r.amount),
            value: formatNumber(locale, r.value),
            rate: Math.round(r.dividendRate * 100),
          }),
        )
        .join('\n'),
    );
  }
  await reply(interaction, {
    embeds: [e],
    components: [activityRow(locale, 'companies')],
    flags: EPHEMERAL,
  });
}

// ------------------------------------------------------------------ entry points

export async function handleFinanceCommand(
  ctx: ChatCtx,
  path: string,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  if (!ctx.deps.finance) return false;
  switch (path) {
    case 'pelica bankrupt':
      await askBankruptcy(ctx, interaction);
      return true;
    case 'market settle':
      await settlePosition(ctx, interaction);
      return true;
    case 'market order write':
      await writeNaked(ctx, interaction);
      return true;
    case 'loan list':
      await listLoans(ctx, interaction);
      return true;
    case 'company holdings':
      await companyHoldings(ctx, interaction);
      return true;
    default:
      return false;
  }
}

export async function handleFinanceComponent(
  ctx: ChatCtx,
  interaction: ButtonInteraction,
  id: ParsedCid,
): Promise<boolean> {
  if (id.namespace !== 'bk') return false;
  await bankruptcyButton(ctx, interaction, id);
  return true;
}
