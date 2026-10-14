import { TypingSession } from './typing/session.js';
import { makeText, lessons, fingerFor } from './typing/content.js';

const find = id => document.getElementById(id);
const input = find('typing-input');
const field = find('typing-field');
const words = find('typing-words');
const lessonSelect = find('typing-lesson');
const results = find('typing-result');
const status = find('typing-status');
const storageKey = 'typing-progress-v1';
let saved = { best: {}, lessons: {} };
try {
  const value = JSON.parse(localStorage.getItem(storageKey));
  if (value?.best && value?.lessons && typeof value.best === 'object' && typeof value.lessons === 'object') saved = value;
} catch {}
let mode = 'time';
let seconds = 30;
let wordCount = 50;
let punctuation = false;
let numbers = false;
let showKeyboard = true;
let lessonIndex = 0;
let session;
let characters = [];
let frame = 0;
let completed = false;
const keyNodes = new Map();

for (const row of ['1234567890', 'qwertyuiop', "asdfghjkl;'", 'zxcvbnm,./', ' ']) {
  const line = document.createElement('div');
  line.className = 'keyboard-row';
  for (const key of row) {
    const element = document.createElement('span');
    element.textContent = key === ' ' ? '' : key;
    if (key === ' ') element.className = 'keyboard-space';
    keyNodes.set(key, element);
    line.append(element);
  }
  find('keyboard-keys').append(line);
}
function refreshLessons() {
  lessonSelect.replaceChildren(...lessons.map((lesson, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = lesson.name + (saved.lessons[lesson.id] ? ' ✓' : '');
    return option;
  }));
  lessonSelect.value = String(lessonIndex);
}
refreshLessons();

