import {
  modes, item, names, sessionLength, rootsFor, defaultFilters, freshState,
  dueCards, makeQuestion, record, midiAnswer
} from './engine.js';
import { playAudio, stopAudio } from './audio.js';

const storageKey = 'blue-note-practice-v1';
let state = freshState();
let storageAvailable = true;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved?.version === state.version) state = saved;
} catch {
  storageAvailable = false;
}

const workspace = document.getElementById('workspace');
const midiStatus = document.getElementById('midi-status');
const midiConnect = document.getElementById('midi-connect');
let timer = null;
let playback = 0;
let playing = false;
let audioMessage = '';
let midi;
let midiNotes = [];
let historyLimit = 12;

const icon = name => '<svg aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
const date = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(value);
const fullDate = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(value);
const pickedName = (mode, answer) => answer === null ? 'Skipped' : item(mode, answer)?.[1] ?? 'Unrecognized notes';
const degrees = ['1','♭2','2','♭3','3','4','♭5','5','♯5','6','♭7','7'];
const noteName = note => names[note % 12] + (Math.floor(note / 12) - 1);

function chordToneNames(q) {
  const letters = 'CDEFGAB';
  const naturals = [0,2,4,5,7,9,11];
  const rootLetter = letters.indexOf(names[q.root % 12][0]);
  const steps = [0,q.id === 'sus7' ? 3 : 2,4,6];
  return q.tones.map((note,index) => {
    const position = rootLetter + steps[index];
    const letter = position % 7;
    const octave = Math.floor(q.root / 12) - 1 + Math.floor(position / 7);
    const accidental = note - ((octave + 1) * 12 + naturals[letter]);
    return letters[letter] + (accidental > 0 ? '♯'.repeat(accidental) : '♭'.repeat(-accidental)) + octave;
  });
}

function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); storageAvailable = true; }
  catch { storageAvailable = false; }
}

function newSession(mode) {
  return { completed: 0, correct: 0, timed: 0, seconds: 0,
    size: sessionLength, question: makeQuestion(state, mode, state.filters[mode]) };
}

function currentSession() {
  if (state.view === 'practice') return state.sessions[state.mode] ??= newSession(state.mode);
  if (state.view === 'review') return state.sessions.review;
  return null;
}

function pace(seconds) { return seconds == null ? '—' : seconds.toFixed(1) + ' s'; }
function accuracy(correct, total) { return total ? Math.round(100 * correct / total) + '%' : '—'; }

function heading(title, subtitle) {
  const today = new Intl.DateTimeFormat('en-US',{weekday:'short',month:'short',day:'numeric'}).format(new Date());
  return '<header class="page-head"><div><h1>' + title + '</h1><p>' + subtitle + '</p></div>' +
    '<div class="date-pill">' + icon('calendar') + today + '</div></header>';
}

function title(label, symbol) { return '<h2 class="card-title">' + icon(symbol) + label + '</h2>'; }

function tabs() {
  return '<div class="mode-tabs" role="group" aria-label="Drill type">' + Object.entries(modes).map(([mode, config]) =>
    '<button class="mode-tab" data-mode="' + mode + '" aria-pressed="' + (mode === state.mode) + '">' +
    icon(config.icon) + config.name + '</button>').join('') + '</div>';
}

function wave(reverse) {
  const heights = [6,10,17,11,22,32,21,41,34,55,43,17,31,50,34,24,38,29,16,9];
  return '<div class="wave" aria-hidden="true">' + (reverse ? [...heights].reverse() : heights)
    .map((height, index) => '<i style="--bar:' + height + 'px;--alpha:' + (.43 + (index % 5) * .11) +
      ';--delay:-' + index * 36 + 'ms"></i>').join('') + '</div>';
}

