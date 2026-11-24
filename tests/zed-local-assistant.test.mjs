import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalAssistant, prepareMessages } from '../assets/js/zed/local-assistant.js';

const prompt = content => ({ role: 'user', content });
const response = content => ({ role: 'assistant', content });
const modelId = 'SmolLM2-360M-Instruct-q4f32_1-MLC';

function fixture(createEngine) {
  const pending = [];
  const workers = [];
  const events = [];
  const assistant = createLocalAssistant((...event) => {
    events.push(event);
    for (const listener of [...pending]) listener();
  }, {
    available: () => true,
    loadLibrary: async () => ({
      prebuiltAppConfig: { model_list: [{ model_id: modelId }] },
      CreateWebWorkerMLCEngine: createEngine,
    }),
    makeWorker() {
      const worker = new EventTarget();
      worker.terminate = () => { worker.terminated = true; };
      workers.push(worker);
      return worker;
    },
  });
  function waitFor(id, type) {
    return new Promise(resolve => {
      const check = () => {
        if (events.some(event => event[0] === id && event[1] === type)) {
          pending.splice(pending.indexOf(check), 1);
          resolve();
        }
      };
      pending.push(check);
      check();
    });
  }
  return { assistant, workers, events, waitFor };
}

test('history retains the latest prompt and complete recent pairs', () => {
  const messages = prepareMessages(JSON.stringify([
    prompt('a'.repeat(2000)), response('b'.repeat(2000)),
    prompt('What is this?'), response('A loop.'),
    prompt('Explain the loop.'),
  ]));
  assert.deepEqual(messages.slice(1), [prompt('What is this?'), response('A loop.'), prompt('Explain the loop.')]);
  assert.throws(() => prepareMessages(JSON.stringify([prompt(' ')])), /Enter a message/);
});

test('streams a response and reuses the loaded browser model', async t => {
  let loads = 0;
  const { assistant, workers, events, waitFor } = fixture(async (_worker, id, config) => {
    loads++;
    assert.equal(id, modelId);
    assert.equal(config.appConfig.model_list.length, 1);
    assert.match(config.appConfig.model_list[0].model, /\/resolve\/[a-f0-9]{40}\/$/);
    config.initProgressCallback({ progress: 0.6 });
    return { chat: { completions: { async *create(request) {
      assert.equal(request.stream, true);
      assert.equal(request.messages[0].role, 'system');
      yield { choices: [{ delta: { content: 'Hello' } }] };
    } } } };
  });
  t.after(() => assistant.close());
  assistant.start(1, JSON.stringify([prompt('Greet me')]));
  await waitFor(1, 'done');
  assistant.start(2, JSON.stringify([prompt('Again')]));
  await waitFor(2, 'done');
  assert.equal(loads, 1);
  assert.equal(workers.length, 1);
  assert.deepEqual(events.filter(([, type]) => type === 'text'), [
    [1, 'text', 'Hello'],
    [2, 'text', 'Hello'],
  ]);
});

test('cancelled model loading cannot emit into a replacement request', async t => {
  let releaseFirst;
  let loads = 0;
  const { assistant, workers, events, waitFor } = fixture((_worker, _id, config) => {
    config.initProgressCallback({ progress: 0.5 });
    const engine = { chat: { completions: { async *create() {
      yield { choices: [{ delta: { content: 'Fresh' } }] };
    } } } };
    if (++loads === 1) return new Promise(resolve => { releaseFirst = () => resolve(engine); });
    return Promise.resolve(engine);
  });
  t.after(() => assistant.close());
  assistant.start(1, JSON.stringify([prompt('First')]));
  await waitFor(1, 'status');
  await new Promise(resolve => queueMicrotask(resolve));
  assistant.stop(1);
  assert.equal(workers[0].terminated, true);
  assistant.start(2, JSON.stringify([prompt('Second')]));
  releaseFirst();
  await waitFor(2, 'done');
  assert.ok(events.every(([id, type]) => id !== 1 || type === 'status'));
  assert.equal(workers.length, 2);
});
