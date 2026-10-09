import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';

const source = new URL(import.meta.resolve('@blucca/ring-view-bridge/browser'));
const packageRoot = new URL('../', source);
const {version} = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8'));
const destination = new URL('../web/vendor/', import.meta.url);
mkdirSync(destination, {recursive: true});
const header = `// @blucca/ring-view-bridge ${version} | MIT | https://github.com/blucca/ring-view-bridge\n`;
writeFileSync(new URL('ring-view-bridge.mjs', destination), header + readFileSync(source, 'utf8'));
writeFileSync(new URL('ring-view-bridge.LICENSE', destination), readFileSync(new URL('LICENSE', packageRoot)));
console.log(`Vendored Ring View Bridge ${version} from the installed release.`);
