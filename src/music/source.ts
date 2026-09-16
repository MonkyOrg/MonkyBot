import { YouTubeSource as RuntimeYouTubeSource } from '@monky/bot-sdk/dist/localRuntime';
import { capture, captureBytes } from './process';
import { musicToolPaths } from './toolPaths';

export {
  MUSIC_PREVIEW_DURATION_MS, MAX_SOURCE_RECOVERIES, IncompleteAudioError,
  musicInput, videoUrl, audioUrl, parseTrack,
  type Track, type ResolvedTrack, type AudioStream, type MusicSource,
  type SourceRecoveryNotice, type SourceRecoveryOptions, type PersistentSourceOptions, type SourceOpenOptions,
} from '@monky/bot-sdk/dist/localRuntime';

export class YouTubeSource extends RuntimeYouTubeSource {
  constructor(
    ytDlp = musicToolPaths().ytDlp,
    ffmpeg = musicToolPaths().ffmpeg,
    run = capture,
    node = musicToolPaths().node,
    runBytes = captureBytes,
  ) {
    super({ node, ytDlp, ffmpeg }, { capture: run, captureBytes: runBytes });
  }
}
