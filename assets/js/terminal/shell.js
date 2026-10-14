import { Ark, Files } from './wasm.js';

const empty = (code = 0) => ({ out: '', err: '', code, actions: [] });
const append = (target, source) => {
  target.out += source.out;
  target.err += source.err;
  target.code = source.code;
  target.actions.push(...source.actions);
  if (target.out.length + target.err.length > 1024 * 1024) throw new Error('Output limit reached');
  return target;
};

// Glob matching is limited to browser paths. A slash must match a slash and
// hidden entries require an explicit dot in the corresponding path segment.
export function patternMatch(pattern, value) {
  let expression = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') expression += '[^/]*';
    else if (c === '?') expression += '[^/]';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end > i + 1) { expression += '[' + pattern.slice(i + 1, end).replace(/^!/, '^').replace(/\\/g, '\\\\') + ']'; i = end; }
      else expression += '\\[';
    } else expression += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  try { return new RegExp(expression + '$').test(value); } catch { return pattern === value; }
}

export class Shell {
  constructor(arkModule, rustModule) {
    this.files = new Files(rustModule);
    this.env = { HOME: '/home/web', USER: 'web', PWD: '/home/web', SHELL: 'ark', TERM: 'dumb' };
    this.args = []; 
    this.functions = new Map();
    this.aliases = new Map();
    this.status = 0;
    this.depth = 0;
    this.loopDepth = 0;
    this.functionDepth = 0;
    this.flow = null;
    this.ark = new Ark(arkModule, { capture: source => this.capture(source), glob: pattern => this.glob(pattern) });
  }
  expand(words, single = false) { return this.ark.expand(words, this.env, this.args, this.status, single); }
  glob(pattern) {
    const absolute = this.files.request('resolve', pattern)[0];
    const parts = absolute.split('/');
    const cwd = this.files.request('cwd')[0];
    return this.files.request('paths').filter(path => {
      if (!patternMatch(absolute, path)) return false;
      return path.split('/').every((part, index) => !part.startsWith('.') || parts[index]?.startsWith('.'));
    }).map(path => pattern.startsWith('/') ? path : path.startsWith(cwd + '/') ? path.slice(cwd.length + 1) : path);
  }
  isolated(callback) {
    const saved = { env: this.env, args: this.args, functions: this.functions, aliases: this.aliases, flow: this.flow, status: this.status };
    const cwd = this.files.request('cwd')[0];
    this.env = { ...this.env };
    this.functions = new Map(this.functions);
    this.aliases = new Map(this.aliases);
    this.flow = null;
    try { return callback(); }
    finally {
      Object.assign(this, saved);
      try { this.files.request('chdir', cwd); } catch { /* A child may remove its former directory. */ }
    }
  }
  capture(source) { return this.isolated(() => this.execute(this.ark.parse(source)).out.replace(/\n+$/, '')); }
  run(source) {
    this.steps = 0;
    this.deadline = Date.now() + 4000;
    this.flow = null;
    const tree = this.ark.parse(source);
    const result = this.execute(tree);
    this.flow = null;
    return { ...result, cwd: this.files.request('cwd')[0] };
  }
  execute(node, input = '') {
    if (!node) return empty();
    if (++this.steps > 10000 || Date.now() > this.deadline) throw new Error('Command limit reached. Ctrl+C stops a running command.');
    if (++this.depth > 64) { this.depth--; throw new Error('Shell nesting limit reached'); }
    try {
      if (node.background) throw new Error('Background jobs are unavailable in the browser');
      // Bind descriptors in order, so 2>&1 >file differs from >file 2>&1.
      const stdout = { text: '' }, stderr = { text: '' };
      const descriptors = { 1: stdout, 2: stderr };
      const targets = [];
      for (const redirect of node.redirects) {
        const target = redirect.kind === 4 && !redirect.expand ? redirect.target : this.expand([redirect.target], true);
        if (redirect.kind === 0) input = this.files.request('read', target)[0];
        else if (redirect.kind === 4) input = target;
        else if (redirect.kind === 5) {
          if (![1, 2].includes(redirect.fd) || ![1, 2].includes(redirect.dup)) throw new Error('Only stdout/stderr descriptor duplication is supported');
          descriptors[redirect.fd] = descriptors[redirect.dup];
        } else {
          const fd = redirect.fd >= 0 ? redirect.fd : redirect.kind === 3 ? 2 : 1;
          if (![1, 2].includes(fd)) throw new Error('Only stdout/stderr file redirection is supported');
          this.files.request(redirect.kind === 2 ? 'append' : 'write', target, '');
          const sink = { text: '', path: target };
          targets.push(sink);
          descriptors[fd] = sink;
        }
      }
      const result = this.dispatch(node, input);
      descriptors[1].text += result.out;
      descriptors[2].text += result.err;
      for (const sink of targets) if (sink.text) this.files.request('append', sink.path, sink.text);
      result.out = stdout.text;
      result.err = stderr.text;
      if (node.negate) result.code = result.code === 0 ? 1 : 0;
      this.status = result.code;
      this.env.PWD = this.files.request('cwd')[0];
      return result;
    } finally { this.depth--; }
  }
  dispatch(node, input) {
    let result = empty();
    switch (node.kind) {
      case 0: return this.command(node.words, input);
      case 1: {
        if (node.children.some(child => child.kind === 0 && !child.words.length && !child.redirects.length)) throw new Error('Expected a command beside the pipe');
        let stream = input;
        for (const child of node.children) {
          const part = this.isolated(() => this.execute(child, stream));
          stream = part.out;
          result.err += part.err;
          result.actions.push(...part.actions);
          result.code = part.code;
        }
        result.out = stream;
        return result;
      }
      case 2: {
        const condition = this.execute(node.children[0], input);
        append(result, condition);
        const body = condition.code === 0 ? node.children[1] : node.children[2];
        if (!this.flow) append(result, this.execute(body, input));
        return result;
      }
      case 3:
      case 4: {
        if (node.forVar === '\x1e') throw new Error('C-style for loops are not available in this browser port');
        const values = node.kind === 4 ? this.expand(node.forWords) : null;
        this.loopDepth++;
        try {
          let index = 0;
          while (true) {
            if (values) {
              if (index >= values.length) break;
              this.env[node.forVar] = values[index++];
            } else {
              const condition = this.execute(node.children[0], input);
              const code = condition.code;
              result.out += condition.out; result.err += condition.err;
              if (code !== 0 || this.flow) break;
            }
            append(result, this.execute(node.children[values ? 0 : 1], input));
            if (this.flow?.kind === 'return' || this.flow?.kind === 'exit') break;
            if (this.flow) {
              if (--this.flow.level > 0) break;
              const stop = this.flow.kind === 'break';
              this.flow = null;
              if (stop) break;
            }
          }
        } finally { if (--this.loopDepth === 0 && ['break', 'continue'].includes(this.flow?.kind)) this.flow = null; }
        return result;
      }
      case 5: {
        const word = this.expand([node.caseWord], true);
        for (const [pattern, body] of node.clauses) {
          if (pattern.split('|').some(part => patternMatch(this.expand([part], true), word))) return this.execute(body, input);
        }
        return result;
      }
      case 6: this.functions.set(node.name, node.body); return result;
      case 7:
        for (let i = 0; i < node.children.length; i++) {
          const join = node.children[i - 1]?.join;
          if (join === 1 && result.code !== 0 || join === 2 && result.code === 0) continue;
          append(result, this.execute(node.children[i], input));
          if (this.flow) break;
        }
        return result;
      case 8: return this.isolated(() => this.execute(node.children[0], input));
      case 9: return this.execute(node.children[0], input);
      default: throw new Error('Unsupported Ark syntax');
    }
  }
  command(rawWords, input) {
    const words = [...rawWords];
    const assignments = [];
    while (words.length && /^[A-Za-z_][A-Za-z_0-9]*=/.test(words[0])) {
      const word = words.shift();
      const equals = word.indexOf('=');
      assignments.push([word.slice(0, equals), this.expand([word.slice(equals + 1)], true)]);
    }
    const savedEnv = this.env;
    if (words.length) this.env = { ...this.env };
    for (const [name, value] of assignments) this.env[name] = value;
    try {
      const args = this.expand(words);
      if (!args.length) return empty();
      const [command, ...rest] = args;
      const result = empty();
      if (this.aliases.has(command)) {
        const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
        return this.execute(this.ark.parse(this.aliases.get(command) + ' ' + rest.map(quote).join(' ')), input);
      }
      if (this.functions.has(command)) {
        const oldArgs = this.args;
        this.args = rest; this.functionDepth++;
        try {
          const reply = this.execute(this.functions.get(command), input);
          if (this.flow?.kind === 'return') this.flow = null;
          return reply;
        } finally { this.args = oldArgs; this.functionDepth--; }
      }
      switch (command) {
        case 'export':
          for (const arg of rest) {
            const index = arg.indexOf('=');
            const key = index < 0 ? arg : arg.slice(0, index);
            if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(key)) throw new Error('export: invalid variable name');
            this.env[key] = index < 0 ? this.env[key] || '' : arg.slice(index + 1);
          }
          break;
        case 'unset': for (const key of rest) delete this.env[key]; break;
        case 'env': result.out = Object.entries(this.env).map(([key, value]) => `${key}=${value}\n`).join(''); break;
        case 'alias':
          if (!rest.length) result.out = [...this.aliases].map(([key, value]) => `${key}=${value}\n`).join('');
          for (const arg of rest) { const index = arg.indexOf('='); if (index < 1) throw new Error('usage: alias name=command'); this.aliases.set(arg.slice(0, index), arg.slice(index + 1)); }
          break;
        case 'unalias': for (const key of rest) this.aliases.delete(key); break;
        case 'break': case 'continue': {
          if (!this.loopDepth) throw new Error(`${command}: not inside a loop`);
          const level = Number(rest[0] || 1);
          if (!Number.isInteger(level) || level < 1) throw new Error('Loop level must be a positive integer');
          this.flow = { kind: command, level }; break;
        }
        case 'return': case 'exit':
          if (command === 'return' && !this.functionDepth) throw new Error('return: not inside a function');
          result.code = (Number(rest[0] ?? this.status) || 0) & 255;
          this.flow = { kind: command }; break;
        case 'source': case '.': case 'ark':
          if (!rest.length) throw new Error('usage: source file');
          return this.execute(this.ark.parse(this.files.request('read', rest[0])[0]), input);
        default: {
          const reply = this.files.command(args, input);
          return { out: reply.out, err: reply.err, code: reply.code, actions: reply.action ? [reply.action] : [] };
        }
      }
      return result;
    } finally {
      // Prefix assignments are local to a command. Ordinary shell assignments
      // and export/unset persist in the current scope.
      if (words.length && assignments.length) {
        for (const [key, value] of Object.entries(this.env)) if (!assignments.some(([name]) => name === key)) savedEnv[key] = value;
        this.env = savedEnv;
      }
    }
  }
}
