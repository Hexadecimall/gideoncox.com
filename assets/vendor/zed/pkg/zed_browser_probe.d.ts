/* tslint:disable */
/* eslint-disable */

export function editor_text(): string;

export function list_files(): Promise<string>;

export function open_file(path: string): Promise<void>;

export function save_file(path: string): Promise<void>;

export function set_editor_text(text: string): void;

export function set_file_path(path: string): string;

export function set_font_size(size: number): void;

export function start(): void;

/**
 * Entry point for web workers
 */
export function wasm_thread_entry_point(ptr: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly memcmp: (a: number, b: number, c: number) => number;
    readonly editor_text: (a: number) => void;
    readonly list_files: () => number;
    readonly open_file: (a: number, b: number) => number;
    readonly save_file: (a: number, b: number) => number;
    readonly set_editor_text: (a: number, b: number, c: number) => void;
    readonly set_file_path: (a: number, b: number, c: number) => void;
    readonly set_font_size: (a: number, b: number) => void;
    readonly start: () => void;
    readonly strlen: (a: number) => number;
    readonly zed_sqlite_log: (a: number) => number;
    readonly zed_sqlite_now: () => number;
    readonly zed_sqlite_random: (a: number, b: number) => number;
    readonly abort: () => void;
    readonly calloc: (a: number, b: number) => number;
    readonly free: (a: number) => void;
    readonly malloc: (a: number) => number;
    readonly realloc: (a: number, b: number) => number;
    readonly wasm_thread_entry_point: (a: number) => void;
    readonly rust_zstd_wasm_shim_calloc: (a: number, b: number) => number;
    readonly rust_zstd_wasm_shim_free: (a: number) => void;
    readonly rust_zstd_wasm_shim_malloc: (a: number) => number;
    readonly rust_zstd_wasm_shim_memcmp: (a: number, b: number, c: number) => number;
    readonly rust_zstd_wasm_shim_memcpy: (a: number, b: number, c: number) => number;
    readonly rust_zstd_wasm_shim_memmove: (a: number, b: number, c: number) => number;
    readonly rust_zstd_wasm_shim_memset: (a: number, b: number, c: number) => number;
    readonly rust_zstd_wasm_shim_qsort: (a: number, b: number, c: number, d: number) => void;
    readonly iswspace: (a: number) => number;
    readonly iswdigit: (a: number) => number;
    readonly iswalpha: (a: number) => number;
    readonly strcmp: (a: number, b: number) => number;
    readonly strncmp: (a: number, b: number, c: number) => number;
    readonly memchr: (a: number, b: number, c: number) => number;
    readonly memcpy: (a: number, b: number, c: number) => number;
    readonly memmove: (a: number, b: number, c: number) => number;
    readonly memset: (a: number, b: number, c: number) => number;
    readonly strchr: (a: number, b: number) => number;
    readonly strncat: (a: number, b: number, c: number) => number;
    readonly strncpy: (a: number, b: number, c: number) => number;
    readonly iswalnum: (a: number) => number;
    readonly iswblank: (a: number) => number;
    readonly iswlower: (a: number) => number;
    readonly towupper: (a: number) => number;
    readonly iswpunct: (a: number) => number;
    readonly iswupper: (a: number) => number;
    readonly towlower: (a: number) => number;
    readonly iswxdigit: (a: number) => number;
    readonly __wasm_bindgen_func_elem_20305: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_20593: (a: number, b: number, c: number, d: number) => void;
    readonly __wasm_bindgen_func_elem_18571: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_18571_2: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_18571_3: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_18571_4: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_45018: (a: number, b: number, c: number) => void;
    readonly __wasm_bindgen_func_elem_18575: (a: number, b: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export5: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
