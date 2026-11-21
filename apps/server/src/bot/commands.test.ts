import {
  ApplicationCommandOptionType,
  InteractionContextType,
  type APIApplicationCommandOption,
} from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  COMMAND_META_BY_PATH,
  COMMAND_SPECS,
  buildSlashCommands,
  getCommandMeta,
  getCommandPath,
} from './commands.ts';

function assertOptionLocalized(opt: APIApplicationCommandOption, path: string): void {
  expect(opt.name, `${path} option name`).toMatch(/^[a-z0-9_-]{1,32}$/);
  expect(opt.name_localizations?.ja, `${path}.${opt.name} missing ja name`).toBeTruthy();
  expect(opt.name_localizations?.ja?.length ?? 0).toBeLessThanOrEqual(32);

  expect(opt.description.length, `${path}.${opt.name} desc length`).toBeGreaterThan(0);
  expect(opt.description.length, `${path}.${opt.name} desc length`).toBeLessThanOrEqual(100);
  expect(opt.description_localizations?.ja, `${path}.${opt.name} missing ja desc`).toBeTruthy();
  expect(opt.description_localizations?.ja?.length ?? 0).toBeLessThanOrEqual(100);

  if ('choices' in opt && Array.isArray(opt.choices) && opt.choices.length > 0) {
    expect(opt.choices.length, `${path}.${opt.name} max 25 choices`).toBeLessThanOrEqual(25);
    if ('autocomplete' in opt) {
      expect(opt.autocomplete, `${path}.${opt.name} cannot mix choices + autocomplete`).not.toBe(
        true,
      );
    }
    for (const choice of opt.choices) {
      expect(choice.name.length, `${path}.${opt.name} choice len`).toBeGreaterThan(0);
      expect(choice.name.length, `${path}.${opt.name} choice len`).toBeLessThanOrEqual(100);
      expect(
        choice.name_localizations?.ja,
        `${path}.${opt.name} choice ${String(choice.value)} missing ja`,
      ).toBeTruthy();
      expect(choice.name_localizations?.ja?.length ?? 0).toBeLessThanOrEqual(100);
    }
  }
}

function assertRequiredBeforeOptional(
  options: readonly APIApplicationCommandOption[],
  path: string,
): void {
  let seenOptional = false;
  for (const opt of options) {
    const req = 'required' in opt && opt.required === true;
    if (req) {
      expect(seenOptional, `${path}: required option ${opt.name} follows optional option`).toBe(
        false,
      );
    } else {
      seenOptional = true;
    }
  }
}

