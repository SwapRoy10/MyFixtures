// Rewrites each page's ?v= tag for app.css, app.js and calendar-ui.mjs to a hash of the file's contents.
// The Worker caches those URLs for a year, so run `npm run stamp` after editing any of them.
// security.test.mjs fails if a tag is out of date.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../', import.meta.url);
export const versionedAssets = ['app.css', 'app.js', 'calendar-ui.mjs'];
export const pages = ['index.html', 'calendar.html'];
export const assetHash = file => createHash('sha256').update(readFileSync(new URL(file, dir))).digest('hex').slice(0, 10);
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const assetReference = file => new RegExp(`(["'/])${escape(file)}\\?v=[^"']*`, 'g');

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const page of pages) {
    const path = new URL(page, dir);
    let html = readFileSync(path, 'utf8');
    for (const file of versionedAssets) html = html.replace(assetReference(file), `$1${file}?v=${assetHash(file)}`);
    writeFileSync(path, html);
  }
  console.log(versionedAssets.map(file => `${file} ${assetHash(file)}`).join('\n'));
}
