/* Run after build:pages; requires Playwright (same setup as browser-smoke). */
const {chromium}=require('playwright');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../dist-pages');let revision=0;
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(root,'.'+pathname.replace(/\/$/,'/index.html'));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  if(file.endsWith('config.js')){res.setHeader('Content-Type','text/javascript');res.end('window.FT_CONFIG = {};');return;}
  try{res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');const bytes=fs.readFileSync(file);res.end(file.endsWith('sw.js')?'// Test revision '+revision+'\n'+bytes.toString():bytes);}catch{res.writeHead(404).end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'msedge'});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await context.addInitScript(()=>{
      if(!localStorage.ft_profile)localStorage.setItem('ft_profile',JSON.stringify({name:'Mobile test'}));
    });
    const errors=[];const live=await context.newPage();live.on('pageerror',e=>errors.push(e.message));
    const base='http://127.0.0.1:'+server.address().port;
    await live.goto(base+'/');await live.getByRole('heading',{name:'A little better, every day.'}).waitFor();
    await live.evaluate(()=>navigator.serviceWorker.ready);
    await live.reload();await live.waitForFunction(()=>!!navigator.serviceWorker.controller);
    const assets=await live.locator('script[src],link[rel=stylesheet]').evaluateAll(els=>els.map(e=>e.getAttribute('src')||e.getAttribute('href')));
    for(const name of ['sync.js','food-model.js','theme.css'])assert.ok(assets.some(url=>url.startsWith('./'+name+'?build=')),name+' is not versioned');
    const dev=await context.newPage();dev.on('pageerror',e=>errors.push(e.message));
    await dev.goto(base+'/dev/');
    await dev.waitForFunction(async()=>{const r=await navigator.serviceWorker.getRegistration(location.href);return r?.scope.endsWith('/dev/')&&r.active?.state==='activated';});
    await dev.reload();await dev.waitForFunction(()=>navigator.serviceWorker.controller?.scriptURL.endsWith('/dev/sw.js'));
    await live.getByRole('button',{name:'Log food',exact:true}).click();
    await live.getByRole('button',{name:'+ Enter a new food',exact:true}).click();
    await live.getByLabel('Food name',{exact:true}).fill('Keep my unfinished entry');
    revision++;
    await live.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
    await live.getByRole('button',{name:'Reload app',exact:true}).waitFor();
    assert.equal(await live.getByLabel('Food name',{exact:true}).inputValue(),'Keep my unfinished entry');
    await live.getByRole('button',{name:'Cancel',exact:true}).click();
    await live.getByRole('button',{name:'Reload app',exact:true}).click();
    await live.getByRole('heading',{name:'A little better, every day.'}).waitFor();
    const keys=await live.evaluate(()=>caches.keys());assert.ok(keys.filter(k=>k.startsWith('ft-app-')).length>=2);
    await context.setOffline(true);
    for(const page of [live,dev]){
      await page.reload();await page.getByRole('heading',{name:'A little better, every day.'}).waitFor();
      assert.equal(await page.evaluate(()=>typeof FTFood),'object');
      const before=await page.locator('.home-water').innerText();
      await page.getByRole('button',{name:'+ 8 oz',exact:true}).click();
      assert.notEqual(await page.locator('.home-water').innerText(),before);
    }
    assert.deepEqual(errors,[]);
    console.log('PWA smoke passed: mobile layout, versioned assets, update prompt preserves in-progress entry, independent live/dev caches, offline reload and logging.');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
