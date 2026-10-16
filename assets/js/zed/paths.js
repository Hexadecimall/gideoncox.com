export const BROWSER_ROOT = '/home/web';

export function browserPath(name, directory = BROWSER_ROOT) {
  const base = directory === BROWSER_ROOT || directory.startsWith(BROWSER_ROOT + '/') ? directory : BROWSER_ROOT;
  const path = name.startsWith('/') ? name : `${base}/${name}`;
  const parts = path.split('/');
  if (!path.startsWith(BROWSER_ROOT + '/') || parts.some((part, index) => index > 0 && (!part || part === '.' || part === '..')) || /[\x00-\x1f\\]/.test(path)) {
    throw new Error('Choose a file name inside the browser folder.');
  }
  return path;
}

export function importPaths(files) {
  const paths = files.map(file => browserPath(file.webkitRelativePath || file.name));
  if (new Set(paths).size !== paths.length) throw new Error('The selection contains duplicate file names.');
  return paths;
}
