// Loads a frontend TypeScript module in Node for a check: transpiles it and its
// relative imports to CommonJS, with stubs for host modules.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));


export function createLoader(stubs = {}) {
  const cache = new Map();
  const load = (path) => {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} };
    cache.set(path, module);
    const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    });
    const require = (name) => {
      if (name in stubs) return stubs[name];
      if (!name.startsWith('.')) throw new Error(`No stub for ${name} (from ${path})`);
      const base = resolve(dirname(path), name);
      const file = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((ext) => base + ext).find(existsSync);
      if (!file) throw new Error(`Cannot resolve ${name} from ${path}`);
      return load(file);
    };
    new Function('module', 'exports', 'require', outputText)(module, module.exports, require);
    return module.exports;
  };
  return (relative) => load(join(root, relative));
}
