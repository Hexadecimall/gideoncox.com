export const BUILD_CONFIG = '.zed/browser-build.json';
export const CLANG_TARGETS = ['wasi', 'linux-x86_64', 'linux-x86_64-static'];
const decoder = new TextDecoder();

export function parseBuildConfig(bytes) {
  const text = bytes ? decoder.decode(bytes).trim() : '';
  let settings;
  try {
    settings = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${BUILD_CONFIG} must contain valid JSON.`);
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`${BUILD_CONFIG} must contain a JSON object.`);
  }
  return settings;
}

export function isProjectRelativePath(path) {
  return typeof path === 'string' && !path.includes('\0')
    && !path.split('/').some(part => !part || part === '.' || part === '..');
}

export function clangLibraryPaths({ libraries }, target) {
  if (libraries === undefined) return [];
  if (!libraries || typeof libraries !== 'object' || Array.isArray(libraries)) {
    throw new Error(`"libraries" in ${BUILD_CONFIG} must map build targets to lists of files.`);
  }
  for (const [name, paths] of Object.entries(libraries)) {
    if (!CLANG_TARGETS.includes(name)) throw new Error(`Unknown library target: ${name}.`);
    if (!Array.isArray(paths) || paths.some(path => !isProjectRelativePath(path) || !/\.(?:a|o)$/.test(path))) {
      throw new Error(`Libraries for ${name} must be project-relative .a or .o paths.`);
    }
  }
  return libraries[target] ?? [];
}
