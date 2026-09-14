import type { CommandContext, CommandDefinition, CommandLocalizations } from '@monky/bot-sdk';
import { normalizeCliLocale } from '../cli/i18n';

/** Official commands have Portuguese base text and an English SDK localization. */
export type LocalizedCommandDefinition = CommandDefinition & {
  localizations: CommandLocalizations & { en: { description: string } };
};

export function translate(locale: CommandContext['locale'], ptBR: string, en: string): string {
  return normalizeCliLocale(locale) === 'en' ? en : ptBR;
}
