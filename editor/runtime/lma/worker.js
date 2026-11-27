import { QwenToolStream, qwenToolPrompt } from './qwen-tools.js?v=3';

const MODEL_CONTEXT_TOKENS = 8192;
const OUTPUT_BYTES = 4096;
const MODEL_PATH = '/model';
const LOAD_FAILURE = /^(?:llama_model_load: error loading model|llama_init_from_model: failed to initialize the context):\s*(.+)/;
const ROLES = new Set(['system', 'user', 'assistant']);
const encoder = new TextEncoder();
const yieldWorker = () => new Promise(resolve => setTimeout(resolve, 0));
let runtime;
let loaded = false;
let modelKind;
let request;
let loadFailure;

async function loadModel(files, kind) {
  if (!Array.isArray(files) || !files.length) throw new Error('Choose a valid GGUF model.');
  const first = /^(.*)-00001-of-(\d{5})\.gguf$/i.exec(files[0]?.name);
  if (first) {
    if (Number(first[2]) !== files.length || files.some((file, index) =>
      file?.name.replace(/\.gguf$/i, '.gguf') !== `${first[1]}-${String(index + 1).padStart(5, '0')}-of-${first[2]}.gguf`)) {
      throw new Error('Select every part of the split GGUF model.');
    }
  } else if (files.length !== 1 || /-\d{5}-of-\d{5}\.gguf$/i.test(files[0]?.name)) {
    throw new Error('Select one GGUF model or every part of a split model.');
  }
  const blobs = [];
  for (const file of files) {
    if (!(file instanceof Blob) || file.size < 24) throw new Error('Choose a valid GGUF model.');
    const magic = new TextDecoder().decode(await file.slice(0, 4).arrayBuffer());
    if (magic !== 'GGUF') throw new Error('This file is not a GGUF model.');
    blobs.push({ name: first ? file.name.replace(/\.gguf$/i, '.gguf') : 'weights.gguf', data: file });
  }

  if (!runtime) {
    // Keep llama.cpp on the worker and read from the Blob, keeping a second full
    // model out of the WebAssembly heap.
    const version = new URL(import.meta.url).search;
    const { default: createRuntime } = await import(`./lma-runtime.mjs${version}`);
    runtime = await createRuntime({
      locateFile: path => new URL(`${path}${version}`, import.meta.url).href,
      printErr(message) {
        const failure = LOAD_FAILURE.exec(message);
        if (failure) loadFailure = failure[1].trim().slice(0, 240);
        console.error(message);
      },
    });
    runtime.FS.mkdir(MODEL_PATH);
  }

  runtime.FS.mount(runtime.WORKERFS, { blobs }, MODEL_PATH);
  try {
    loaded = false;
    loadFailure = undefined;
    const result = runtime.ccall('lma_load', 'number', ['string', 'number', 'boolean'], [
      `${MODEL_PATH}/${blobs[0].name}`, MODEL_CONTEXT_TOKENS, kind === 'agent',
    ]);
    if (result === -2 || result === -3) {
      const stage = result === -2 ? 'Could not load the GGUF weights.' : 'Could not initialize the model context.';
      throw new Error(loadFailure ? `${stage} ${loadFailure}` : stage);
    }
    if (result !== 0) throw new Error(`The browser runner could not initialize the model (${result}).`);
    loaded = true;
  } finally {
    runtime.FS.unmount(MODEL_PATH);
  }
}

function beginCompletion(prompt, messages, tools, qwenToolChat, temperature, seed) {
  if (qwenToolChat || (modelKind === 'agent' && messages)) {
    if (!Array.isArray(messages) || !messages.length || messages.length > 128) {
      throw new Error('Invalid chat messages.');
    }
    const rendered = qwenToolPrompt(messages, tools, { disableThinking: modelKind === 'agent' });
    if (encoder.encode(rendered).length > 65536 || rendered.includes('\0')) {
      throw new Error('The LMA request is too large. Send less project context or start a new thread.');
    }
    return runtime.ccall('lma_begin', 'number', ['string', 'number', 'number'], [rendered, temperature, seed]);
  }
  if (messages === undefined) {
    if (typeof prompt !== 'string' || !prompt.length || prompt.length > 32768 || prompt.includes('\0')) {
      throw new Error('Invalid completion prompt.');
    }
    return runtime.ccall('lma_begin', 'number', ['string', 'number', 'number'], [prompt, temperature, seed]);
  }

  if (!Array.isArray(messages) || !messages.length || messages.length > 128) {
    throw new Error('Invalid chat messages.');
  }
  let bytes = 0;
  const parts = [];
  for (const message of messages) {
    if (!ROLES.has(message?.role) || typeof message.content !== 'string' || message.content.includes('\0')) {
      throw new Error('Invalid chat message.');
    }
    if (message.content.length > 65536 - bytes) throw new Error('The chat exceeds the model context.');
    const part = encoder.encode(`${message.role}\0${message.content}\0`);
    bytes += part.length;
    if (bytes > 65536) throw new Error('The chat exceeds the model context.');
    parts.push(part);
  }
  const input = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    input.set(part, offset);
    offset += part.length;
  }
  return runtime.ccall('lma_begin_chat', 'number', ['array', 'number', 'number', 'number'], [input, bytes, temperature, seed]);
}

