import test from 'node:test';
import assert from 'node:assert/strict';
import { TypingSession } from '../assets/js/typing/session.js';
import { makeText, lessons, fingerFor } from '../assets/js/typing/content.js';

test('time starts on input and expires at the deadline even after a delayed frame', () => {
  const session = new TypingSession('hello world again', 30);
  session.tick(100000);
  assert.equal(session.startedAt, null);
  session.update('hello', 100000);
  session.update('hello world', 110000);
  assert.equal(session.finished, false);
  const result = session.metrics(150000);
  assert.equal(session.finished, true);
  assert.equal(result.elapsed, 30);
  assert.equal(result.wpm, 4);
  session.update('hello world again', 150001);
  assert.equal(session.value, 'hello world');
});

test('fixing mistakes restores correct characters but preserves error history', () => {
  const session = new TypingSession('cat dog');
  session.update('car', 0);
  session.update('ca', 1000);
  session.update('cat dog', 60000);
  const result = session.metrics(60000);
  assert.equal(result.correct, 7);
  assert.equal(result.errors, 1);
  assert.equal(result.accuracy, 88);
  assert.equal(session.missed.get('t'), 1);
  assert.equal(session.finished, true);
});

test('practice waits for corrections, word tests finish with honest accuracy', () => {
  const practice = new TypingSession('cat', 0, true);
  practice.update('car', 1000);
  assert.equal(practice.finished, false);
  practice.update('ca', 2000);
  practice.update('cat', 3000);
  assert.equal(practice.finished, true);
  assert.equal(practice.metrics(3000).accuracy, 75);
  const words = new TypingSession('cat');
  words.update('car', 0);
  assert.equal(words.finished, true);
  assert.equal(words.metrics(0).accuracy, 67);
  assert.equal(words.metrics(0).wpm, 0);
});

test('generated tests honor word count and optional punctuation and numbers', () => {
  const plain = makeText(25, {}, () => .2);
  assert.equal(plain.split(' ').length, 25);
  assert.match(plain, /^[a-z ]+$/);
  const mixed = makeText(25, { punctuation: true, numbers: true }, () => .5);
  assert.match(mixed, /\d+/);
  assert.match(mixed, /[.,]/);
  assert.equal(new Set(lessons.map(lesson => lesson.id)).size, lessons.length);
  assert.equal(fingerFor('f'), 'left index');
  assert.equal(fingerFor(' '), 'thumb');
});
