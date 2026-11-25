
export function select_model() {
  const runtime = globalThis.zedLma;
  if (!runtime) throw new Error('Browser LMA is unavailable.');
  return runtime.selectModel();
}
export function load_recommended_model() {
  const runtime = globalThis.zedLma;
  if (!runtime) throw new Error('Browser LMA is unavailable.');
  return runtime.loadRecommendedModel();
}
export function start_completion(id, options) {
  const runtime = globalThis.zedLma;
  if (!runtime) throw new Error('Browser LMA is unavailable.');
  runtime.start(id, JSON.parse(options));
}
export function cancel_completion(id) { globalThis.zedLma?.cancel(id); }
