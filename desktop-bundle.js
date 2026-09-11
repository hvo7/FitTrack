/* Serve an installed local release at the existing web origin. Keeping the
 * origin and Electron session preserves localStorage, IndexedDB and login. */
const fs = require('node:fs');
const path = require('node:path');
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.ico':'image/x-icon'};

function bundleAsset(requestUrl, baseUrl, files) {
  const url = new URL(requestUrl), base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/$/,'');
  if (url.origin !== base.origin || (url.pathname !== prefix && !url.pathname.startsWith(prefix+'/'))) return undefined;
  let relative;
  try { relative = decodeURIComponent(url.pathname.slice(prefix.length)).replace(/^\//,''); } catch { return null; }
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  if (relative === 'dev') relative = 'dev/index.html';
  if (relative.includes('\\') || relative.split('/').some(part=>part==='..'||part==='.')) return null;
  return files.has(relative) ? relative : null;
}

async function enableLocalBundle(session, net, directory, baseUrl) {
  const manifestPath=path.join(directory,'desktop-local.json');
  if (!fs.existsSync(manifestPath) || !baseUrl) return false;
  const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  if (manifest.origin !== baseUrl) throw new Error('Installed bundle origin does not match account configuration.');
  const files=new Set(manifest.files);
  const scheme=new URL(baseUrl).protocol.slice(0,-1);
  session.protocol.handle(scheme,async request=>{
    const asset=bundleAsset(request.url,baseUrl,files);
    if (asset === undefined) return net.fetch(request,{bypassCustomProtocolHandlers:true});
    if (asset === null) return new Response('Not found',{status:404});
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405});
    try {
      const bytes=await fs.promises.readFile(path.join(directory,asset));
      return new Response(request.method==='HEAD'?null:bytes,{headers:{
        'Content-Type':mime[path.extname(asset)]||'application/octet-stream',
        'Cache-Control':'no-store','X-FitTrack-Release':manifest.build,
      }});
    } catch { return new Response('Installed asset unavailable',{status:500}); }
  });
  // Old hosted service workers could otherwise continue supplying the old UI.
  // Clear only rebuildable web caches. Account and diary storage are untouched.
  await session.clearStorageData({origin:new URL(baseUrl).origin,storages:['serviceworkers','cachestorage']});
  return true;
}
module.exports={bundleAsset,enableLocalBundle};
