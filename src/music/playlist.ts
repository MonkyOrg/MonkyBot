import { MusicError, aborted } from './errors';
import { musicInput, playlistLink, type PlaylistLink, type Track } from './source';

export interface PlaylistRead<T extends Track> {
  title: string | null;
  /** The provider's own entry count, when it reports one. */
  total: number | null;
  tracks: T[];
  /** Entries in the read window outside the track policy (over 1 hour, live, private or without a duration). */
  skipped: number;
}

export type MusicSuggestion<T extends Track> =
  { kind: 'track'; track: T; mix?: boolean } |
  { kind: 'playlist'; url: string; album: boolean; title: string | null; total: number | null };

export type PlayRequest =
  { kind: 'playlist'; url: string; album: boolean } |
  { kind: 'url'; value: string; list: PlaylistLink | null } |
  { kind: 'search'; value: string };

export interface MusicLookup<T extends Track> {
  search(query: string): Promise<T[]>;
  resolve(url: string): Promise<T>;
  /** Reads at most `limit` entries of a canonical playlist URL. */
  playlist(url: string, limit: number): Promise<PlaylistRead<T>>;
  /** Whether a probe beside a video can succeed; a pasted playlist link is still read, to explain why not. */
  supportsPlaylists(): boolean;
}

/** YouTube Music albums are ordinary playlists with an `OLAK5uy_` list ID. */
export function isAlbum(url: string): boolean {
  return new URL(url).searchParams.get('list')?.startsWith('OLAK5uy_') === true;
}

/**
 * A playlist page link becomes a playlist request. A video link keeps its list context
 * for suggestions, but plays only the video: the playlist must be chosen explicitly.
 */
export function playRequest(input: unknown): PlayRequest {
  const list = playlistLink(input);
  let single: ReturnType<typeof musicInput>;
  try {
    single = musicInput(input);
  } catch (error: unknown) {
    if (list?.kind === 'playlist') return { kind: 'playlist', url: list.url, album: isAlbum(list.url) };
    if (list?.kind === 'mix') throw new MusicError('mix');
    throw error;
  }
  return single.kind === 'url' ? { kind: 'url', value: single.value, list } : { kind: 'search', value: single.value };
}

function empty(read: PlaylistRead<Track>): boolean {
  return read.total === 0 || (!read.tracks.length && !read.skipped);
}

/**
 * Suggestions for a query. A video link with a playlist offers the video first, then the
 * playlist: confirming while suggestions load picks the first one. Mixes offer only the video.
 */
export async function musicSuggestions<T extends Track>(
  query: unknown,
  signal: AbortSignal,
  lookup: MusicLookup<T>,
): Promise<MusicSuggestion<T>[]> {
  aborted(signal);
  const request = playRequest(query);
  if (request.kind === 'search') {
    return (await lookup.search(request.value)).map((track) => ({ kind: 'track', track }));
  }
  if (request.kind === 'playlist') {
    const read = await lookup.playlist(request.url, 1);
    if (empty(read)) throw new MusicError('playlist_empty');
    return [{ kind: 'playlist', url: request.url, album: request.album, title: read.title, total: read.total }];
  }
  const list = request.list;
  if (list?.kind !== 'playlist' || !lookup.supportsPlaylists()) {
    return [{ kind: 'track', track: await lookup.resolve(request.value), ...(list?.kind === 'mix' ? { mix: true } : {}) }];
  }
  const [video, read] = await Promise.allSettled([lookup.resolve(request.value), lookup.playlist(list.url, 1)]);
  aborted(signal);
  const suggestions: MusicSuggestion<T>[] = [];
  if (video.status === 'fulfilled') suggestions.push({ kind: 'track', track: video.value });
  if (read.status === 'fulfilled' && !empty(read.value)) {
    suggestions.push({
      kind: 'playlist', url: list.url, album: isAlbum(list.url), title: read.value.title, total: read.value.total,
    });
  }
  if (video.status === 'rejected' && !suggestions.length) throw video.reason;
  return suggestions;
}
