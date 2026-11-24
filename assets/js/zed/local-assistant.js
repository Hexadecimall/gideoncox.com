const VERSION = '0.2.89';
const MODEL = 'SmolLM2-360M-Instruct-q4f32_1-MLC';
const MODEL_REPO = 'https://huggingface.co/mlc-ai/SmolLM2-360M-Instruct-q4f32_1-MLC';
const MODEL_REVISION = '1e6b2ca3684e2bc8a6d39eb36e8d6cd51eb12bda';
const RUNTIME = '/editor/runtime/webllm/';
const MAX_HISTORY_CHARS = 3200;
const SYSTEM = {
  role: 'system',
  content: 'You are a coding assistant. Give concise, technically precise answers using the provided context.',
};

export function prepareMessages(serialized) {
  const list = JSON.parse(serialized);
  const latest = list.at(-1);
  if (latest?.role !== 'user' || typeof latest.content !== 'string' || !latest.content.trim()) {
    throw new Error('Enter a message first.');
  }
  const history = [latest];
  let length = SYSTEM.content.length + latest.content.length;
  for (let index = list.length - 3; index >= 0; index -= 2) {
    const question = list[index];
    const reply = list[index + 1];
    if (question.role !== 'user' || reply.role !== 'assistant'
      || typeof question.content !== 'string' || typeof reply.content !== 'string') continue;
    length += question.content.length + reply.content.length;
    if (length > MAX_HISTORY_CHARS) break;
    history.unshift(question, reply);
  }
  return [SYSTEM, ...history];
}

export function createLocalAssistant(emit, {
  available = () => Boolean(globalThis.isSecureContext && globalThis.navigator?.gpu),
  loadLibrary = () => import(`${RUNTIME}web-llm.js?v=${VERSION}`),
  makeWorker = () => new Worker(`${RUNTIME}worker.js?v=${VERSION}`, { type: 'module' }),
} = {}) {
  let active;
  let session;

  function send(job, type, value = '') {
    if (active === job) emit(job.id, type, value);
  }

  function finish(job, type, value = '') {
    if (active !== job) return;
    active = undefined;
    emit(job.id, type, value);
  }

  function dispose() {
    session?.worker.terminate();
    session = undefined;
  }

  function stop(id) {
    if (!active || (id !== undefined && active.id !== id)) return;
    const job = active;
    active = undefined;
    dispose();
    job.resolveStopped();
  }

  async function connect(job) {
    send(job, 'status', 'Loading SmolLM2 · 208 MB on first use');
    const { CreateWebWorkerMLCEngine, prebuiltAppConfig } = await loadLibrary();
    if (active !== job) return;

    const base = prebuiltAppConfig.model_list.find(entry => entry.model_id === MODEL);
    if (!base) throw new Error('The local model is missing from WebLLM.');
    const descriptor = {
      ...base,
      model: `${MODEL_REPO}/resolve/${MODEL_REVISION}/`,
      model_lib: new URL(`${RUNTIME}smollm2-360m.wasm?v=1`, import.meta.url).href,
    };
    const worker = makeWorker();
    const failure = new Promise((_, reject) => {
      worker.addEventListener('error', event => {
        event.preventDefault();
        reject(new Error(event.message || 'The WebLLM worker stopped.'));
      }, { once: true });
      worker.addEventListener('messageerror', () => reject(new Error('The WebLLM worker returned an invalid message.')), { once: true });
    });
    const nextSession = { worker, failure };
    session = nextSession;
    let progress = 0;
    nextSession.engine = await Promise.race([
      failure,
      CreateWebWorkerMLCEngine(worker, MODEL, {
        appConfig: { model_list: [descriptor], cacheBackend: 'cache' },
        initProgressCallback({ progress: fraction }) {
          const percent = Math.min(100, Math.floor(fraction * 100));
          if (!Number.isFinite(percent) || percent <= progress) return;
          progress = percent;
          send(job, 'status', `Loading SmolLM2 · ${percent}%`);
        },
      }, { context_window_size: 1024 }),
    ]);
  }

  async function generate(job, serialized) {
    if (!available()) throw new Error('Local chat requires WebGPU.');
    const messages = prepareMessages(serialized);
    if (!session?.engine) await connect(job);
    if (active !== job) return;
    const current = session;
    send(job, 'status', 'Generating…');
    let answerStarted = false;
    const stream = (async () => {
      const completion = await current.engine.chat.completions.create({
        messages,
        max_tokens: 192,
        temperature: 0.2,
        stream: true,
      });
      for await (const chunk of completion) {
        if (active !== job) break;
        const value = chunk.choices[0]?.delta?.content;
        if (value) {
          answerStarted = true;
          send(job, 'text', value);
        }
      }
    })();
    await Promise.race([current.failure, stream]);
    if (!answerStarted) throw new Error('The model returned an empty response.');
    finish(job, 'done');
  }

  function start(id, serialized) {
    stop();
    const job = { id };
    const stopped = new Promise(resolve => { job.resolveStopped = resolve; });
    active = job;
    // Return to GPUI before sending an event into the workspace.
    queueMicrotask(async () => {
      if (active !== job) return;
      try {
        await Promise.race([generate(job, serialized), stopped]);
      } catch (error) {
        if (active === job) {
          dispose();
          finish(job, 'error', error?.message || String(error));
        }
      } finally {
        if (active === job) active = undefined;
      }
    });
  }

  return {
    available,
    start,
    stop,
    close() {
      const id = active?.id;
      stop();
      dispose();
      if (id !== undefined) emit(id, 'error', 'Stopped');
    },
  };
}

export function installLocalAssistant(zed) {
  const assistant = createLocalAssistant(zed.local_assistant_event);
  globalThis.zedLocalAssistant = assistant;
  window.addEventListener('pagehide', () => assistant.close());
}
