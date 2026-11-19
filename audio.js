let context;
let voiceBus;
let master;

export function stopAudio() {
  if (!voiceBus || !context) return;
  const bus = voiceBus;
  voiceBus = null;
  bus.gain.setTargetAtTime(0, context.currentTime, .013);
  setTimeout(() => bus.disconnect(), 120);
}

function piano(note, at, duration, level) {
  const frequency = 440 * 2 ** ((note - 69) / 12);
  const levels = [1, .42, .19, .105, .043, .025];
  for (const [index, amplitude] of levels.entries()) {
    const partial = context.createOscillator();
    const envelope = context.createGain();
    const harmonic = index + 1;
    partial.frequency.value = frequency * harmonic * Math.sqrt(1 + .00018 * harmonic ** 2);
    const peak = level * amplitude;
    envelope.gain.setValueAtTime(.00008, at);
    envelope.gain.exponentialRampToValueAtTime(peak, at + .009);
    envelope.gain.exponentialRampToValueAtTime(peak * .55, at + .11);
    envelope.gain.exponentialRampToValueAtTime(Math.max(.00009, peak * .21 / harmonic), at + duration * .65);
    envelope.gain.exponentialRampToValueAtTime(.00008, at + duration);
    partial.connect(envelope).connect(voiceBus);
    partial.onended = () => { partial.disconnect(); envelope.disconnect(); };
    partial.start(at);
    partial.stop(at + duration + .01);
  }
}

export async function playAudio(question, shouldPlay = () => true) {
  const Audio = window.AudioContext ?? window.webkitAudioContext;
  if (!Audio) throw new Error('Audio playback is unavailable in this browser.');
  if (!context) {
    context = new Audio();
    master = context.createDynamicsCompressor();
    master.connect(context.destination);
  }
  if (context.state !== 'running') await context.resume();
  if (!shouldPlay()) return 0;
  stopAudio();
  voiceBus = context.createGain();
  voiceBus.connect(master);
  const interval = question.mode === 'interval';
  const start = context.currentTime + .035;
  question.tones.forEach((note, index) => piano(note, start + index * (interval ? .54 : .012),
    interval ? .75 : 1.55, interval ? .18 : .075));
  return interval ? 1310 : 1650;
}
