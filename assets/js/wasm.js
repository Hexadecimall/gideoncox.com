let renderer;

export function loadRenderer() {
  renderer ??= fetch(new URL('../wasm/field.wasm', import.meta.url)).then(async response => {
    if (!response.ok) throw new Error('Renderer unavailable');
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer());
    return instance.exports;
  });
  return renderer;
}
