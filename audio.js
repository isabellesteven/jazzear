const partialLevels = [1, .42, .19, .105, .043, .025];
const floor = .00008;
const sampleRate = 32000;
const mediaPeak = .85;
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let context;
let voiceBus;
let master;
let player;
let playbackUrl;

export function stopAudio() {
  if (playbackUrl) {
    player.pause();
    player.removeAttribute('src');
    player.load();
    URL.revokeObjectURL(playbackUrl);
    playbackUrl = null;
  }
  if (!voiceBus || !context) return;
  const bus = voiceBus;
  voiceBus = null;
  bus.gain.setTargetAtTime(0, context.currentTime, .013);
  setTimeout(() => bus.disconnect(), 120);
}

function voices(question) {
  const interval = question.mode === 'interval';
  const duration = interval ? .75 : 1.55;
  const level = interval ? .18 : .075;
  return question.tones.flatMap((note, index) => {
    const start = .035 + index * (interval ? .54 : .012);
    const fundamental = 440 * 2 ** ((note - 69) / 12);
    return partialLevels.map((strength, partial) => {
      const harmonic = partial + 1;
      const peak = level * strength;
      return {
        start,
        frequency: fundamental * harmonic * Math.sqrt(1 + .00018 * harmonic ** 2),
        envelope: [
          [0, floor],
          [.009, peak],
          [.11, peak * .55],
          [duration * .65, Math.max(.00009, peak * .21 / harmonic)],
          [duration, floor]
        ]
      };
    });
  });
}

function playVoice(voice, baseTime) {
  const partial = context.createOscillator();
  const gain = context.createGain();
  const at = baseTime + voice.start;
  partial.frequency.value = voice.frequency;
  gain.gain.setValueAtTime(floor, at);
  for (const [time, value] of voice.envelope.slice(1)) {
    gain.gain.exponentialRampToValueAtTime(value, at + time);
  }
  partial.connect(gain).connect(voiceBus);
  partial.onended = () => { partial.disconnect(); gain.disconnect(); };
  partial.start(at);
  partial.stop(at + voice.envelope.at(-1)[0] + .01);
}

function renderWav(parts, milliseconds) {
  const mix = new Float32Array(Math.ceil(sampleRate * milliseconds / 1000));
  for (const { start, frequency, envelope } of parts) {
    const offset = Math.round(start * sampleRate);
    const phaseStep = 2 * Math.PI * frequency / sampleRate;
    for (let segment = 1; segment < envelope.length; segment += 1) {
      const [fromTime, fromGain] = envelope[segment - 1];
      const [toTime, toGain] = envelope[segment];
      const first = Math.round(fromTime * sampleRate);
      const last = Math.round(toTime * sampleRate);
      const factor = (toGain / fromGain) ** (1 / (last - first));
      let gain = fromGain;
      for (let sample = first; sample < last; sample += 1) {
        mix[offset + sample] += gain * Math.sin(phaseStep * sample);
        gain *= factor;
      }
    }
  }

  const wav = new DataView(new ArrayBuffer(44 + 2 * mix.length));
  wav.setUint32(0, 0x52494646); // RIFF
  wav.setUint32(4, wav.byteLength - 8, true);
  wav.setUint32(8, 0x57415645); // WAVE
  wav.setUint32(12, 0x666d7420); // fmt
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); // PCM
  wav.setUint16(22, 1, true); // Mono
  wav.setUint32(24, sampleRate, true);
  wav.setUint32(28, sampleRate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  wav.setUint32(36, 0x64617461); // data
  wav.setUint32(40, 2 * mix.length, true);
  let peak = 0;
  for (const sample of mix) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0 ? mediaPeak / peak : 1;
  for (let i = 0; i < mix.length; i += 1) {
    const sample = mix[i] * gain;
    wav.setInt16(44 + 2 * i, Math.round(sample * 32767), true);
  }
  return new Blob([wav], { type: 'audio/wav' });
}

async function playMedia(parts, duration, shouldPlay) {
  if (!shouldPlay()) return 0;
  stopAudio();
  // Let iOS route the drill as media playback, including in Silent Mode.
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch {
    // The audio element also supports browsers without audio session control.
  }
  player ??= new Audio();
  const url = URL.createObjectURL(renderWav(parts, duration));
  playbackUrl = url;
  player.src = url;
  try {
    // Keep play() inside the original tap, before the first await.
    await player.play();
  } catch (error) {
    if (playbackUrl === url) stopAudio();
    if (shouldPlay()) throw error;
    return 0;
  }
  return shouldPlay() ? duration : 0;
}

export async function playAudio(question, shouldPlay = () => true) {
  const parts = voices(question);
  const duration = question.mode === 'interval' ? 1335 : 1650;
  const AudioContext = window.AudioContext ?? window.webkitAudioContext;
  if (ios || !AudioContext) return playMedia(parts, duration, shouldPlay);

  if (!context) {
    context = new AudioContext();
    master = context.createDynamicsCompressor();
    master.connect(context.destination);
  }
  if (context.state !== 'running') await context.resume();
  if (!shouldPlay()) return 0;
  stopAudio();
  voiceBus = context.createGain();
  voiceBus.connect(master);
  const start = context.currentTime;
  parts.forEach(voice => playVoice(voice, start));
  return duration;
}
