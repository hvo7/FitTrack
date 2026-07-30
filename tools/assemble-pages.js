/* Combine the live and dev builds into the single directory GitHub Pages
 * publishes:
 *
 *   dist-pages/          <- live  (https://<user>.github.io/FitTrack/)
 *   dist-pages/dev/      <- dev   (https://<user>.github.io/FitTrack/dev/)
 *
 * One site, two environments, one Supabase project — kept apart by the `env`
 * column rather than by separate infrastructure.
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname + path.sep + '..';
const OUT = path.join(ROOT, 'dist-pages');

for (const dir of ['dist-web', 'dist-web-dev']) {
  if (!fs.existsSync(path.join(ROOT, dir))) {
    throw new Error(`Missing ${dir} — run "npm run build:web" and "npm run build:web:dev" first.`);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'dist-web'), OUT, { recursive: true });
fs.cpSync(path.join(ROOT, 'dist-web-dev'), path.join(OUT, 'dev'), { recursive: true });

// Pages runs everything through Jekyll by default, which silently drops files
// and folders beginning with an underscore. Opt out.
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

console.log('assembled dist-pages/ (live at /, dev at /dev/)');
