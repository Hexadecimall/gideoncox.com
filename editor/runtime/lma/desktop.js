export function desktopUrl(value) {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash ||
    !['/', '/v1', '/v1/'].includes(url.pathname)) {
    throw new Error('Use the address of an LMA server on this computer.');
  }
  return url.origin;
}

async function request(url, token, options = {}) {
  let result;
  try {
    result = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new Error('Could not reach LMA. Check that it is serving and allows this site.');
  }
  if (!result.ok) throw new Error(`LMA returned HTTP ${result.status}.`);
  return result;
}

export class DesktopLma {
  constructor(receive) {
    this.receive = receive;
  }

  async connect(url, key) {
    const origin = desktopUrl(url);
    const response = await request(origin + '/v1/models', key, { signal: AbortSignal.timeout(10_000) });
    const catalog = await response.json();
    if (!Array.isArray(catalog.data)) throw new Error('LMA did not return a model list.');
    const models = catalog.data.map(item => item.id)
      .filter(id => typeof id === 'string' && id.length > 0 && id.length <= 256).slice(0, 100);
    this.disconnect();
    this.connection = { origin, key, models: new Set(models) };
    return models;
  }

  disconnect() {
    if (this.current) {
      this.current.controller.abort();
      this.emit(this.current.id, { error: 'Desktop LMA disconnected.' });
    }
    this.current = undefined;
    this.connection = undefined;
  }

  cancel(id) {
    if (this.current?.id !== id) return false;
    this.current.controller.abort();
    return true;
  }

  start(id, options) {
    if (!this.connection?.models.has(options.desktopModel)) throw new Error('Connect to the desktop LMA server in Settings.');
    if (this.current) throw new Error('Desktop LMA is already generating a reply.');
    const { origin, key } = this.connection;
    const job = { id, controller: new AbortController() };
    this.current = job;
    this.complete(job, origin, key, options)
      .catch(error => {
        if (!job.controller.signal.aborted) this.emit(id, { error: error.message });
      })
      .finally(() => {
        if (this.current === job) this.current = undefined;
      });
  }

  emit(id, message) {
    this.receive(id, JSON.stringify(message));
  }

  async complete({ id, controller }, origin, key, options) {
    const response = await request(origin + '/v1/chat/completions', key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: options.desktopModel,
        messages: options.messages.map(({ role, content }) => ({ role, content })),
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });
    if (!response.body) throw new Error('LMA did not return a response stream.');
    let buffer = '';
    let finishReason = 'stop';
    let usage = {};
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      if (buffer.length > 1_000_000) throw new Error('LMA returned an invalid response.');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          this.emit(id, { done: true, finishReason, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens });
          return;
        }
        if (!data) continue;
        const event = JSON.parse(data);
        if (event.error) throw new Error(event.error.message ?? 'Desktop LMA generation failed.');
        const choice = event.choices?.[0];
        if (choice?.delta?.content) this.emit(id, { text: choice.delta.content });
        finishReason = choice?.finish_reason ?? finishReason;
        usage = event.usage ?? usage;
      }
    }
    throw new Error('The desktop LMA response ended before completion.');
  }
}
