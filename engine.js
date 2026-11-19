export const modes = {
  chord: {
    name: 'Chord Quality', plural: 'Chord qualities', icon: 'layers',
    prompt: 'What chord quality do you hear?',
    items: [
      ['maj7','Major 7th','maj7',[0,4,7,11],'A major triad with a major seventh.'],
      ['min7','Minor 7th','m7',[0,3,7,10],'A minor triad with a minor seventh.'],
      ['dom7','Dominant 7th','7',[0,4,7,10],'A major triad with a minor seventh. Listen for the tritone between the third and seventh.'],
      ['half','Half-diminished 7th','m7♭5',[0,3,6,10],'A diminished triad with a minor seventh.'],
      ['dim7','Diminished 7th','dim7',[0,3,6,9],'Three stacked minor thirds.'],
      ['minmaj','Minor-major 7th','m(maj7)',[0,3,7,11],'A minor triad with a major seventh.'],
      ['sus7','Dominant 7sus4','7sus4',[0,5,7,10],'The fourth takes the place of the third in a dominant seventh chord.'],
      ['maj','Major triad','Major',[0,4,7],'A major third and a perfect fifth above the root.'],
      ['min','Minor triad','Minor',[0,3,7],'A minor third and a perfect fifth above the root.'],
      ['aug','Augmented triad','Aug',[0,4,8],'Two stacked major thirds.'],
      ['dim','Diminished triad','Dim',[0,3,6],'Two stacked minor thirds.']
    ],
    defaults: ['maj7','min7','dom7','half']
  },
  interval: {
    name: 'Intervals', plural: 'Intervals', icon: 'interval',
    prompt: 'What interval do you hear?',
    items: [
      ['m2','Minor 2nd','m2',[0,1]], ['M2','Major 2nd','M2',[0,2]],
      ['m3','Minor 3rd','m3',[0,3]], ['M3','Major 3rd','M3',[0,4]],
      ['P4','Perfect 4th','P4',[0,5]], ['TT','Tritone','TT',[0,6]],
      ['P5','Perfect 5th','P5',[0,7]], ['m6','Minor 6th','m6',[0,8]],
      ['M6','Major 6th','M6',[0,9]], ['m7','Minor 7th','m7',[0,10]],
      ['M7','Major 7th','M7',[0,11]], ['P8','Octave','P8',[0,12]]
    ],
    defaults: ['m3','M3','P4','P5','m7','M7']
  }
};

export const item = (mode, id) => modes[mode].items.find(entry => entry[0] === id);
export const names = ['C','D♭','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
export const day = 86_400_000;
export const sessionLength = 10;
export const cardKey = (mode, id) => mode + '/' + id;

export function rootsFor(key) {
  return key === 'any' ? names.map((_, index) => index)
    : [0,2,4,5,7,9,11].map(offset => (Number(key) + offset) % 12);
}

export function defaultFilters(mode) {
  return { key: 'any', root: 'any', types: [...modes[mode].defaults], direction: 'ascending' };
}

export function freshState() {
  return {
    version: 1, view: 'practice', mode: 'chord',
    filters: { chord: defaultFilters('chord'), interval: defaultFilters('interval') },
    sessions: { chord: null, interval: null, review: null }, cards: {}, history: []
  };
}

export function dueCards(state, now = Date.now()) {
  return Object.entries(state.cards)
    .filter(([, card]) => card.due <= now)
    .sort((a, b) => a[1].due - b[1].due || b[1].lapses - a[1].lapses)
    .map(([key]) => key);
}

function shuffled(values) {
  return values.map(value => [Math.random(), value]).sort((a,b) => a[0] - b[0]).map(([,value]) => value);
}

function preferredCard(state, mode, ids, previous, now) {
  const pool = ids.length > 1 ? ids.filter(id => id !== previous) : ids;
  const urgent = dueCards(state, now).find(key => pool.some(id => cardKey(mode, id) === key));
  if (urgent) return urgent.split('/')[1];
  const weighted = pool.map(id => {
    const card = state.cards[cardKey(mode, id)];
    return { id, weight: card ? 0.8 + Math.min(5, card.lapses) * .42 + Math.min(1.2, (card.meanSeconds || 0) / 10) : 4 };
  });
  let ticket = Math.random() * weighted.reduce((sum, card) => sum + card.weight, 0);
  return weighted.find(card => (ticket -= card.weight) < 0)?.id ?? pool[0];
}

export function makeQuestion(state, mode, filters, previous, forced) {
  const id = forced ?? preferredCard(state, mode, filters.types, previous, Date.now());
  const entry = item(mode, id);
  const roots = filters.root === 'any' ? rootsFor(filters.key) : [Number(filters.root)];
  const root = 48 + (roots[Math.floor(Math.random() * roots.length)] ?? 0);
  const direction = mode === 'interval' && (filters.direction === 'descending' ||
    (filters.direction === 'mixed' && Math.random() < .5)) ? -1 : 1;
  const tones = entry[3].map(offset => root + direction * offset);
  const selected = shuffled(filters.types.filter(type => type !== id));
  const candidates = modes[mode].items.filter(other => other[0] !== id && !selected.includes(other[0]));
  const distractors = shuffled(candidates.filter(other => other[3].length === entry[3].length));
  const more = shuffled(candidates.filter(other => other[3].length !== entry[3].length));
  const options = shuffled([id, ...[...selected, ...distractors.concat(more).map(other => other[0])].slice(0,3)]);
  return { mode, id, root, direction, tones, options, played: false, elapsed: 0, result: null,
    review: !!forced || (state.cards[cardKey(mode,id)]?.due ?? Infinity) <= Date.now() };
}

export function record(state, question, answer, source, now = Date.now()) {
  const correct = answer === question.id;
  const key = cardKey(question.mode, question.id);
  const previous = state.cards[key] ?? { attempts: 0, streak: 0, lapses: 0, timed: 0, meanSeconds: 0 };
  const seconds = question.played && answer !== null ? Math.round(question.elapsed / 100) / 10 : null;
  const timed = seconds === null ? previous.timed : previous.timed + 1;
  const meanSeconds = seconds === null ? previous.meanSeconds
    : previous.meanSeconds + (seconds - previous.meanSeconds) / timed;
  const early = correct && previous.streak > 0 && previous.due > now;
  const streak = correct ? previous.streak + Number(!early) : 0;
  const spacing = [0,1,3,7,14,30,60,120][Math.min(streak,7)];
  const due = early ? previous.due : correct ? now + spacing * day : now + 10 * 60_000;
  state.cards[key] = {
    attempts: previous.attempts + 1, streak, lapses: previous.lapses + Number(!correct),
    timed, meanSeconds, due
  };
  const result = { at: now, mode: question.mode, id: question.id, root: question.root, answer, correct, seconds, source, due, review: question.review };
  question.result = result;
  state.history.push(result);
  return result;
}

export function midiAnswer(mode, notes) {
  if (mode === 'interval') {
    if (notes.length !== 2) return null;
    const distance = Math.abs(notes[1] - notes[0]);
    return modes.interval.items.find(entry => entry[3][1] === distance)?.[0] ?? 'unrecognized';
  }
  const sorted = [...new Set(notes)].sort((a,b) => a-b);
  if (sorted.length < 3) return null;
  const offsets = [...new Set(sorted.map(note => (note - sorted[0]) % 12))].sort((a,b) => a-b);
  return modes.chord.items.find(entry => entry[3].join() === offsets.join())?.[0] ?? 'unrecognized';
}
