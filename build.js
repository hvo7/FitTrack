/* FitTrack — web build.
 *
 * The app is authored as one self-contained index.html with an inline
 * <script type="text/babel"> block, which is lovely to edit but means the
 * browser downloads and runs a ~3MB Babel compiler on every load. That is
 * merely slow on desktop; on a phone it is the difference between a snappy
 * app and a two-second white screen.
 *
 * So: compile the JSX ahead of time with esbuild, drop Babel from the output,
 * and emit a PWA-ready bundle. Authoring workflow is unchanged — keep editing
 * index.html.
 *
 *   node build.js --vendor   -> refresh lib/ from node_modules
 *   node build.js            -> dist-web/       (live)
 *   node build.js --dev      -> dist-web-dev/   (dev build)
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = __dirname;

const VENDOR = [
  ['node_modules/react/umd/react.production.min.js', 'lib/react.min.js'],
  ['node_modules/react-dom/umd/react-dom.production.min.js', 'lib/react-dom.min.js'],
  ['node_modules/@babel/standalone/babel.min.js', 'lib/babel.min.js'],
  ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'lib/supabase.min.js'],
];

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

/* Keep lib/ in sync with node_modules. Those files are committed so that a
 * fresh clone can run the Electron app without a network round trip. */
function vendor() {
  for (const [from, to] of VENDOR) {
    const src = path.join(ROOT, from);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing ${from} — run "npm install" first.`);
    }
    copy(src, path.join(ROOT, to));
    console.log(`vendored ${to}`);
  }
}

const PWA_HEAD = `
  <link rel="manifest" href="./manifest.webmanifest">
  <meta name="theme-color" content="#111722">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="FitTrack">
  <link rel="apple-touch-icon" href="./icons/icon-192.png">
  <link rel="icon" href="./icons/icon-192.png">`;

const SW_REGISTER = `
  <script>
    if ('serviceWorker' in navigator) {
      addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').then(function (reg) {
          const announceUpdate = () => {
            window.FT_UPDATE_READY = true;
            window.dispatchEvent(new Event('ft-update-ready'));
          };
          let hadController = !!navigator.serviceWorker.controller;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (hadController) announceUpdate();
            hadController = true;
          });
          if (reg.waiting) announceUpdate();
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') reg.update().catch(() => {});
          });
          window.addEventListener('online', () => reg.update().catch(() => {}));
          // A new build is live. Take over as soon as the old one lets go.
          reg.addEventListener('updatefound', function () {
            var w = reg.installing;
            if (!w) return;
            w.addEventListener('statechange', function () {
              if (w.state === 'installed' && navigator.serviceWorker.controller) {
                announceUpdate();
              }
            });
          });
        }).catch(function () {});
      });
    }
  </script>`;

function build(isDev) {
  const desktop = process.argv.includes('--desktop');
  const OUT = path.join(ROOT, desktop ? (isDev ? 'dist-desktop-web-dev' : 'dist-desktop-web') : (isDev ? 'dist-web-dev' : 'dist-web'));
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  // ── Compile the inline JSX ───────────────────────────────────────────────
  const OPEN = '<script type="text/babel">';
  const start = html.indexOf(OPEN);
  if (start === -1) throw new Error('No <script type="text/babel"> block found in index.html');
  const bodyStart = start + OPEN.length;
  const end = html.indexOf('</script>', bodyStart);
  if (end === -1) throw new Error('Unterminated <script type="text/babel"> block in index.html');

  const { code } = esbuild.transformSync(html.slice(bodyStart, end), {
    loader: 'jsx',
    target: 'es2018',
    minify: true,
    jsxFactory: 'React.createElement',   // React is a UMD global here, not an import
    jsxFragment: 'React.Fragment',
  });

  html = html.slice(0, start) + '<script>' + code + '</script>' + html.slice(end + '</script>'.length);

  // Babel is dead weight now that the JSX is precompiled.
  html = html.replace(/[ \t]*<script src="\.\/lib\/babel\.min\.js"><\/script>\r?\n?/, '');

  // The service worker keys its cache on this id, so every build reaches
  // devices instead of serving a stale shell forever. The app shows it too, so
  // "which version am I actually looking at" is answerable from the UI.
  const buildId = [
    require('./package.json').version,
    isDev ? 'dev' : 'live',
    require('crypto').createHash('sha256').update(
      ['index.html','food-model.js','theme.css','sync.js','config.js','public/sw.js','public/manifest.webmanifest'].map(f => fs.readFileSync(path.join(ROOT,f))).join('\n')
    ).digest('hex').slice(0,12),
  ].join('-');

  // An old phone service worker may still control the first navigation after
  // deployment. Versioned app assets prevent it mixing new HTML with old logic.
  if (!desktop) html = html.replace(/((?:src|href)="\.\/(?:config\.js|sync\.js|food-model\.js|theme\.css))"/g, '$1?build=' + buildId + '"');

  html = html.replace('</head>',
    '<script>window.FT_BUILD=' + JSON.stringify(buildId) + ';</script>\n' + PWA_HEAD + '\n</head>');
  if (!desktop) html = html.replace('</body>', SW_REGISTER + '\n</body>');

  fs.writeFileSync(path.join(OUT, 'index.html'), html);

  // ── Static assets ────────────────────────────────────────────────────────
  for (const [, to] of VENDOR) {
    if (to.endsWith('babel.min.js')) continue; // precompiled; not shipped
    copy(path.join(ROOT, to), path.join(OUT, to));
  }
  for (const f of ['config.js', 'sync.js', 'food-model.js', 'theme.css']) copy(path.join(ROOT, f), path.join(OUT, f));
  fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });

  // ── Cache busting ────────────────────────────────────────────────────────
  const swPath = path.join(OUT, 'sw.js');
  fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').split('__BUILD_ID__').join(buildId));

  const manifestPath = path.join(OUT, 'manifest.webmanifest');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (isDev) {
    manifest.name = 'FitTrack (Dev)';
    manifest.short_name = 'FitTrack Dev';
    manifest.theme_color = '#7c3aed';
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`built ${isDev ? 'dev' : 'live'} -> ${path.relative(ROOT, OUT)}  (${buildId})`);
}

if (process.argv.includes('--vendor')) {
  vendor();
} else {
  build(process.argv.includes('--dev'));
}
