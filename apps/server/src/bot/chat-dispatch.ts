import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import {
  adminAutocomplete,
  adminModalSubmit,
  handleAdminCommand,
  handleAdminComponent,
} from './admin-tools.ts';
import { handleCasinoCommand, handleCasinoComponent } from './casino-chat.ts';
import { parseCid, type ChatCtx } from './chat-kit.ts';
import {
  autocompleteSettle,
  handleFinanceCommand,
  handleFinanceComponent,
} from './finance-chat.ts';
import {
  handleProgressCommand,
  handleProgressComponent,
  parseDurationMinutes,
  quizPostSubmit,
} from './progress-chat.ts';

/** Slash commands that used to answer "coming soon". Returns false when nothing handles the path. */
export async function dispatchChatCommand(
  ctx: ChatCtx,
  path: string,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  return (
    (await handleCasinoCommand(ctx, path, interaction)) ||
    (await handleFinanceCommand(ctx, path, interaction)) ||
    (await handleProgressCommand(ctx, path, interaction)) ||
    (await handleAdminCommand(ctx, path, interaction))
  );
}

/** Buttons and select menus carrying a `b:<namespace>:<action>` custom id. */
export async function dispatchChatComponent(
  ctx: ChatCtx,
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<boolean> {
  const id = parseCid(interaction.customId);
  if (!id) return false;
  if (interaction.isButton()) {
    if (await handleCasinoComponent(ctx, interaction, id)) return true;
    if (await handleFinanceComponent(ctx, interaction, id)) return true;
    if (await handleAdminComponent(ctx, interaction, id)) return true;
  }
  return handleProgressComponent(ctx, interaction, id);
}

export async function dispatchChatModal(
  ctx: ChatCtx,
  interaction: ModalSubmitInteraction,
): Promise<boolean> {
  const id = parseCid(interaction.customId);
  if (!id) return false;
  if (id.namespace === 'qzp') {
    await quizPostSubmit(ctx, interaction);
    return true;
  }
  return adminModalSubmit(ctx, interaction, id, (raw) => parseDurationMinutes(raw, 'h'));
}

export async function dispatchChatAutocomplete(
  ctx: ChatCtx,
  interaction: AutocompleteInteraction,
): Promise<boolean> {
  if (interaction.commandName === 'admin' || interaction.commandName === '運営') {
    return adminAutocomplete(ctx, interaction);
  }
  return autocompleteSettle(ctx, interaction);
}