describe('command registry', () => {
  const jsonCommands = buildSlashCommands();

  it('registers all 15 top-level commands with EN base and JA localizations', () => {
    expect(COMMAND_SPECS).toHaveLength(15);
    expect(jsonCommands).toHaveLength(15);

    const names = jsonCommands.map((c) => [c.name, c.name_localizations?.ja]);
    expect(names).toEqual([
      ['pelica', 'ペリカ'],
      ['casino', 'カジノ'],
      ['horse', '競馬'],
      ['arena', '闘技場'],
      ['labor', '地下'],
      ['quiz', 'クイズ'],
      ['poll', '投票'],
      ['shop', 'ショップ'],
      ['market', '証券'],
      ['loan', '貸付'],
      ['kyosai', '共済'],
      ['company', '会社'],
      ['help', 'help'],
      ['settings', '設定'],
      ['admin', '運営'],
    ]);
  });

  it('snapshots every leaf command path and verifies all options and choices are localized', () => {
    const leafPaths: string[] = [];

    for (const cmd of jsonCommands) {
      expect(cmd.name).toMatch(/^[a-z0-9-]{1,32}$/);
      expect(cmd.name_localizations?.ja).toBeTruthy();
      expect(cmd.name_localizations?.ja?.length ?? 0).toBeLessThanOrEqual(32);
      expect(cmd.description.length).toBeGreaterThan(0);
      expect(cmd.description.length).toBeLessThanOrEqual(100);
      expect(cmd.description_localizations?.ja).toBeTruthy();
      expect(cmd.description_localizations?.ja?.length ?? 0).toBeLessThanOrEqual(100);

      const options = cmd.options ?? [];
      const hasSubcommands = options.some(
        (o) =>
          o.type === ApplicationCommandOptionType.Subcommand ||
          o.type === ApplicationCommandOptionType.SubcommandGroup,
      );

      if (!hasSubcommands) {
        leafPaths.push(cmd.name);
        assertRequiredBeforeOptional(options, cmd.name);
        for (const opt of options) assertOptionLocalized(opt, cmd.name);
        continue;
      }

      expect(options.length, `${cmd.name} child count`).toBeLessThanOrEqual(25);
      for (const child of options) {
        expect(child.name_localizations?.ja).toBeTruthy();
        expect(child.description_localizations?.ja).toBeTruthy();

        if (child.type === ApplicationCommandOptionType.Subcommand) {
          const path = `${cmd.name} ${child.name}`;
          leafPaths.push(path);
          const subOpts = child.options ?? [];
          assertRequiredBeforeOptional(subOpts, path);
          for (const opt of subOpts) assertOptionLocalized(opt, path);
        } else if (child.type === ApplicationCommandOptionType.SubcommandGroup) {
          for (const nested of child.options ?? []) {
            expect(nested.name_localizations?.ja).toBeTruthy();
            expect(nested.description_localizations?.ja).toBeTruthy();
            const path = `${cmd.name} ${child.name} ${nested.name}`;
            leafPaths.push(path);
            const nestedOpts = nested.options ?? [];
            assertRequiredBeforeOptional(nestedOpts, path);
            for (const opt of nestedOpts) assertOptionLocalized(opt, path);
          }
        }
      }
    }

    expect(leafPaths).toEqual([
      'pelica balance',
      'pelica daily',
      'pelica repay',
      'pelica bank',
      'pelica bankrupt',
      'pelica missions',
      'pelica ranking',
      'pelica leaderboard',
      'pelica transfer',
      'pelica history',
      'casino chinchiro',
      'casino chinchiro-table',
      'casino pachinko',
      'casino slots',
      'casino blackjack',
      'casino roulette',
      'horse stable',
      'horse card',
      'arena tournament',
      'labor work',
      'labor ranking',
      'quiz play',
      'quiz post',
      'quiz withdraw',
      'poll create',
      'shop',
      'market board',
      'market holdings',
      'market settle',
      'market order spot',
      'market order margin',
      'market order call',
      'market order put',
      'market order pair',
      'market order write',
      'market order bond',
      'loan offer',
      'loan request',
      'loan repay',
      'loan list',
      'kyosai status',
      'kyosai bid',
      'kyosai offer',
      'kyosai accept',
      'kyosai cancel',
      'kyosai propose',
      'kyosai vote',
      'company found',
      'company status',
      'company invest',
      'company dividend',
      'company holdings',
      'help',
      'settings',
      'admin grant',
      'admin set-balance',
      'admin pachinko-stats',
      'admin click-history',
      'admin host-race',
      'admin host-arena',
      'admin announce',
      'admin purge-messages',
      'admin server-list',
      'admin server-allow',
      'admin server-revoke',
      'admin event start',
      'admin event stop',
      'admin rtp set',
      'admin rtp list',
      'admin feature off',
      'admin feature on',
      'admin feature list',
      'admin raffle start',
      'admin raffle repost',
      'admin raffle cancel',
      'admin quiz add',
      'admin quiz bulk',
      'admin quiz list',
      'admin quiz delete',
    ]);
    expect(COMMAND_META_BY_PATH.size).toBe(leafPaths.length);
  });

  it('sets contexts and ownerOnly metadata accurately', () => {
    const byName = new Map(jsonCommands.map((c) => [c.name, c]));

    expect(byName.get('admin')?.contexts).toEqual([
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ]);
    expect(byName.get('help')?.contexts).toEqual([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ]);
    expect(byName.get('settings')?.contexts).toEqual([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ]);
    expect(byName.get('pelica')?.contexts).toEqual([InteractionContextType.Guild]);
    expect(byName.get('casino')?.contexts).toEqual([InteractionContextType.Guild]);

    expect(getCommandMeta('admin grant')).toMatchObject({
      ownerOnly: true,
      context: 'dm',
      ephemeral: true,
    });
    expect(getCommandMeta('pelica balance')).toMatchObject({
      ownerOnly: false,
      context: 'guild',
      ephemeral: false,
      implemented: true,
    });
    expect(getCommandMeta('help')).toMatchObject({
      context: 'any',
      ephemeral: true,
      implemented: true,
    });
  });

  it('extracts canonical paths from interaction options', () => {
    expect(
      getCommandPath({
        commandName: 'shop',
        options: {
          getSubcommandGroup: () => null,
          getSubcommand: () => null,
        } as never,
      }),
    ).toBe('shop');

    expect(
      getCommandPath({
        commandName: 'market',
        options: {
          getSubcommandGroup: () => 'order',
          getSubcommand: () => 'spot',
        } as never,
      }),
    ).toBe('market order spot');
  });
});
