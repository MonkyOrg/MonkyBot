import type { BotServerSettingsSnapshot, BotSettingsDefinition } from '@monky/bot-sdk';
import { MusicError } from './errors';

export const MUSIC_IDLE_SETTING = 'music_idle_seconds';

export function defaultMusicIdleSeconds(configured = process.env.MONKY_MUSIC_GRACE_SECONDS): number {
  if (configured === undefined) return 60;
  const seconds = Number(configured);
  if (!/^\d+$/.test(configured) || seconds < 1 || seconds > 600) {
    throw new Error('MONKY_MUSIC_GRACE_SECONDS must be a whole number from 1 to 600.');
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
