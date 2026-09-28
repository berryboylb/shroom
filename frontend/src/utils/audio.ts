export type SoundPreference = 'all' | 'hands' | 'off';

const soundKey = 'shroom-sound-preference';

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
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
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
      window.setTimeout(() => void ctx.close(), notes.length * 120 + 350);
    };
    if (sinkId && route.setSinkId) void route.setSinkId(sinkId).then(start, start);
    else start();
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
  if (getSoundPreference() !== 'off') playNotes([880], 0.04);
}