function drill(session) {
  const q = session.question;
  const result = q.result;
  const number = session.completed + Number(!result);
  const track = Array.from({length:session.size}, (_, index) =>
    '<span class="' + (index < session.completed ? 'done' : index === session.completed ? 'current' : '') + '"></span>').join('');
  const answers = q.options.map((id,index) => {
    const expected = result && id === q.id;
    const wrong = result && id === result.answer && !result.correct;
    return '<button class="answer ' + (expected ? 'correct' : wrong ? 'incorrect' : '') + '" data-answer="' + id +
      '"' + (!q.played || result ? ' disabled' : '') + '><kbd>' + (index + 1) + '</kbd><span>' + item(q.mode,id)[1] +
      '</span>' + (expected || wrong ? '<span class="answer-mark">' + icon(expected ? 'check' : 'x') + '</span>' : '') + '</button>';
  }).join('');
  const midiReady = midi && [...midi.inputs.values()].some(input => input.state === 'connected');
  const noteHint = q.mode === 'interval' ? 'Play two notes in sequence.' : 'Play the chord in root position. Any key works.';
  const midiPanel = midiReady && !result
    ? '<div class="midi-answer"><p>' + noteHint + '</p><p aria-live="polite">' +
      (midiNotes.length ? midiNotes.map(noteName).join(' · ') : 'Waiting for notes') +
      '</p><button class="button secondary" data-action="midi-submit"' + (!q.played || !midiAnswer(q.mode,midiNotes) ? ' disabled' : '') +
      '>Submit MIDI answer</button><button class="text-button" data-action="midi-clear">Clear notes</button></div>' : '';
  return '<section class="card drill" aria-label="Listening question">' +
    '<div class="question-status"><span>Question ' + number + ' of ' + session.size + '</span>' +
    '<span class="queue-tag">' + (q.review ? 'Spaced review' : 'Adaptive practice') + '</span></div>' +
    '<div class="progress-track" aria-hidden="true" style="grid-template-columns:repeat(' + session.size + ',1fr)">' + track + '</div>' +
    '<div class="soundstage' + (playing ? ' playing' : '') + '"><p class="sound-label">LISTENING PROMPT</p><h2>' +
    modes[q.mode].prompt + '</h2><div class="sound-controls">' + wave(false) +
    '<button class="play-sound" data-action="play" aria-label="' + (q.played ? 'Replay example' : 'Play example') +
    '" title="' + (q.played ? 'Replay example' : 'Play example') + '">' + icon('play') + '</button>' + wave(true) + '</div>' +
    '<p class="audio-hint">' + (playing ? 'Playing' : q.played ? 'Replay audio' : 'Play audio') + ' <kbd>Space</kbd></p>' +
    (audioMessage ? '<p class="audio-hint" role="status">' + audioMessage + '</p>' : '') + '</div>' +
    '<div class="answers-head"><h3>Select your answer</h3><span>' +
    (result ? 'Answer revealed' : q.played ? 'Use keys 1–4' : 'Listen first, then choose') + '</span></div>' +
    '<div class="answers">' + answers + '</div>' + midiPanel +
    (result ? feedback(q) : '') + '<div class="drill-footer">' +
    (result ? '<span></span><button class="button" data-action="next">' + (session.completed === session.size ? 'See results' : 'Next question') + '</button>' :
      '<button class="text-button" data-action="skip">Skip question</button><span class="filter-status">Space to replay</span>') +
    '</div></section>';
}

function feedback(q) {
  const result = q.result;
  const entry = item(q.mode,q.id);
  const headingText = result.correct ? 'Correct · ' + entry[1] : (result.answer === null ? 'Skipped · ' : 'Answer · ') + entry[1];
  const explanation = q.mode === 'chord'
    ? entry[4] + ' (' + entry[3].map(offset => q.id === 'dim7' && offset === 9 ? '𝄫7' : degrees[offset]).join('–') + ').'
    : entry[3][1] + (entry[3][1] === 1 ? ' semitone' : ' semitones') + (q.direction < 0 ? ' descending.' : ' ascending.');
  return '<div class="feedback" role="status"><strong>' + headingText + '</strong><p>' + explanation + ' ' +
    (q.mode === 'chord' ? chordToneNames(q) : q.tones.map(noteName)).join(' · ') + '</p><p>' + (result.seconds == null ? '' : pace(result.seconds) + ' · ') +
    (result.correct ? 'Next review · ' + scheduleLabel(result.due) : 'Review in 10 minutes') + '</p></div>';
}

function filterSelect(id, label, value, options) {
  return '<div class="field"><label for="filter-' + id + '">' + label + '</label><select id="filter-' + id +
    '" data-filter="' + id + '">' + options.map(([key,text]) => '<option value="' + key + '"' +
      (String(key) === value ? ' selected' : '') + '>' + text + '</option>').join('') +
    '</select>' + icon('chevron') + '</div>';
}

