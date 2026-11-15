const fs = require('node:fs');
const root = require('../package.json');
const lock = require('../package-lock.json');
const paths = ['landing-page', ...fs.readdirSync('packages').filter(p=>fs.existsSync(`packages/${p}/package.json`)).map(p=>`packages/${p}`)];
for (const p of paths) {
  const version = JSON.parse(fs.readFileSync(`${p}/package.json`)).version;
  if (version !== root.version || lock.packages[p]?.version !== root.version) throw new Error(`Version mismatch: ${p}`);
}
if (lock.version !== root.version || lock.packages[''].version !== root.version) throw new Error('Root lock version mismatch');
const tauri = JSON.parse(fs.readFileSync('packages/desktop/src-tauri/tauri.conf.json'));
if (tauri.version !== root.version) throw new Error('Desktop version mismatch');
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${root.version}`) throw new Error('Release tag mismatch');
console.log(`Release versions agree: ${root.version}`);