function configurationKey() { return `${mode}:${mode === 'time' ? seconds : wordCount}:${Number(punctuation)}:${Number(numbers)}`; }
function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch {}
}
function controls() {
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === mode)));
  find('time-options').hidden = mode !== 'time';
  find('word-options').hidden = mode !== 'words';
  find('test-options').hidden = mode === 'practice';
  find('lesson-options').hidden = mode !== 'practice';
  find('typing-keyboard').hidden = mode !== 'practice' || !showKeyboard;
  document.querySelectorAll('[data-seconds]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.seconds) === seconds)));
  document.querySelectorAll('[data-count]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.count) === wordCount)));
  find('typing-punctuation').setAttribute('aria-pressed', String(punctuation));
  find('typing-numbers').setAttribute('aria-pressed', String(numbers));
  find('keyboard-toggle').setAttribute('aria-pressed', String(showKeyboard));
}
function setText(text) {
  characters = [];
  words.replaceChildren(...text.split(' ').map((word, index, all) => {
    const group = document.createElement('span');
    group.className = 'typing-word';
    for (const character of word + (index < all.length - 1 ? ' ' : '')) {
      const span = document.createElement('span');
      span.textContent = character;
      span.className = 'typing-char';
      group.append(span);
      characters.push(span);
    }
    return group;
  }));
  find('typing-target').textContent = text;
  words.style.transform = '';
}
function render() {
  const value = session.value;
  characters.forEach((span, index) => {
    span.className = 'typing-char' + (index < value.length ? value[index] === session.target[index] ? ' correct' : ' incorrect' : '');
  });
  const current = characters[Math.min(value.length, characters.length - 1)];
  current?.classList.add('current');
  if (current) {
    const top = current.getBoundingClientRect().top - words.getBoundingClientRect().top;
    const lineHeight = parseFloat(getComputedStyle(words).lineHeight);
    words.style.transform = `translateY(-${Math.max(0, top - lineHeight)}px)`;
  }
  const expected = session.target[value.length];
  const physicalKey = ({ ':': ';', '?': '/', '!': '1', '"': "'" })[expected] || expected?.toLowerCase();
  for (const [key, node] of keyNodes) node.classList.toggle('next-key', key === physicalKey);
  const shift = expected && (/[A-Z:?!"]/.test(expected));
  find('typing-finger').textContent = (shift ? 'shift + ' : '') + fingerFor(expected);
}
function reset(focus = false) {
  cancelAnimationFrame(frame);
  const text = mode === 'practice' ? lessons[lessonIndex].text : makeText(mode === 'time' ? 600 : wordCount, { punctuation, numbers });
  session = new TypingSession(text, mode === 'time' ? seconds : 0, mode === 'practice');
  completed = false;
  results.hidden = true;
  field.hidden = false;
  find('typing-live')?.removeAttribute('hidden');
  input.value = '';
  input.readOnly = false;
  input.maxLength = text.length;
  status.textContent = 'Ready. The test starts on your first character.';
  find('typing-caps').hidden = true;
  controls();
  setText(text);
  render();
  updateMetrics(performance.now());
  if (focus) input.focus({ preventScroll: true });
}
function finish(now) {
  if (completed) return;
  completed = true;
  cancelAnimationFrame(frame);
  input.readOnly = true;
  const metric = session.metrics(now);
  field.hidden = true;
  find('typing-live').hidden = true;
  find('typing-keyboard').hidden = true;
  results.hidden = false;
  find('result-wpm').value = metric.wpm;
  find('result-accuracy').value = `${metric.accuracy}%`;
  find('result-raw').value = metric.raw;
  find('result-time').textContent = `${metric.elapsed.toFixed(1)}s`;
  find('result-errors').textContent = `${metric.errors} error${metric.errors === 1 ? '' : 's'}`;
  find('result-practice').hidden = mode !== 'practice';
  find('typing-next').hidden = true;
  if (mode === 'practice') {
    const passed = metric.accuracy >= 95;
    if (passed) saved.lessons[lessons[lessonIndex].id] = true;
    const missed = [...session.missed].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key]) => key === ' ' ? 'space' : key);
    find('result-practice').textContent = passed ? 'Lesson complete' : missed.length ? `Practice: ${missed.join(' · ')}` : 'Repeat lesson';
    find('typing-next').hidden = !passed || lessonIndex === lessons.length - 1;
    find('result-best').textContent = `${lessons.filter(lesson => saved.lessons[lesson.id]).length} / ${lessons.length} lessons`;
    refreshLessons();
  } else {
    const key = configurationKey();
    const previous = Number(saved.best[key]) || 0;
    saved.best[key] = Math.max(previous, metric.wpm);
    find('result-best').textContent = `best ${saved.best[key]} wpm`;
  }
  save();
  status.textContent = `Finished. ${metric.wpm} words per minute, ${metric.accuracy} percent accuracy, ${metric.errors} errors.`;
  find('typing-again').focus({ preventScroll: true });
}
function updateMetrics(now) {
  const metric = session.metrics(now);
  const progress = mode === 'time' ? `${Math.ceil(metric.remaining)}s` : `${Math.floor(metric.progress * 100)}%`;
  if (find('typing-progress').textContent !== progress) find('typing-progress').textContent = progress;
  find('typing-speed').textContent = session.startedAt === null ? '' : `${metric.wpm} wpm · ${metric.accuracy}%`;
  if (session.finished) finish(now);
}
function tick(now) {
  updateMetrics(now);
  if (!completed) frame = requestAnimationFrame(tick);
}
function acceptInput() {
  if (completed) return;
  const wasReady = session.startedAt === null;
  session.update(input.value.replace(/[\r\n]/g, ' '), performance.now());
  input.value = session.value;
  render();
  updateMetrics(performance.now());
  if (wasReady && session.startedAt !== null && !completed) {
    status.textContent = 'Test started.';
    frame = requestAnimationFrame(tick);
  }
}
input.addEventListener('input', event => { if (!event.isComposing) acceptInput(); });
input.addEventListener('compositionend', acceptInput);
input.addEventListener('paste', event => event.preventDefault());
input.addEventListener('drop', event => event.preventDefault());
input.addEventListener('beforeinput', event => {
  if (event.inputType === 'insertFromPaste' || event.inputType === 'insertFromDrop') event.preventDefault();
});
input.addEventListener('keydown', event => {
  find('typing-caps').hidden = !event.getModifierState('CapsLock');
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) event.preventDefault();
  if (event.key === 'Escape') { input.blur(); return; }
  if (event.key === 'Enter') {
    event.preventDefault();
    if (!completed) { input.value += ' '; acceptInput(); }
  }
});
field.addEventListener('click', () => input.focus({ preventScroll: true }));
input.addEventListener('focus', () => field.classList.add('is-focused'));
input.addEventListener('blur', () => field.classList.remove('is-focused'));
new ResizeObserver(() => { if (session && !completed) render(); }).observe(field);
document.addEventListener('visibilitychange', () => { if (session.startedAt !== null && !completed) updateMetrics(performance.now()); });
window.addEventListener('site-preferences-changed', () => { if (!completed) render(); });

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { mode = button.dataset.mode; reset(); }));
document.querySelectorAll('[data-seconds]').forEach(button => button.addEventListener('click', () => { seconds = Number(button.dataset.seconds); reset(); }));
document.querySelectorAll('[data-count]').forEach(button => button.addEventListener('click', () => { wordCount = Number(button.dataset.count); reset(); }));
find('typing-punctuation').addEventListener('click', () => { punctuation = !punctuation; reset(); });
find('typing-numbers').addEventListener('click', () => { numbers = !numbers; reset(); });
lessonSelect.addEventListener('change', () => { lessonIndex = Number(lessonSelect.value); reset(); });
find('keyboard-toggle').addEventListener('click', () => { showKeyboard = !showKeyboard; controls(); });
find('typing-restart').addEventListener('click', () => reset(true));
find('typing-again').addEventListener('click', () => reset(true));
find('typing-next').addEventListener('click', () => { lessonIndex = Math.min(lessons.length - 1, lessonIndex + 1); lessonSelect.value = String(lessonIndex); reset(true); });
reset();
