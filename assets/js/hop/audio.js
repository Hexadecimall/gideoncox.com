// Synthesized effects avoid external sound downloads and stay muted by default.
let context;
let enabled = false;
const notes = { jump: [190, 420, .09], shot: [520, 180, .055], hit: [95, 35, .13], dash: [150, 650, .12], clear: [420, 840, .3] };
export function setSound(value) {
  enabled = value;
  if (enabled) { context ||= new AudioContext(); context.resume(); playSound('jump'); }
}
export function playSound(kind) {
  if (!enabled || !context || context.state !== 'running') return;
  const [from, to, duration] = notes[kind] || notes.shot;
  const oscillator = context.createOscillator(), gain = context.createGain(), now = context.currentTime;
  oscillator.type = kind === 'hit' ? 'sawtooth' : 'triangle';
  oscillator.frequency.setValueAtTime(from, now); oscillator.frequency.exponentialRampToValueAtTime(to, now + duration);
  gain.gain.setValueAtTime(.035, now); gain.gain.exponentialRampToValueAtTime(.001, now + duration);
  oscillator.connect(gain).connect(context.destination); oscillator.start(now); oscillator.stop(now + duration);
}
