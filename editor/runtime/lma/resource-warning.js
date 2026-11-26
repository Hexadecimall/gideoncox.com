const GIB = 1024 ** 3;

export function memoryWarning(bytes, device = globalThis.navigator) {
  if (!Number.isFinite(bytes)) return;
  if (bytes >= 4 * GIB) {
    return 'This model may exceed the browser LMA runtime’s 4 GiB address space.';
  }
  const mobile = /iPad|iPhone|iPod|Android/.test(device?.userAgent ?? '')
    || (device?.platform === 'MacIntel' && device.maxTouchPoints > 1);
  const reported = device?.deviceMemory;
  const estimate = Number.isFinite(reported) && reported > 0 ? reported / 2 : mobile ? 1 : 3;
  if (bytes >= estimate * GIB) {
    return 'This model may need more memory than the browser can use on this device.';
  }
}

export async function downloadWarning(bytes, device = globalThis.navigator) {
  const memory = memoryWarning(bytes, device);
  let storage;
  try {
    const { usage, quota } = await device?.storage?.estimate() ?? {};
    if (Number.isFinite(usage) && Number.isFinite(quota) && bytes > quota - usage) {
      storage = 'This download may exceed the browser’s available storage.';
    }
  } catch {
    // Storage estimates are advisory and may be unavailable.
  }
  return [storage, memory].filter(Boolean).join(' ');
}
