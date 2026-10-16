import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error('package.json 中的 version 必须是有效版本号');
}
const manifest = new URL('src-tauri/Cargo.toml', root);
const source = await readFile(manifest, 'utf8');
if (!/\[package\][\s\S]*?\nversion\s*=\s*"[^"]+"/.test(source)) throw new Error("Cargo.toml 缺少包版本字段");
const updated = source.replace(/(\[package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/, `$1"${version}"`);
if (updated !== source) await writeFile(manifest, updated);
