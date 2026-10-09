import type { BotServerSettingsSnapshot, BotSettingsDefinition } from '@monky/bot-sdk';
import { MusicError } from './errors';
import { cliText } from '../i18n';

export const MUSIC_IDLE_SETTING = 'music_idle_seconds';
export const MUSIC_QUEUE_LIMIT_SETTING = 'music_queue_limit';
export const MUSIC_QUEUE_LIMIT_DEFAULT = 100;
export const MUSIC_QUEUE_LIMIT_MIN = 10;
/** Also the most tracks one playlist read may return. */
export const MUSIC_QUEUE_LIMIT_MAX = 500;

export function defaultMusicIdleSeconds(configured = process.env.MONKY_MUSIC_GRACE_SECONDS): number {
  if (configured === undefined) return 60;
  const seconds = Number(configured);
  if (!/^\d+$/.test(configured) || seconds < 1 || seconds > 600) {
    throw new Error(cliText('MONKY_MUSIC_GRACE_SECONDS deve ser um número inteiro entre 1 e 600.',
      'MONKY_MUSIC_GRACE_SECONDS must be a whole number from 1 to 600.'));
  }
  return seconds;
}

export function musicSettingsDefinition(defaultSeconds: number): BotSettingsDefinition {
  return {
    server: {
      title: 'Music',
      description: 'Playback behavior in this server.',
      fields: [{
        name: MUSIC_IDLE_SETTING,
        type: 'integer',
        label: 'Idle timeout (seconds)',
        description: 'Leave voice after the queue ends or the room stays empty for this long.',
        required: true, min: 1, max: 600, defaultValue: defaultSeconds,
      }, {
        name: MUSIC_QUEUE_LIMIT_SETTING,
        type: 'integer',
        label: 'Queue limit (tracks)',
        description: 'Most upcoming tracks, including pending loads. Lowering it never removes queued tracks.',
        required: true, min: MUSIC_QUEUE_LIMIT_MIN, max: MUSIC_QUEUE_LIMIT_MAX, defaultValue: MUSIC_QUEUE_LIMIT_DEFAULT,
      }],
    },
    localizations: {
      'pt-BR': {
        server: {
          title: 'M\u00fasica',
          description: 'Comportamento da reprodu\u00e7\u00e3o neste servidor.',
          fields: {
            [MUSIC_IDLE_SETTING]: {
              label: 'Tempo de inatividade (segundos)',
              description: 'Sair da voz ap\u00f3s a fila acabar ou a sala ficar vazia por esse tempo.',
            },
            [MUSIC_QUEUE_LIMIT_SETTING]: {
              label: 'Limite da fila (faixas)',
              description: 'M\u00e1ximo de pr\u00f3ximas faixas, incluindo carregamentos. Reduzir o limite nunca remove faixas j\u00e1 na fila.',
            },
          },
        },
      },
    },
  };
}

export function musicIdleMilliseconds(snapshot: BotServerSettingsSnapshot | undefined): number {
  const seconds = snapshot?.values[MUSIC_IDLE_SETTING];
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1 || seconds > 600) {
    throw new MusicError('settings');
  }
  return seconds * 1000;
}

export function musicQueueLimit(snapshot: BotServerSettingsSnapshot | undefined): number {
  const limit = snapshot?.values[MUSIC_QUEUE_LIMIT_SETTING];
  if (typeof limit !== 'number' || !Number.isInteger(limit) ||
      limit < MUSIC_QUEUE_LIMIT_MIN || limit > MUSIC_QUEUE_LIMIT_MAX) {
    throw new MusicError('settings');
  }
  return limit;
}
