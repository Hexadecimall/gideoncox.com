
export function read_snapshot(name) { return globalThis.zedDatabase?.read(name); }
export function write_snapshot(name, snapshot) {
    globalThis.zedDatabase?.write(name, snapshot.slice());
}
