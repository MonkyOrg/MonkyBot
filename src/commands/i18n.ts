import type { CommandContext } from '@monky/bot-sdk';

export function translate(locale: CommandContext['locale'], ptBR: string, en: string): string {
  return locale === 'en' ? en : ptBR;
}
