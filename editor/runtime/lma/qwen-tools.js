const OPEN = '<tool_call>';
const CLOSE = '</tool_call>';
const START = '<|im_start|>';
const END = '<|im_end|>';
const MAX_TOOL_BYTES = 16_384;
const DEFAULT_SYSTEM = 'You are Qwen, created by Alibaba Cloud. You are a helpful assistant.';
const MODEL_TOOL_DESCRIPTIONS = {
  find_path: 'Find project files matching a glob.',
  grep: 'Search project files for text.',
  list_directory: 'List the files in a project directory.',
  read_file: 'Read the contents of a project file.',
};
const SCHEMA_ANNOTATIONS = new Set(['$schema', 'title', 'description', 'examples', 'default']);

function promptText(value) {
  // Content must not supply model role tokens or tool delimiters.
  return value.replace(/<(?=\||\/?tool(?:s|_(?:call|response))>)/g, '＜');
}

function promptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function zedSystemPrompt(content) {
  if (!content.startsWith('You are the Zed coding agent running inside the Zed editor.')) return content;
  const environment = /\n## System Information\n([\s\S]*?)(?=\n## |$)/.exec(content)?.[1];
  if (!environment) return content;
  const instructionsStart = content.indexOf("\n## User's Custom Instructions\n");
  const instructions = instructionsStart >= 0 ? content.slice(instructionsStart) : '';
  const roots = Array.from(environment.matchAll(/^- `([^\n`]+)`$/gm), ([, path]) => path.split('/').pop());
  return [
    'You are assisting in a Zed editor workspace. Use tools to read files.',
    roots.length ? `Project roots: ${roots.join(', ')}. Tool paths start with a project root name.` : '',
    instructions.trim(),
  ].filter(Boolean).join('\n\n');
}

function modelSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(modelSchema);
  return Object.fromEntries(Object.entries(schema)
    .filter(([key]) => !SCHEMA_ANNOTATIONS.has(key))
    .map(([key, value]) => ['properties', 'definitions', '$defs'].includes(key)
      ? [key, Object.fromEntries(Object.entries(value).map(([name, child]) => [name, modelSchema(child)]))]
      : [key, modelSchema(value)]));
}

function modelTool(tool) {
  const { name, description, parameters } = tool.function;
  return {
    type: tool.type,
    function: { name, description: MODEL_TOOL_DESCRIPTIONS[name] ?? description, parameters: modelSchema(parameters) },
  };
}

// Qwen2.5's Hermes wire format, including grouped tool responses.
export function qwenToolPrompt(messages, tools, { disableThinking = false } = {}) {
  const firstIsSystem = messages[0]?.role === 'system';
  const system = firstIsSystem ? promptText(zedSystemPrompt(messages[0].content)) : DEFAULT_SYSTEM;
  const sections = [START + 'system\n' + system];
  if (tools.length) {
    sections.push(
      '\n\n# Tools\n\nUse these functions to assist the user. Their signatures appear below.\n<tools>\n',
      tools.map(tool => promptJson(modelTool(tool))).join('\n'),
      '\n</tools>\n\nWrap every function call in <tool_call></tool_call> tags:\n',
      '<tool_call>\n{"name": <function-name>, "arguments": <args-json-object>}\n</tool_call>',
    );
  }
  sections.push(END + '\n');

  let previousRole = 'system';
  for (const { role, content, toolCalls = [] } of messages.slice(Number(firstIsSystem))) {
    if (role === 'tool') {
      if (previousRole !== 'tool') sections.push(START + 'user');
      sections.push('\n<tool_response>\n', promptText(content), '\n</tool_response>');
    } else {
      if (previousRole === 'tool') sections.push(END + '\n');
      sections.push(START, role);
      if (content || !toolCalls.length) sections.push('\n', promptText(content));
      for (const call of toolCalls) sections.push('\n', OPEN, '\n', promptJson(call), '\n', CLOSE);
      sections.push(END + '\n');
    }
    previousRole = role;
  }
  if (previousRole === 'tool') sections.push(END + '\n');
  sections.push(START + 'assistant\n');
  if (disableThinking) sections.push('<think>\n\n</think>\n\n');
  return sections.join('');
}

function endOfToolCall(text) {
  let inString = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString && char === '\\') index++;
    else if (char === '"') inString = !inString;
    else if (!inString && char === '<' && text.startsWith(CLOSE, index)) return index;
  }
  return -1;
}

export class QwenToolStream {
  constructor(tools, receive) {
    this.names = new Set(tools.map(tool => tool.function.name));
    this.receive = receive;
    this.pending = '';
    this.inCall = false;
    this.count = 0;
    this.first = '';
  }

  push(text) {
    // Small Qwen models sometimes produce the function object without tags.
    // Only a complete standalone JSON object can use that fallback.
    if (this.first !== null) {
      this.first += text;
      const trimmed = this.first.trimStart();
      if ((!trimmed.length || trimmed.startsWith('{')) && this.first.length <= MAX_TOOL_BYTES) return;
      text = this.first;
      this.first = null;
    }
    this.pending += text;
    while (this.pending.length) {
      if (this.inCall) {
        const end = endOfToolCall(this.pending);
        if (end < 0) {
          if (this.pending.length > MAX_TOOL_BYTES) throw new Error('The local tool call is too long.');
          return;
        }
        this.call(this.pending.slice(0, end));
        this.pending = this.pending.slice(end + CLOSE.length);
        this.inCall = false;
      } else {
        const start = this.pending.indexOf(OPEN);
        if (start >= 0) {
          this.text(this.pending.slice(0, start));
          this.pending = this.pending.slice(start + OPEN.length);
          this.inCall = true;
        } else {
          // Preserve only a suffix that might turn into an opening tag.
          let length = Math.min(this.pending.length, OPEN.length - 1);
          while (length && !OPEN.startsWith(this.pending.slice(-length))) length--;
          const split = this.pending.length - length;
          this.text(this.pending.slice(0, split));
          this.pending = this.pending.slice(split);
          return;
        }
      }
    }
  }

  text(text) {
    if (text) this.receive({ text });
  }

  call(payload) {
    let call;
    try {
      call = JSON.parse(payload);
    } catch {
      throw new Error('The local model returned an invalid tool call.');
    }
    this.emitCall(call);
  }

  emitCall(call) {
    if (!this.names.has(call?.name) || !call.arguments
        || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) {
      throw new Error('The local model requested an unavailable tool or supplied invalid arguments.');
    }
    this.receive({ toolCall: { name: call.name, arguments: call.arguments } });
    this.count++;
  }

  finish() {
    if (this.first !== null) {
      let call;
      try {
        call = JSON.parse(this.first);
      } catch {
        // A partial object or prose beginning with a brace is ordinary text.
      }
      if (call && Object.keys(call).length === 2
          && Object.hasOwn(call, 'name') && Object.hasOwn(call, 'arguments')) {
        this.emitCall(call);
      } else {
        this.text(this.first);
      }
      this.first = null;
    }
    if (this.inCall) throw new Error('The local model stopped before finishing its tool call.');
    this.text(this.pending);
    this.pending = '';
  }
}
