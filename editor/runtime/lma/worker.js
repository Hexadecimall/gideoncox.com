import { QwenToolStream, qwenToolPrompt } from './qwen-tools.js?v=3';

const MAX_MODEL_BYTES = 512 * 1024 * 1024;
const MODEL_CONTEXT_TOKENS = 8192;
const OUTPUT_BYTES = 4096;
const MODEL_PATH = '/model';
const ROLES = new Set(['system', 'user', 'assistant']);
const encoder = new TextEncoder();
const yieldWorker = () => new Promise(resolve => setTimeout(resolve, 0));
let runtime;
let loaded = false;
let modelKind;
let request;

async function loadModel(file, kind) {
  if (!(file instanceof Blob) || file.size < 24 || file.size > MAX_MODEL_BYTES) {
    throw new Error('Choose a GGUF model up to 512 MB.');
  }
  const magic = new TextDecoder().decode(await file.slice(0, 4).arrayBuffer());
  if (magic !== 'GGUF') throw new Error('This file is not a GGUF model.');

  if (!runtime) {
    // Keep llama.cpp on the worker and read from the Blob, keeping a second full
    // model out of the WebAssembly heap.
    const version = new URL(import.meta.url).search;
    const { default: createRuntime } = await import(`./lma-runtime.mjs${version}`);
    runtime = await createRuntime({ locateFile: path => new URL(`${path}${version}`, import.meta.url).href });
    runtime.FS.mkdir(MODEL_PATH);
  }

  runtime.FS.mount(runtime.WORKERFS, { blobs: [{ name: 'weights.gguf', data: file }] }, MODEL_PATH);
  try {
    loaded = false;
    const result = runtime.ccall('lma_load', 'number', ['string', 'number', 'boolean'], [
      `${MODEL_PATH}/weights.gguf`, MODEL_CONTEXT_TOKENS, kind === 'agent',
    ]);
    if (result !== 0) throw new Error('LMA could not load this GGUF model.');
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
      await loadModel(data.file, data.modelKind);
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
