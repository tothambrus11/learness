/** What the audio panel says, as data.
 *
 *  The panel under a word — on its row, its card, its page — and the one
 *  over the whole list say where the voice stands with your own words:
 *  being made, waiting, owed and held for a reason, set aside, or the
 *  download itself. Twelve branches of template decided that, with the same
 *  row written twice for the word and the list and no test drawing any of
 *  them; the moment it showed was one condition and what it showed another,
 *  and a summary panel with nothing owed opened on nothing but its footnote
 *  while the voice loaded. This is the rule, a pure function of the backlog's
 *  state, the voice's, and the panel's own three bits, tested as a table.
 *  `VoiceWork.svelte` draws one shape per kind and decides nothing.
 */
import type { BacklogState } from './backlog.js';
import type { WordKey } from './keys.js';
import type { VoiceStatus } from './tts.js';

/** What the panel is about. */
export interface PanelInput {
  backlog: BacklogState;
  voice: Pick<VoiceStatus, 'phase' | 'text' | 'progress'>;
  /** The one word this panel stands for, or null for the list's. */
  word: { k: WordKey } | null;
  /** The list's panel stays out of the way while only one word is owed:
   *  that word's own row already says so. */
  summary: boolean;
  /** The download was started from this panel, so it is watched here. */
  fetching: boolean;
  /** The question about the download is open here. */
  asking: boolean;
  /** The voice is on this word's own clip now. */
  making: boolean;
  /** The clip cache's cap in MB, or null where it could not be read. */
  capMb: number | null;
}

export type PanelKind =
  | 'download' | 'ask' | 'making' | 'run' | 'loading' | 'held' | 'waiting' | 'full' | 'failed';

/** What to press, if anything: make the owed words (asking first if the
 *  voice is not here), make this word next, call off the press's run, call
 *  off the download, try the words set aside again. */
export type PanelAction = 'make' | 'next' | 'cancel-run' | 'cancel-download' | 'try';

export interface Panel {
  kind: PanelKind;
  /** The sentence; empty for 'ask', whose sentence the template owns. */
  text: string;
  /** The word being made, said in the sentence's own emphasis, on 'run'. */
  emphasis: string;
  /** "3 of 12", on 'run'. */
  count: string;
  warn: boolean;
  spinner: boolean;
  /** 0..1 through the download, on 'download'. */
  progress: number | null;
  action: PanelAction | null;
  actionLabel: string;
  /** The line about words set aside, under the list's panel. */
  failed: string;
}

const PANEL: Panel = {
  kind: 'making', text: '', emphasis: '', count: '', warn: false, spinner: false, progress: null,
  action: null, actionLabel: '', failed: '',
};

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The panel to draw, or null for none. */
export function voicePanel(input: PanelInput): Panel | null {
  const { backlog, voice, word, summary, fetching, asking, making, capMb } = input;
  const loading = voice.phase === 'loading';
  const held = backlog.why === 'on demand' || backlog.why === 'no voice';
  const cap = capMb === null ? '' : ` at ${capMb} MB`;

  if (fetching && loading) {
    return { ...PANEL, kind: 'download', text: `${voice.text || 'preparing the voice'}…`,
      spinner: true, progress: voice.progress || 0, action: 'cancel-download', actionLabel: 'Cancel' };
  }
  if (asking) return { ...PANEL, kind: 'ask' };

  if (word) {
    const owed = backlog.pending[word.k] ?? null;
    const what = owed === 'stale' ? 'Audio is out of date' : 'No audio yet';
    const make = owed === 'stale' ? 'Make it again' : 'Make audio';
    if (making) return { ...PANEL, kind: 'making', text: 'Making audio…', spinner: true };
    if (owed && backlog.why === 'cache full') {
      return { ...PANEL, kind: 'full', warn: true,
        text: `${what} — the audio cache is full${cap}; raise the cap in Settings.` };
    }
    if (owed && loading) {
      return { ...PANEL, kind: 'loading', text: 'Preparing the voice…', spinner: true };
    }
    if (owed && held) {
      return { ...PANEL, kind: 'held', text: what, warn: owed === 'stale',
        action: 'make', actionLabel: make };
    }
    if (owed) {
      return { ...PANEL, kind: 'waiting', text: `${what} · waiting its turn`, warn: owed === 'stale',
        action: 'next', actionLabel: 'Make it next' };
    }
    if (backlog.failed.includes(word.k)) {
      return { ...PANEL, kind: 'failed', text: 'The voice could not make this word.', warn: true,
        action: 'try', actionLabel: 'Try again' };
    }
    return null;
  }

  const count = Object.keys(backlog.pending).length;
  const stale = Object.values(backlog.pending).filter((s) => s === 'stale').length;
  const what = `${count} ${plural(count, 'word', 'words')} ${stale === count ? 'with out-of-date audio' : 'without audio'}`;
  const make = stale === count ? 'Make it again' : 'Make audio';
  const set = backlog.failed.length;
  const failed = set
    ? `${set} could not be made — see What went wrong in Settings.` : '';
  const many = summary ? count > 1 : count > 0;

  let panel: Panel | null = null;
  if (backlog.running) {
    const n = Math.min(backlog.done + 1, backlog.total);
    panel = { ...PANEL, kind: 'run', text: 'Making audio', emphasis: backlog.current?.text ?? '',
      count: backlog.total > 1 ? `${n} of ${backlog.total}` : '', spinner: true,
      action: backlog.manual ? 'cancel-run' : null, actionLabel: backlog.manual ? 'Cancel' : '' };
  } else if (many && loading) {
    panel = { ...PANEL, kind: 'loading', text: 'Preparing the voice…', spinner: true };
  } else if (many && held) {
    panel = { ...PANEL, kind: 'held', text: what, warn: stale > 0, action: 'make', actionLabel: make };
  } else if (many && backlog.why === 'cache full') {
    panel = { ...PANEL, kind: 'full', warn: true,
      text: `${count} ${plural(count, 'word is', 'words are')} waiting: the audio cache is full${cap}. `
        + 'Raise the cap in Settings, or let a card ask for each.' };
  }
  if (panel) return { ...panel, failed };
  if (failed) {
    return { ...PANEL, kind: 'failed', text: failed, warn: true, action: 'try', actionLabel: 'Try again' };
  }
  return null;
}
