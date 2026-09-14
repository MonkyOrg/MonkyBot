import { getCommandPresentation, localizeCommand } from '@monky/bot-sdk';
import { translate, type LocalizedCommandDefinition } from './i18n';
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
    const lines = definitions.map((definition) => {
      const { displayName } = getCommandPresentation(definition, ctx.locale);
      const { description } = localizeCommand(definition, ctx.locale);
      const argumentsText = (definition.options ?? []).map((option) => {
        const names = Object.hasOwn(usageNames, option.name) ? usageNames[option.name] : undefined;
        if (!names) throw new Error(`Missing help placeholder for argument: ${option.name}`);
        const name = translate(ctx.locale, names[0], names[1]);
        return option.required ? `<${name}>` : `[${name}]`;
      });
      const usage = [`/${displayName}`, ...argumentsText].join(' ');
      return `**${usage}** — ${description}`;
    });
    const title = translate(ctx.locale, 'MonkyBot — Comandos', 'MonkyBot — Commands');
    const privacy = translate(ctx.locale,
      'As respostas são privadas. Ao enviar o formulário de enquete, a votação é publicada no canal; o resultado aparece ao encerrar. Música exige estar em voz, inclusive busca, prévia e consultas; se o bot estiver em outra sala, entre nela. O jogo aparece por convite no palco, somente para quem está na mesma sala de voz.',
      'Replies are private. Submitting the poll form publishes voting to the channel; results appear when voting closes. Music requires voice membership, including search, preview and queue queries; if the bot is in another room, join it. The game opens by invitation on the stage, only for people in the same voice room.');
    ctx.reply(`🤖 **${title}**\n\n${lines.join('\n')}\n\n${privacy}`);
  },
};
