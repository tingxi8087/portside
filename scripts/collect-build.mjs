import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const bundle = path.join(root, 'src-tauri/target/release/bundle');
const output = path.join(root, 'build');
const app = `${config.productName}.app`;
const dmgs = (await readdir(path.join(bundle, 'dmg'))).filter(name =>
  name.startsWith(`${config.productName}_${config.version}_`) && name.endsWith('.dmg'),
);
if (!dmgs.length) throw new Error('未找到当前版本的 DMG 安装包');
await stat(path.join(bundle, 'macos', app));
await mkdir(output, { recursive: true });
// Replace only generated artifacts; preserve any other files in build/.
await rm(path.join(output, app), { recursive: true, force: true });
await cp(path.join(bundle, 'macos', app), path.join(output, app), { recursive: true, verbatimSymlinks: true });
for (const dmg of dmgs) await cp(path.join(bundle, 'dmg', dmg), path.join(output, dmg));
console.log(`桌面构建产物：${output}\n${[app, ...dmgs].map(name => `  ${name}`).join('\n')}`);