async function complete(job, { prompt, messages, tools = [], qwenToolChat = false,
  maxTokens, temperature = 0, seed = 0, stop = [] }) {
  if (!loaded) throw new Error('Load a GGUF model first.');
  if (qwenToolChat && modelKind !== 'agent') throw new Error('Load the Qwen3 model to use tools.');
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 256
      || !Number.isFinite(temperature) || temperature < 0 || temperature > 2
      || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('Invalid completion request.');
  }
  if (!Array.isArray(stop) || stop.length > 16
      || stop.some(sequence => typeof sequence !== 'string' || !sequence.length || sequence.length > 128)) {
    throw new Error('Invalid stop sequences.');
  }
  const promptTokens = beginCompletion(prompt, messages, tools, qwenToolChat, temperature, seed);
  if (promptTokens === -2) {
    throw new Error(`This request exceeds LMA’s ${MODEL_CONTEXT_TOKENS.toLocaleString('en-US')}-token context. Send less project context or start a new thread.`);
  }
  if (promptTokens < 0) throw new Error('LMA could not process the prompt.');
  const cachedPromptTokens = runtime._lma_cached_prompt_tokens();

  const address = runtime._malloc(OUTPUT_BYTES);
  if (!address) throw new Error('LMA could not allocate token output.');
  const decoder = new TextDecoder();
  let calledTool = false;
  const send = event => {
    if (calledTool) return;
    calledTool = Boolean(event.toolCall);
    postMessage({ id: job.id, ...event });
  };
  const toolStream = tools.length ? new QwenToolStream(tools, send) : null;
  let pendingText = '';
  const sendText = (text, final = false) => {
    pendingText += text;
    let end = pendingText.length;
    let matched = false;
    for (const sequence of stop) {
      const position = pendingText.indexOf(sequence);
      if (position >= 0) {
        end = Math.min(end, position);
        matched = true;
      }
    }
    if (!matched && !final) {
      // Hold any partial match crossing a token boundary.
      for (const sequence of stop) {
        for (let length = Math.min(sequence.length - 1, pendingText.length); length > 0; length--) {
          if (pendingText.endsWith(sequence.slice(0, length))) {
            end = Math.min(end, pendingText.length - length);
            break;
          }
        }
      }
    }
    if (end) {
      const text = pendingText.slice(0, end);
      if (toolStream) toolStream.push(text);
      else send({ text });
    }
    pendingText = matched ? '' : pendingText.slice(end);
    return matched;
  };
  let written = 0;
  let finishReason = 'length';
  let stoppedBySequence = false;
  try {
    let remainingPrompt = promptTokens - cachedPromptTokens;
    while (remainingPrompt > 0 && !job.cancelled) {
      remainingPrompt = runtime._lma_prefill();
      if (remainingPrompt < 0) throw new Error('LMA could not evaluate the prompt.');
      if (remainingPrompt > 0) await yieldWorker();
    }
    const outputBudget = Math.min(maxTokens, MODEL_CONTEXT_TOKENS - promptTokens);
    for (; written < outputBudget && !job.cancelled; written++) {
      const size = runtime._lma_next(address, OUTPUT_BYTES, Boolean(toolStream));
      if (size === -2) {
        finishReason = 'stop';
        break;
      }
      if (size < 0) throw new Error('LMA could not decode the next token.');
      const text = decoder.decode(runtime.HEAPU8.subarray(address, address + size), { stream: true });
      if (sendText(text) || calledTool) {
        finishReason = calledTool ? 'tool_calls' : 'stop';
        stoppedBySequence = true;
        written++;
        break;
      }
      if ((written + 1) % 4 === 0) await yieldWorker();
    }
    if (!job.cancelled && !stoppedBySequence) {
      sendText(decoder.decode(), true);
    }
    if (!job.cancelled) {
      if (!calledTool) toolStream?.finish();
      if (calledTool) finishReason = 'tool_calls';
    }
    postMessage({ id: job.id, done: true, finishReason: job.cancelled ? 'cancelled' : finishReason,
      promptTokens, cachedPromptTokens, completionTokens: written });
  } catch (error) {
    runtime._lma_reset();
    throw error;
  } finally {
    runtime._free(address);
    runtime._lma_finish();
  }
}

self.addEventListener('message', async ({ data }) => {
  if (data.type === 'cancel') {
    if (request?.id === data.id) request.cancelled = true;
    return;
  }
  if (request) {
    postMessage({ id: data.id, error: 'LMA is busy.' });
    return;
  }
  const job = { id: data.id, cancelled: false };
  request = job;
  try {
    if (data.type === 'load') {
      await loadModel(data.files, data.modelKind);
      modelKind = data.modelKind;
      postMessage({ id: job.id, loaded: true });
    } else if (data.type === 'complete') {
      await complete(job, data);
    } else {
      throw new Error('Unknown LMA request.');
    }
  } catch (error) {
    postMessage({ id: job.id, error: error.message });
  } finally {
    request = undefined;
  }
});
