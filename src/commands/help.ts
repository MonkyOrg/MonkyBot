import { getCommandPresentation, localizeCommand, type BotLocale } from '@monky/bot-sdk';
import { message, translate, type LocalizedCommandDefinition } from './i18n';
import { pingCommand } from './ping';
import { diceCommand } from './dice';
import { coinCommand } from './coin';
import { eightBallCommand } from './eightball';
import { pollCommand } from './poll';
import { musicDefinitions } from './music';
import { ticTacToeDefinition } from './ticTacToe';

const usageNames: Readonly<Record<string, readonly [string, string]>> = {
  lados: ['lados', 'sides'],
  pergunta: ['pergunta', 'question'],
  busca: ['busca', 'search'],
  position: ['posição', 'position'],
};

export const helpCommand: LocalizedCommandDefinition = {
  name: 'ajuda',
  description: 'Lista todos os comandos disponíveis do MonkyBot.',
  localizations: {
    'pt-BR': { name: 'ajuda' },
    en: { name: 'help', description: 'List all available MonkyBot commands.' },
  },
  handler: (ctx) => {
    if (ctx.signal.aborted) return;
    const definitions = [pingCommand, diceCommand, coinCommand, eightBallCommand, pollCommand, helpCommand,
      ...musicDefinitions, ticTacToeDefinition];
    const render = (locale: BotLocale): string => {
      const lines = definitions.map((definition) => {
        const { displayName } = getCommandPresentation(definition, locale);
        const { description } = localizeCommand(definition, locale);
        const argumentsText = (definition.options ?? []).map((option) => {
          const names = Object.hasOwn(usageNames, option.name) ? usageNames[option.name] : undefined;
          if (!names) throw new Error(`Missing help placeholder for argument: ${option.name}`);
          const name = translate(locale, names[0], names[1]);
          return option.required ? `<${name}>` : `[${name}]`;
        });
        const usage = [`/${displayName}`, ...argumentsText].join(' ');
        return `**${usage}** — ${description}`;
      });
      const title = translate(locale, 'MonkyBot — Comandos', 'MonkyBot — Commands');
      const privacy = translate(locale,
        'Consultas e erros são privados. Enquetes, resultados e mudanças na reprodução musical aparecem no canal de origem. Música exige estar na mesma sala de voz do bot, inclusive busca e prévia. O jogo aparece por convite no palco, somente para quem está na mesma sala de voz.',
        'Queries and errors are private. Polls, results and music playback changes appear in the originating channel. Music requires membership in the bot’s voice room, including search and preview. Games open by invitation on the stage, only for people in that voice room.');
      return `🤖 **${title}**\n\n${lines.join('\n')}\n\n${privacy}`;
    };
    ctx.reply(message(ctx.locale, render('pt-BR'), render('en')));
  },
};
