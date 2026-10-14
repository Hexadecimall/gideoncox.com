// The clock is supplied by the UI so scoring stays deterministic in tests.
export class TypingSession {
  constructor(text, duration = 0, requireCorrect = false) {
    this.target = text;
    this.duration = duration;
    this.requireCorrect = requireCorrect;
    this.value = '';
    this.startedAt = null;
    this.endedAt = null;
    this.attempts = 0;
    this.correctAttempts = 0;
    this.missed = new Map();
  }

  get finished() { return this.endedAt !== null; }

  update(value, now) {
    this.tick(now);
    if (this.finished) return;
    value = value.slice(0, this.target.length);
    if (this.startedAt === null && value.length) this.startedAt = now;
    let unchanged = 0;
    while (unchanged < value.length && unchanged < this.value.length && value[unchanged] === this.value[unchanged]) unchanged++;
    for (let i = unchanged; i < value.length; i++) {
      this.attempts++;
      if (value[i] === this.target[i]) this.correctAttempts++;
      else {
        const expected = this.target[i];
        this.missed.set(expected, (this.missed.get(expected) || 0) + 1);
      }
    }
    this.value = value;
    if (this.value.length === this.target.length && this.startedAt !== null && (!this.requireCorrect || this.value === this.target)) this.endedAt = now;
  }

  tick(now) {
    if (!this.finished && this.startedAt !== null && this.duration && now >= this.startedAt + this.duration * 1000) {
      this.endedAt = this.startedAt + this.duration * 1000;
    }
  }

  metrics(now) {
    this.tick(now);
    const elapsed = this.startedAt === null ? 0 : Math.max(0, ((this.endedAt ?? now) - this.startedAt) / 1000);
    let correct = 0;
    for (let i = 0; i < this.value.length; i++) if (this.value[i] === this.target[i]) correct++;
    const minutes = elapsed / 60;
    return {
      elapsed,
      remaining: Math.max(0, this.duration - elapsed),
      wpm: minutes > 0 ? Math.round(correct / 5 / minutes) : 0,
      raw: minutes > 0 ? Math.round(this.attempts / 5 / minutes) : 0,
      accuracy: this.attempts ? Math.round(100 * this.correctAttempts / this.attempts) : 100,
      errors: this.attempts - this.correctAttempts,
      correct,
      progress: this.value.length / this.target.length,
    };
  }
}