function filters() {
  const mode = state.mode;
  const f = state.filters[mode];
  return '<section class="card side-card">' + title('Drill settings','sliders') +
    '<p class="card-sub">Choose what goes into your practice.</p>' +
    filterSelect('key','Key',f.key,[['any','All keys'], ...names.map((name,i) => [i, name + ' major'])]) +
    filterSelect('root',mode === 'chord' ? 'Root note' : 'Starting note',f.root,
      [['any', 'Any note'], ...rootsFor(f.key).map(i => [i,names[i]])]) +
    (mode === 'interval' ? filterSelect('direction','Direction',f.direction,
      [['ascending','Ascending'],['descending','Descending'],['mixed','Mixed']]) : '') +
    '<div class="controls-label" id="type-label">' + (mode === 'chord' ? 'Chord types' : 'Interval types') + '</div>' +
    '<div class="filter-toggles" role="group" aria-labelledby="type-label">' + modes[mode].items.map(([id,label,short]) =>
      '<button class="chip" data-type="' + id + '" title="' + label + '" aria-label="' + label + '" aria-pressed="' +
      f.types.includes(id) + '">' + short + '</button>').join('') + '</div>' +
    '<div class="filter-footer"><span class="filter-status" role="status">' + f.types.length + ' selected</span>' +
    '<button class="text-button" data-action="reset-filters">Reset defaults</button></div></section>';
}

function metric(symbol, label, value) {
  return '<div class="metric-row">' + icon(symbol) + '<span>' + label + '</span><strong>' + value + '</strong></div>';
}

function sessionMetrics(s) {
  return '<section class="card side-card data-card">' + title('This session','chart') +
    metric('target','Accuracy',accuracy(s.correct,s.completed)) +
    metric('clock','Avg. response',pace(s.timed ? s.seconds / s.timed : null)) +
    metric('check','Answered',s.completed + ' / ' + s.size) + '</section>' +
    '<p class="storage-status">' + icon(storageAvailable ? 'check' : 'x') +
    (storageAvailable ? 'Progress saved in this browser' : 'Browser storage is unavailable') + '</p>';
}

function complete(s, review) {
  return '<section class="card complete">' + icon('check') + '<h2>' + (review ? 'Review complete' : 'Session complete') +
    '</h2><p>' + s.correct + ' of ' + s.completed + ' correct · ' +
    pace(s.timed ? s.seconds / s.timed : null) + ' average response</p><button class="button" data-action="' +
    (review ? 'finish-review' : 'new-session') + '">' + (review ? 'Back to review queue' : 'Start another session') + '</button></section>';
}

function renderPractice() {
  const s = currentSession();
  return heading('Practice','Train your ear, one question at a time.') + '<div class="layout"><div class="stack">' +
    tabs() + (s.question ? drill(s) : complete(s,false)) + '</div><aside class="stack">' +
    filters() + '<div>' + sessionMetrics(s) + '</div></aside></div>';
}

function scheduleLabel(due) {
  const remainder = due - Date.now();
  if (remainder <= 0) return 'Due now';
  if (remainder < 60 * 60_000) return 'In ' + Math.ceil(remainder / 60_000) + ' min';
  return fullDate(due);
}

function renderReview() {
  const s = currentSession();
  const header = heading('Review','Revisit what you’ve heard with spaced repetition.');
  if (s) return header + '<div class="layout"><div class="stack">' + (s.question ? drill(s) : complete(s,true)) +
    '</div><aside class="stack">' + sessionMetrics(s) + '</aside></div>';
  const due = dueCards(state);
  const scheduled = Object.entries(state.cards).sort((a,b) => a[1].due - b[1].due);
  return header + '<div class="stack"><div class="review-grid">' + Object.entries(modes).map(([mode,config]) =>
    '<section class="card review-card">' + title(config.plural,config.icon) + '<strong class="stat-value">' +
    due.filter(key => key.startsWith(mode + '/')).length + '</strong><p class="stat-caption">Due for review</p></section>').join('') +
    '</div><section class="card ' + (due.length ? 'complete' : 'empty') + '">' + icon('repeat') + '<h2>' +
    (due.length ? 'Your review is ready' : 'You’re caught up') + '</h2><p>' +
    (due.length ? 'Work through your due chord qualities and intervals, one at a time.' :
      scheduled.length ? 'Your next review is ' + scheduleLabel(scheduled[0][1].due).toLowerCase() + '.' :
        'Complete a practice question to start building your review schedule.') + '</p><button class="button" ' +
    (due.length ? 'data-action="start-review">Start due reviews' : 'data-view="practice">Go to practice') + '</button></section>' +
    (scheduled.length ? '<section class="card list-card">' + title('Review schedule','calendar') + '<ul class="data-list">' +
      scheduled.map(([key,card]) => {
        const [mode,id] = key.split('/');
        return '<li><strong>' + item(mode,id)[1] + '</strong><span class="right">' + scheduleLabel(card.due) + '</span></li>';
      }).join('') + '</ul></section>' : '') + '</div>';
}

