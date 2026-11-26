import { BUILD_CONFIG, clangCompileOptions, isProjectRelativePath, parseBuildConfig } from '../compiler/build-settings.js?v=2';

const encoder = new TextEncoder();
const clangdConfig = /\/(?:\.clangd|compile_commands\.json|compile_flags\.txt)$/;

export function projectBuildFlags(root, files) {
  const config = files.find(([path]) => path === `${root}/${BUILD_CONFIG}`);
  if (!config || files.some(([path]) => clangdConfig.test(path))) return undefined;
  try {
    const settings = parseBuildConfig(config[1]);
    if (!['cStandard', 'cppStandard', 'defines', 'includeDirectories'].some(name => name in settings)) return undefined;
    const { cStandard, cppStandard, defines } = clangCompileOptions(settings);
    const { includeDirectories = [] } = settings;
    if (!Array.isArray(includeDirectories) || !includeDirectories.every(isProjectRelativePath)) return undefined;
    const common = [
      ...defines.map(define => `-D${define}`),
      `-I${root}`,
      ...[...includeDirectories, 'include'].map(directory => `-I${root}/${directory}`),
    ];
    // This file lives only in the clangd worker. JSON fragments are valid YAML.
    const fragments = [
      { CompileFlags: { Add: common } },
      { If: { PathMatch: '.*\\.c' }, CompileFlags: { Add: [`-std=${cStandard}`] } },
      { If: { PathMatch: '.*\\.(C|cc|cpp|cxx|c\\+\\+|CPP|hh|hpp|hxx|ixx|cppm)' },
        CompileFlags: { Add: [`-std=${cppStandard}`] } },
    ];
    return encoder.encode(fragments.map(fragment => JSON.stringify(fragment)).join('\n---\n') + '\n');
  } catch {
    // Invalid build options are reported by Run and Build. Keep clangd available.
    return undefined;
  }
}
