import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareEditorIsolation } from '../assets/js/zed/isolation.js';

const page = 'https://editor.example/editor/app/?v=123&keep=one#workspace';
const worker = { scriptURL: 'https://editor.example/editor/isolation-worker.js' };

function browser(t, { href = page, workers, isolated = false } = {}) {
  const calls = [];
  const state = { test: true };
  const window = {};
  window.top = window;
  const environment = {
    window,
    location: { href, replace: address => calls.push(['navigate', address]) },
    history: { state, replaceState: (...args) => calls.push(['clean URL', ...args]) },
    crossOriginIsolated: isolated,
    navigator: { serviceWorker: workers },
  };
  for (const [name, value] of Object.entries(environment)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
  return { calls, state };
}

test('an active worker recovers a bypassed page through a single normal navigation', async t => {
  const { calls } = browser(t, { workers: {
    async getRegistration() { return { active: worker }; },
    register() { assert.fail('The expected worker is already active'); },
  } });
  assert.equal(await prepareEditorIsolation(), true);
  assert.deepEqual(calls, [['navigate', 'https://editor.example/editor/app/?v=123&keep=one&_zed_isolation=1#workspace']]);
});

test('a retry removes its marker and boots even if the browser still bypasses the worker', async t => {
  const { calls, state } = browser(t, {
    href: 'https://editor.example/editor/app/?v=123&keep=one&_zed_isolation=1#workspace',
    workers: { getRegistration() { assert.fail('Retry must boot without another navigation'); } },
  });
  assert.equal(await prepareEditorIsolation(), false);
  assert.deepEqual(calls, [['clean URL', state, '', page]]);
});

test('waiting for isolation includes the time spent on a stalled registration', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let started;
  const registered = new Promise(resolve => { started = resolve; });
  const { calls } = browser(t, { workers: {
    async getRegistration() {},
    register() {
      started();
      return new Promise(() => {});
    },
  } });
  const result = prepareEditorIsolation();
  await registered;
  t.mock.timers.tick(2500);
  assert.equal(await result, false);
  assert.deepEqual(calls, []);
});
