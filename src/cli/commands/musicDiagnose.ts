import { MusicError, musicError } from '../../music/errors';
import { errorDiagnostic, safeDiagnostic, youtubeProviderCause } from '../../music/process';
import { videoUrl, YouTubeSource } from '../../music/source';
import { checkMusicTool, MUSIC_TOOL_NAMES } from '../../music/toolChecks';
import { musicToolPaths } from '../../music/toolPaths';
import { cliText, getCliLocale, initializeCliLanguage } from '../i18n';

export async function musicDiagnoseCommand(args: string[]): Promise<void> {
  if (args.length !== 2 || args[0] !== '--url') {
    throw new Error(cliText('Uso: monkybot music-diagnose --url <vídeo público do YouTube>',
      'Usage: monkybot music-diagnose --url <public YouTube video>'));
  }
  let url: string;
  try { url = videoUrl(args[1]); }
  catch (error: unknown) {
    if (!(error instanceof MusicError)) throw error;
    throw new Error(musicError(error, getCliLocale()), { cause: error });
  }
  await initializeCliLanguage();
  const id = new URL(url).searchParams.get('v');
  const paths = musicToolPaths();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 45_000);
  const cancel = (): void => { controller.abort(); };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  let stage = 'tools';
  console.log(cliText(
    'Diagnóstico limitado a 45 s: apenas metadados públicos; sem baixar/reproduzir mídia, instalar ferramentas ou usar autenticação.',
    '45-second diagnostic: public metadata only; no media download/playback, tool installation, or authentication.'));
  console.log(`platform=${process.platform} arch=${process.arch} botNode=${process.version} videoId=${id}`);
  try {
    for (const tool of ['node', 'ytDlp', 'ffmpeg'] as const) {
      stage = tool;
      const version = await checkMusicTool(tool, paths, controller.signal);
      console.log(`${MUSIC_TOOL_NAMES[tool]}: ${safeDiagnostic(version)}`);
    }
    stage = 'resolve';
    const source = new YouTubeSource(paths.ytDlp, paths.ffmpeg, undefined, paths.node);
    const track = await source.resolve(url, controller.signal);
    console.log(`stage=resolve result=accepted durationSeconds=${track.duration}`);
    console.log(cliText(
      'Metadados e endereço de áudio validados. Isso não comprova transferência de áudio nem funcionamento em outro host.',
      'Metadata and audio address validated. This does not prove audio transfer or operation on another host.'));
  } catch (error: unknown) {
    const failure = timedOut ? new MusicError('timeout', errorDiagnostic(error)) : error;
    const providerCause = stage === 'resolve' ? youtubeProviderCause(failure) : 'UNRESOLVED';
    const reason = providerCause === 'YOUTUBE_BOT_CHALLENGE' ? cliText(
      'O YouTube respondeu com um desafio anti-bot. É uma recusa da aplicação, não evidência de bloqueio geral de saída. ' +
        'O critério de IP/reputação é desconhecido; o acesso ao host de áudio não foi testado. Autenticação e contorno desse desafio não são suportados.',
      'YouTube returned an anti-bot challenge. This is an application-level refusal, not evidence of a general egress block. ' +
        'The IP/reputation criterion is unknown; access to the audio host was not tested. Authentication and bypassing this challenge are not supported.',
    ) : cliText('A causa do provedor não foi confirmada.', 'The provider cause is not confirmed.') +
      (failure instanceof MusicError ? ` ${musicError(failure, getCliLocale())}` : '');
    throw new Error(cliText(
      `Diagnóstico falhou (stage=${stage}, providerCause=${providerCause}). `,
      `Diagnostic failed (stage=${stage}, providerCause=${providerCause}). `) + reason,
    { cause: failure });
  } finally {
    clearTimeout(timer);
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}