function stat(label, symbol, value, caption) {
  return '<section class="card stat-card">' + title(label,symbol) + '<strong class="stat-value">' + value +
    '</strong><p class="stat-caption">' + caption + '</p></section>';
}

function chart(history) {
  if (!history.length) return '<p class="card-sub">Daily accuracy will appear after your first answer.</p>';
  const today = new Date();
  const label = new Intl.DateTimeFormat('en-US',{weekday:'short'});
  return '<ul class="chart" aria-label="Daily accuracy for the last seven days">' + Array.from({length:7}, (_, index) => {
    const start = new Date(today.getFullYear(),today.getMonth(),today.getDate() - 6 + index);
    const end = new Date(start.getFullYear(),start.getMonth(),start.getDate()+1);
    const attempts = history.filter(h => h.at >= +start && h.at < +end);
    const value = accuracy(attempts.filter(h => h.correct).length,attempts.length);
    const description = attempts.length ? value + ' on ' + attempts.length + ' questions' : 'No attempts';
    return '<li aria-label="' + date(start) + ', ' + description + '" title="' + description +
      '"><div class="bar-well" style="--height:' + (attempts.length ? value : '0%') + '"><span></span></div>' +
      '<span>' + label.format(start) + (attempts.length ? '<br>' + value : '') + '</span></li>';
  }).join('') + '</ul>';
}

function renderProgress() {
  const history = state.history;
  const timed = history.filter(h => h.seconds !== null);
  const misses = new Map();
  for (const h of history) {
    if (h.correct || h.answer === null) continue;
    const key = h.mode + '/' + h.id + '/' + h.answer;
    const existing = misses.get(key) ?? { ...h, count: 0 };
    existing.count += 1;
    misses.set(key,existing);
  }
  const common = [...misses.values()].sort((a,b) => b.count-a.count).slice(0,8);
  const recent = history.slice().reverse().slice(0,historyLimit);
  return heading('Progress','See your accuracy, recall speed, and recurring mix-ups.') +
    '<div class="stack"><div class="stat-grid">' +
    stat('Accuracy','target',accuracy(history.filter(h => h.correct).length,history.length),'All practice and review') +
    stat('Avg. response','clock',pace(timed.length ? timed.reduce((sum,h) => sum + h.seconds,0) / timed.length : null),'From first playback') +
    stat('Questions','check',history.length,dueCards(state).length + ' due for review') +
    '</div><section class="card list-card">' + title('Last 7 days','chart') + chart(history) + '</section>' +
    '<section class="card list-card">' + title('Common mix-ups','target') +
    (common.length ? '<ul class="data-list">' + common.map(h => '<li><div><strong>' + item(h.mode,h.id)[1] +
      '</strong><small>Answered ' + pickedName(h.mode,h.answer) + '</small></div><span class="right">' +
      h.count + (h.count === 1 ? ' time' : ' times') + '</span></li>').join('') + '</ul>' :
      '<p class="card-sub">Missed answers will show which sounds you tend to confuse.</p>') + '</section>' +
    '<section class="card list-card">' + title('Practice &amp; review history','clock') +
    (recent.length ? '<ul class="data-list">' + recent.map(h => '<li><div><strong>' + item(h.mode,h.id)[1] +
      '</strong><small>' + fullDate(h.at) + ' · ' + (h.review ? 'Review' : 'Practice') +
      (h.source === 'midi' ? ' · MIDI' : '') + '</small></div><div class="right"><strong class="' +
      (h.correct ? 'good' : 'bad') + '">' + (h.correct ? 'Correct' : h.answer === null ? 'Skipped' : pickedName(h.mode,h.answer)) +
      '</strong><small>' + pace(h.seconds) + (h.review ? ' · Next ' + date(h.due) : '') + '</small></div></li>').join('') +
      '</ul>' + (history.length > historyLimit ? '<button class="button secondary history-more" data-action="more">Show more history</button>' : '') :
      '<p class="card-sub">Your first practice or review answer will appear here.</p>') + '</section></div>';
}

