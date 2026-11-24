/* tslint:disable */
/* eslint-disable */

export function editor_text(): string;

export function list_browser_paths(): Promise<string>;

export function list_files(): Promise<string>;

export function open_file(path: string): Promise<void>;

export function read_browser_file(path: string): Promise<Uint8Array>;

export function save_file(path: string): Promise<void>;

export function set_editor_text(text: string): void;

export function set_file_path(path: string): string;

export function set_font_size(size: number): void;

export function start(): void;

/**
 * Entry point for web workers
 */
export function wasm_thread_entry_point(ptr: number): void;

export function workspace_has_dirty_buffers(): boolean;

export function workspace_ready(): boolean;

export function write_browser_file(path: string, bytes: Uint8Array): Promise<void>;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly memcmp: (a: number, b: number, c: number) => number;
    readonly strlen: (a: number) => number;
    readonly editor_text: () => [number, number, number, number];
    readonly list_browser_paths: () => any;
    readonly list_files: () => any;
    readonly open_file: (a: number, b: number) => any;
    readonly read_browser_file: (a: number, b: number) => any;
    readonly save_file: (a: number, b: number) => any;
    readonly set_editor_text: (a: number, b: number) => [number, number];
    readonly set_file_path: (a: number, b: number) => [number, number, number, number];
    readonly set_font_size: (a: number) => [number, number];
    readonly start: () => void;
    readonly workspace_has_dirty_buffers: () => number;
    readonly workspace_ready: () => number;
    readonly write_browser_file: (a: number, b: number, c: number, d: number) => any;
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
    readonly iswalpha: (a: number) => number;
    readonly iswdigit: (a: number) => number;
    readonly towlower: (a: number) => number;
    readonly strcmp: (a: number, b: number) => number;
    readonly iswalnum: (a: number) => number;
    readonly strncmp: (a: number, b: number, c: number) => number;
    readonly memchr: (a: number, b: number, c: number) => number;
    readonly memcpy: (a: number, b: number, c: number) => number;
    readonly memmove: (a: number, b: number, c: number) => number;
    readonly memset: (a: number, b: number, c: number) => number;
    readonly strchr: (a: number, b: number) => number;
    readonly strncat: (a: number, b: number, c: number) => number;
    readonly strncpy: (a: number, b: number, c: number) => number;
    readonly iswblank: (a: number) => number;
    readonly iswlower: (a: number) => number;
    readonly towupper: (a: number) => number;
    readonly iswpunct: (a: number) => number;
    readonly iswupper: (a: number) => number;
    readonly iswxdigit: (a: number) => number;
    readonly wasm_bindgen_88e23e81aad34754___convert__closures_____invoke___wasm_bindgen_88e23e81aad34754___JsValue__core_ed718c3d60ebd546___result__Result_____wasm_bindgen_88e23e81aad34754___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_88e23e81aad34754___convert__closures_____invoke___js_sys_e144b7ac344eb9c5___Function_fn_wasm_bindgen_88e23e81aad34754___JsValue_____wasm_bindgen_88e23e81aad34754___sys__Undefined___js_sys_e144b7ac344eb9c5___Function_fn_wasm_bindgen_88e23e81aad34754___JsValue_____wasm_bindgen_88e23e81aad34754___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_88e23e81aad34754___convert__closures_____invoke___wasm_bindgen_88e23e81aad34754___JsValue______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_88e23e81aad34754___convert__closures_____invoke___wasm_bindgen_88e23e81aad34754___JsValue______true__2: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_88e23e81aad34754___convert__closures_____invoke___wasm_bindgen_88e23e81aad34754___JsValue______true__3: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_88e23e81aad34754___convert__closures_____invoke___wasm_bindgen_88e23e81aad34754___JsValue______true__4: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_88e23e81aad34754___convert__closures_____invoke___wasm_bindgen_88e23e81aad34754___JsValue______true__5: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_88e23e81aad34754___convert__closures________invoke___web_sys_334560b608022967___features__gen_MessageEvent__MessageEvent______true_: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_88e23e81aad34754___convert__closures_____invoke_______true_: (a: number, b: number) => void;
    readonly __wbindgen_malloc_command_export: (a: number, b: number) => number;
    readonly __wbindgen_realloc_command_export: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_alloc_command_export: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_exn_store_command_export: (a: number) => void;
    readonly __wbindgen_free_command_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure_command_export: (a: number, b: number) => void;
    readonly __externref_table_dealloc_command_export: (a: number) => void;
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
