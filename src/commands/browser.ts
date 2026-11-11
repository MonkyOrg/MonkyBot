import { BotRequestError, ProtocolErrorCode } from '@monky/bot-sdk';
import { message, translate, type LocalizedCommandDefinition } from './i18n';
import { errorDiagnostic } from '../music/process';

export const browserCommand: LocalizedCommandDefinition = {
  name: 'browser',
  description: 'Controle um navegador no desktop e compartilhe sua imagem com a sala.',
  localizations: {
    'pt-BR': { name: 'navegador' },
    en: {
      name: 'browser',
      description: 'Host a desktop browser and share its image with your voice room.',
    },
  },
  voiceRequirement: 'joined',
  handler: async ctx => {
    if (ctx.signal.aborted) return;
    try {
      await ctx.createBrowserScreen({ title: translate(ctx.locale, 'Navegador', 'Browser') });
      if (ctx.signal.aborted) return;
      ctx.reply(message(ctx.locale,
        'Miniapp do navegador criado. Você controla no Monky desktop; a sala assiste à imagem quando a transmissão estiver ativa. O estado da transmissão aparece no miniapp. Só esse navegador é capturado, não seu desktop.',
        'Browser miniapp created. You control it in Monky desktop; the room watches its image once streaming is active. The miniapp shows the streaming status. Only this browser is captured, not your desktop.'));
    } catch (error: unknown) {
      if (!ctx.signal.aborted || error !== ctx.signal.reason) {
        console.error('[browser] Could not create browser miniapp.', errorDiagnostic(error));
      }
      if (ctx.signal.aborted) return;
      if (error instanceof BotRequestError && error.code === ProtocolErrorCode.MINIAPP_BROWSER_DESKTOP_REQUIRED) {
        ctx.reply(message(ctx.locale,
          'Use o Monky desktop para controlar e transmitir o navegador. Na web, você pode assistir à transmissão de outro participante.',
          'Use Monky desktop to control and stream the browser. On the web, you can watch another participant’s stream.'));
        return;
      }
      const requiresUpdate = error instanceof BotRequestError && error.code === ProtocolErrorCode.FEATURE_REQUIRES_UPDATE;
      ctx.reply(requiresUpdate
        ? message(ctx.locale,
          'Atualize o servidor Monky para uma versão com suporte ao navegador compartilhado de miniapps.',
          'Update the Monky server to a version supporting shared browser miniapps.')
        : message(ctx.locale,
          'Não foi possível criar o miniapp do navegador. Verifique a conexão, o acesso à sala de voz e a permissão de miniapps.',
          'Could not create the browser miniapp. Check the connection, voice room access and miniapp permission.'));
    }
  },
};
