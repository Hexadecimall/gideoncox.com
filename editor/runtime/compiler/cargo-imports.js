const decoder = new TextDecoder('utf-8', { fatal: true });
export const MAX_TOOL_BYTES = 1024 * 1024;

/** The WASIp1 process imports used by the browser Cargo fork. */
export function cargoImports(animal, imports, instance) {
  const { memory } = imports.env;
  const read = (address, length) => {
    if ((length >>> 0) > MAX_TOOL_BYTES) throw new Error('Cargo subprocess input is too large.');
    return new Uint8Array(memory.buffer, address >>> 0, length >>> 0).slice();
  };
  const readList = (address, length) => {
    if (!length) return [];
    const text = decoder.decode(read(address, length));
    if (!text.endsWith('\0')) throw new Error('Cargo subprocess argument list is malformed.');
    return text.slice(0, -1).split('\0');
  };
  const write = (bytes, pointerAddress, lengthAddress) => {
    const address = instance().exports.wasi_ext_allocate(bytes.length) >>> 0;
    if (!address && bytes.length) throw new Error('Cargo could not allocate subprocess output.');
    new Uint8Array(memory.buffer, address, bytes.length).set(bytes);
    const view = new DataView(memory.buffer);
    view.setUint32(pointerAddress >>> 0, address, true);
    view.setUint32(lengthAddress >>> 0, bytes.length, true);
  };
  return {
    ...imports,
    '__wasip1_vfs-host': {
      wasi_ext_fetch: () => 1,
      wasi_ext_git_clone: () => 1,
      wasi_ext_git_fetch: () => 1,
      wasi_ext_spawn(
        program, programLength, args, argsLength, env, envLength,
        cwd, cwdLength, stdin, stdinLength, code, out, outLength, err, errLength,
      ) {
        const result = animal.call_unknown_fn(0, {
          program: decoder.decode(read(program, programLength)),
          args: readList(args, argsLength),
          env: readList(env, envLength),
          cwd: decoder.decode(read(cwd, cwdLength)),
          stdin: Array.from(read(stdin, stdinLength)),
        });
        write(result.stdout, out, outLength);
        write(result.stderr, err, errLength);
        new DataView(memory.buffer).setInt32(code >>> 0, result.code, true);
        return 0;
      },
    },
  };
}