function render(focus) {
  if (focus === undefined && workspace.contains(document.activeElement)) {
    const active = document.activeElement;
    const key = ['action','answer','filter','mode','type','view'].find(key => active.dataset[key]);
    if (key) focus = '[data-' + key + '="' + CSS.escape(active.dataset[key]) + '"]';
  }
  workspace.innerHTML = state.view === 'practice' ? renderPractice() :
    state.view === 'review' ? renderReview() : renderProgress();
  const count = dueCards(state).length;
  const badge = document.getElementById('nav-due');
  badge.textContent = count;
  badge.hidden = !count;
  document.querySelectorAll('.nav-item').forEach(button => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active',active);
    if (active) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  });
  if (focus) workspace.querySelector(focus)?.focus({preventScroll:true});
}

function refresh(focus) {
  const q = currentSession()?.question;
  if (q?.played) startTimer(q);
  save();
  render(focus);
}

function pauseTimer() {
  if (!timer) return;
  timer.question.elapsed += performance.now() - timer.start;
  timer = null;
}

function startTimer(q) {
  if (!timer && !q.result && !document.hidden) timer = { question: q, start: performance.now() };
}

function stopQuestion() {
  playback += 1;
  playing = false;
  audioMessage = '';
  pauseTimer();
  stopAudio();
  midiNotes = [];
}

async function play() {
  const q = currentSession()?.question;
  if (!q) return;
  const token = ++playback;
  audioMessage = '';
  try {
    const ms = await playAudio(q, () => token === playback);
    if (!ms || token !== playback) return;
    q.played = true;
    playing = true;
    startTimer(q);
    refresh();
    setTimeout(() => {
      if (token !== playback) return;
      playing = false;
      render();
    }, ms);
  } catch {
    if (token !== playback) return;
    playing = false;
    audioMessage = 'Audio is unavailable. Check that your browser allows sound.';
    render();
  }
}

function answer(id, source) {
  const s = currentSession();
  const q = s?.question;
  if (!q || q.result || (!q.played && id !== null)) return;
  stopQuestion();
  const result = record(state,q,id,source);
  s.completed += 1;
  s.correct += Number(result.correct);
  if (result.seconds != null) {
    s.timed += 1;
    s.seconds += result.seconds;
  }
  refresh('[data-action="next"]');
}

function reviewQuestion(key) {
  const [mode,id] = key.split('/');
  return makeQuestion(state,mode,defaultFilters(mode),null,id);
}

function next() {
  const s = currentSession();
  if (!s?.question?.result) return;
  const { mode,id } = s.question;
  stopQuestion();
  if (s.completed >= s.size) s.question = null;
  else if (state.view === 'review') s.question = reviewQuestion(s.queue[s.completed]);
  else s.question = makeQuestion(state,mode,state.filters[mode],id);
  refresh(s.question ? '[data-action="play"]' : '[data-action="new-session"], [data-action="finish-review"]');
}

function filterChanged(focus) {
  const s = currentSession();
  if (s.question && !s.question.result) {
    stopQuestion();
    s.question = makeQuestion(state,state.mode,state.filters[state.mode]);
  }
  refresh(focus);
}

