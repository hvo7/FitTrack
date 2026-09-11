const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {bundleAsset,enableLocalBundle}=require('../desktop-bundle');
const base='https://hvo7.github.io/FitTrack';
test('installed routes preserve the hosted URL for live and dev',()=>{
  const files=new Set(['index.html','dev/index.html','food-model.js','dev/theme.css']);
  assert.equal(bundleAsset(base+'/?env=live',base,files),'index.html');
  assert.equal(bundleAsset(base+'/dev/?env=dev',base,files),'dev/index.html');
  assert.equal(bundleAsset(base+'/food-model.js',base,files),'food-model.js');
  assert.equal(bundleAsset('https://other.example/FitTrack/index.html',base,files),undefined);
  assert.equal(bundleAsset('https://hvo7.github.io/other/',base,files),undefined);
  assert.equal(bundleAsset(base+'/main.js',base,files),null);
  assert.equal(bundleAsset(base+'/%2e%2e%2fmain.js',base,files),null);
});
test('local handler serves whitelisted files and clears only rebuildable caches',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fittrack-bundle-test-'));
  try{
    fs.writeFileSync(path.join(dir,'desktop-local.json'),JSON.stringify({origin:base,build:'test',files:['index.html']}));
    fs.writeFileSync(path.join(dir,'index.html'),'<h1>Local release</h1>');
    let handler,cleared,forwarded;
    const session={protocol:{handle:(scheme,fn)=>{assert.equal(scheme,'https');handler=fn;}},clearStorageData:async options=>{cleared=options;}};
    assert.equal(await enableLocalBundle(session,{fetch:async(req,options)=>{forwarded=options;return new Response('remote');}},dir,base),true);
    assert.deepEqual(cleared,{origin:'https://hvo7.github.io',storages:['serviceworkers','cachestorage']});
    const response=await handler(new Request(base+'/'));assert.equal(await response.text(),'<h1>Local release</h1>');
    assert.equal(response.headers.get('X-FitTrack-Release'),'test');
    assert.equal((await handler(new Request(base+'/main.js'))).status,404);
    await handler(new Request('https://example.com/'));assert.equal(forwarded.bypassCustomProtocolHandlers,true);
  }finally{
    // Only this test's fresh temporary directory is removed.
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep+'fittrack-bundle-test-'));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
