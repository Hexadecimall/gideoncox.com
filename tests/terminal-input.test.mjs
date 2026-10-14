import test from 'node:test';
import assert from 'node:assert/strict';
import { LineBuffer } from '../assets/js/terminal/line-buffer.js';

test('terminal editing inserts and deletes at the cursor without damaging Unicode', () => {
  const line = new LineBuffer();
  line.replace('a🙂b');
  line.move(-1);
  line.backspace();
  assert.equal(line.text, 'ab');
  assert.equal(line.cursor, 1);
  line.insert('é');
  assert.equal(line.text, 'aéb');
  line.delete();
  assert.equal(line.text, 'aé');
  line.cursor = 0;
  line.backspace();
  assert.equal(line.text, 'aé');
});

test('deleting a word preserves the unedited suffix', () => {
  const line = new LineBuffer();
  line.replace('cat one two');
  line.cursor = 8;
  line.deleteWord();
  assert.equal(line.text, 'cat two');
  assert.equal(line.cursor, 4);
});
