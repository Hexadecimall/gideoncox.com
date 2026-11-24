const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_TOOL_OUTPUT = 2 * 1024 * 1024;

function view(memory, pointer, length) {
  return new Uint8Array(memory.buffer, pointer >>> 0, length >>> 0);
}

export function wasiImports(animal, imports, instance) {
  const memory = imports.env.memory;
  const call = message => animal.call_unknown_fn(0, message);
  const { fd_read: read } = imports.wasi_snapshot_preview1;
  return {
    ...imports,
    wasi_snapshot_preview1: {
      ...imports.wasi_snapshot_preview1,
      fd_read(fd, iovs, count, result) {
        if (fd !== 0) return read(fd, iovs, count, result);
        const vectors = new DataView(memory.buffer, iovs >>> 0, (count >>> 0) * 8);
        let available = 0;
        for (let index = 0; index < count; index++) available += vectors.getUint32(index * 8 + 4, true);
        const bytes = new Uint8Array(call({ type: 'read', length: Math.min(available, 65536) }));
        let written = 0;
        for (let index = 0; index < count && written < bytes.length; index++) {
          const pointer = vectors.getUint32(index * 8, true);
          const length = Math.min(vectors.getUint32(index * 8 + 4, true), bytes.length - written);
          view(memory, pointer, length).set(bytes.subarray(written, written + length));
          written += length;
        }
        new DataView(memory.buffer).setUint32(result >>> 0, written, true);
        return 0;
      },
    },
    '__wasip1_vfs-host': {
      zed_vfs_snapshot(list, path, pathLength, output, capacity) {
        const name = decoder.decode(view(memory, path, pathLength).slice());
        return call({ type: 'snapshot', list: list === 1, path: name, output: output >>> 0, capacity: capacity >>> 0 });
      },
      host_run_cargo(request, requestLength, stdoutPointer, stdoutLength, stderrPointer, stderrLength, statusPointer) {
        let stdoutAddress = 0;
        let stderrAddress = 0;
        let stdout;
        let stderr;
        const { zed_tool_output_alloc: allocate, zed_tool_output_free: free } = instance().exports;
        try {
          // Chrome's TextDecoder needs an unshared snapshot of the WASI arguments.
          const args = JSON.parse(decoder.decode(view(memory, request, requestLength).slice())).args;
          const reply = call({ type: 'tool', args });
          stdout = encoder.encode(reply.stdout ?? '');
          stderr = encoder.encode(reply.stderr ?? '');
          if (stdout.length > MAX_TOOL_OUTPUT || stderr.length > MAX_TOOL_OUTPUT) return 1;
          for (const [bytes, assign] of [
            [stdout, address => { stdoutAddress = address; }],
            [stderr, address => { stderrAddress = address; }],
          ]) {
            if (!bytes.length) continue;
            const address = allocate(bytes.length) >>> 0;
            if (!address) throw new Error('Tool output allocation failed.');
            assign(address);
            view(memory, address, bytes.length).set(bytes);
          }
          const output = new DataView(memory.buffer);
          output.setUint32(stdoutPointer >>> 0, stdoutAddress, true);
          output.setUint32(stdoutLength >>> 0, stdout.length, true);
          output.setUint32(stderrPointer >>> 0, stderrAddress, true);
          output.setUint32(stderrLength >>> 0, stderr.length, true);
          output.setInt32(statusPointer >>> 0, reply.status, true);
          return 0;
        } catch {
          if (stdoutAddress) free(stdoutAddress, stdout.length);
          if (stderrAddress) free(stderrAddress, stderr.length);
          return 1;
        }
      },
      host_free_memory(pointer, length) {
        instance().exports.zed_tool_output_free(pointer, length);
      },
    },
  };
}
