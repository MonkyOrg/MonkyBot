import type { BotLocalizedMessage, CommandContext, CommandDefinition, CommandLocalizations } from '@monky/bot-sdk';
import { normalizeCliLocale } from '../cli/i18n';

/** Presentation names are localized; registered command and argument IDs stay canonical. */
export type LocalizedCommandDefinition = CommandDefinition & {
  localizations: CommandLocalizations & {
    'pt-BR': { name: string };
    en: { name: string; description: string };
  };
};

export function translate(locale: CommandContext['locale'], ptBR: string, en: string): string {
  return normalizeCliLocale(locale) === 'en' ? en : ptBR;
}

export function message(locale: CommandContext['locale'], ptBR: string, en: string): BotLocalizedMessage {
  return { content: translate(locale, ptBR, en), localizations: { 'pt-BR': ptBR, en } };
}