function navigate(view) {
  if (view === state.view) return;
  stopQuestion();
  state.view = view;
  refresh(false);
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  const {view,mode,answer: choice,type,action} = button.dataset;
  if (view) navigate(view);
  if (mode && mode !== state.mode) {
    stopQuestion();
    state.mode = mode;
    refresh('[data-mode="' + mode + '"]');
  }
  if (choice) answer(choice,'choice');
  if (type) {
    const types = state.filters[state.mode].types;
    if (types.includes(type) && types.length === 1) {
      workspace.querySelector('.filter-status[role="status"]').textContent = 'Keep at least one type selected';
      return;
    }
    state.filters[state.mode].types = types.includes(type) ? types.filter(id => id !== type) : [...types,type];
    filterChanged('[data-type="' + type + '"]');
  }
  switch (action) {
    case 'play': void play(); break;
    case 'skip': answer(null,'skip'); break;
    case 'next': next(); break;
    case 'new-session':
      state.sessions[state.mode] = newSession(state.mode);
      refresh('[data-action="play"]');
      break;
    case 'reset-filters':
      state.filters[state.mode] = defaultFilters(state.mode);
      filterChanged('[data-action="reset-filters"]');
      break;
    case 'start-review': {
      const queue = dueCards(state);
      if (!queue.length) { render(); break; }
      state.sessions.review = { completed:0, correct:0, timed:0, seconds:0,
        size:queue.length, queue, question:reviewQuestion(queue[0]) };
      refresh('[data-action="play"]');
      break;
    }
    case 'finish-review':
      state.sessions.review = null;
      refresh('[data-action="start-review"], main [data-view="practice"]');
      break;
    case 'more':
      historyLimit += 24;
      render();
      break;
    case 'midi-clear':
      midiNotes = [];
      render();
      break;
    case 'midi-submit': {
      const q = currentSession()?.question;
      const id = q && midiAnswer(q.mode,midiNotes);
      if (id) answer(id,'midi');
      break;
    }
  }
});

workspace.addEventListener('change', event => {
  const id = event.target.dataset.filter;
  if (!id) return;
  const f = state.filters[state.mode];
  f[id] = event.target.value;
  if (id === 'key' && f.root !== 'any' && !rootsFor(f.key).includes(Number(f.root))) f.root = 'any';
  filterChanged('[data-filter="' + id + '"]');
});

document.addEventListener('keydown', event => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
      event.target.closest('input,select,textarea,[contenteditable]')) return;
  const q = currentSession()?.question;
  if (!q) return;
  if (event.code === 'Space' && !event.target.closest('button')) {
    event.preventDefault();
    void play();
  } else if (/^[1-4]$/.test(event.key) && q.played && !q.result) {
    answer(q.options[Number(event.key)-1],'choice');
  }
});

function suspend() {
  pauseTimer();
  save();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) suspend();
  else {
    const q = currentSession()?.question;
    if (q?.played) startTimer(q);
    render();
  }
});
window.addEventListener('pagehide', suspend);
setInterval(() => {
  if (document.hidden) return;
  if (timer) {
    const question = timer.question;
    pauseTimer();
    save();
    startTimer(question);
  }
  if (state.view === 'review' && !state.sessions.review) render();
  else {
    const badge = document.getElementById('nav-due');
    const count = dueCards(state).length;
    badge.textContent = count;
    badge.hidden = !count;
  }
}, 15_000);

function showMidiStatus(message) {
  midiStatus.textContent = message;
  midiConnect.title = message;
}

function onMidi(event) {
  const [status,note,velocity] = event.data;
  if ((status & 0xf0) !== 0x90 || !velocity) return;
  const q = currentSession()?.question;
  if (!q?.played || q.result) return;
  if (q.mode === 'interval') {
    if (midiNotes.length === 2) midiNotes = [];
    midiNotes.push(note);
  } else if (!midiNotes.includes(note)) {
    midiNotes.push(note);
  }
  if (!timer) startTimer(q);
  render();
}

function refreshMidi() {
  const inputs = [...midi.inputs.values()].filter(input => input.state === 'connected');
  inputs.forEach(input => { input.onmidimessage = onMidi; });
  showMidiStatus(inputs.length ? (inputs[0].name || 'Keyboard connected') : 'Plug in a MIDI keyboard');
  midiConnect.textContent = inputs.length ? 'MIDI connected' : 'Check MIDI';
  if (!inputs.length) midiNotes = [];
  render();
}

midiConnect.onclick = async () => {
  if (!navigator.requestMIDIAccess) {
    showMidiStatus('Web MIDI is unavailable in this browser');
    midiConnect.textContent = 'MIDI unavailable';
    return;
  }
  try {
    midi ??= await navigator.requestMIDIAccess({sysex:false});
    midi.onstatechange = refreshMidi;
    refreshMidi();
  } catch {
    showMidiStatus('MIDI access was blocked. Check browser permissions.');
    midiConnect.textContent = 'Retry MIDI';
  }
};

refresh(false);
