export type SoundPreference = 'all' | 'hands' | 'off';

const soundKey = 'shroom-sound-preference';
let callAudio: AudioContext | null = null;

export function unlockCallAudio() {
  try {
    callAudio ??= new window.AudioContext();
    if (callAudio.state === 'suspended') void callAudio.resume().catch(() => {});
  } catch {
    // Audio is optional when the browser does not support it.
  }
}

export function getSoundPreference(): SoundPreference {
  const saved = localStorage.getItem(soundKey);
  return saved === 'all' || saved === 'off' ? saved : 'hands';
}

export function setSoundPreference(value: SoundPreference) {
  localStorage.setItem(soundKey, value);
  window.dispatchEvent(new Event('shroom-sound-change'));
}

function playNotes(notes: number[], volume: number) {
  try {
    unlockCallAudio();
    const ctx = callAudio;
    if (!ctx) return;
    const sinkId = localStorage.getItem('shroom-audio-output');
    const route = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    const start = () => {
      notes.forEach((frequency, index) => {
        const begin = ctx.currentTime + index * 0.12;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, begin);
        gain.gain.linearRampToValueAtTime(volume, begin + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.001, begin + 0.26);
        oscillator.connect(gain).connect(ctx.destination);
        oscillator.start(begin);
        oscillator.stop(begin + 0.27);
      });
    };
    const play = () => {
      if (sinkId && route.setSinkId) void route.setSinkId(sinkId).then(start, start);
      else start();
    };
    if (ctx.state === 'suspended') void ctx.resume().then(play).catch(() => {});
    else play();
  } catch {
    // Optional sounds must not interrupt a call.
  }
}

export function playJoinChime() {
  if (getSoundPreference() === 'all') playNotes([784, 988], 0.035);
}

export function playLeaveChime() {
  if (getSoundPreference() === 'all') playNotes([784, 659], 0.025);
}

export function playHandChime() {
  if (getSoundPreference() !== 'off') playNotes([880, 1175], 0.09);
}

export function playSpeakerTest() {
  playNotes([660, 880], 0.08);
}

export function playHostRequestChime() {
  if (getSoundPreference() !== 'off' && localStorage.getItem('shroom-request-sound') !== 'off') {
    playNotes([740, 988], 0.065);
  }
}
