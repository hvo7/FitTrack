/* Exercise the real Electron shell with an isolated profile and no UI. */
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const release=JSON.parse(fs.readFileSync(path.join(root,'dist','installed-release.json')));
const testDir=fs.mkdtempSync(path.join(root,'dist','desktop-test-'));
const profile=path.join(testDir,'profile');fs.mkdirSync(profile);
async function run(phase){
  const wrapper=path.join(testDir,`launch-${phase}.cjs`), result=path.join(testDir,`result-${phase}.json`);
  fs.writeFileSync(wrapper,`
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs');
app.setPath('userData',${JSON.stringify(profile)});
app.disableHardwareAcceleration();
require(${JSON.stringify(path.join(release.stage,'main.js'))});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ready(win){
  for(let i=0;i<100;i++){
    try{if(await win.webContents.executeJavaScript("typeof FTFood==='object' && !!document.querySelector('.content,.onboard')"))return;}catch{}
    await pause(100);
  }
  throw Error('Desktop UI did not become ready: '+win.webContents.getURL());
}
app.whenReady().then(async()=>{
 try {
  let win;
  for(let i=0;i<100&&!win;i++){win=BrowserWindow.getAllWindows()[0];if(!win)await pause(100);}
  if(!win)throw Error('No FitTrack window was created');
  await session.defaultSession.setProxy({proxyRules:'http=127.0.0.1:9;https=127.0.0.1:9'});
  await ready(win);
  const first=await win.webContents.executeJavaScript("(async()=>{const r=await fetch('./food-model.js');return {origin:location.origin,build:r.headers.get('X-FitTrack-Release'),status:r.status,preserved:localStorage.getItem('preserved-account-sentinel')};})()");
  if(${phase}===1) await win.webContents.executeJavaScript("localStorage.setItem('preserved-account-sentinel','keep-me');localStorage.setItem('ft_profile',JSON.stringify({name:'Desktop test'}));");
  win.webContents.reload();await pause(200);await ready(win);
  const heading=await win.webContents.executeJavaScript("document.querySelector('h1')?.textContent");
  await win.loadURL(${JSON.stringify(release.origin+'/dev/?env=dev')});await ready(win);
  const dev=await win.webContents.executeJavaScript("(async()=>{const r=await fetch('./theme.css');return {env:FTSync.state().env,build:r.headers.get('X-FitTrack-Release')};})()");
  session.defaultSession.flushStorageData();
  fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({first,heading,dev,userData:app.getPath('userData')}));
  await pause(200);app.quit();
 } catch(error) {fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({error:String(error),stack:error.stack}));app.exit(1);}
});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve,reject)=>{
    const child=spawn(require('electron'),[wrapper,'--smoke-test'],{env,windowsHide:true,stdio:'ignore'});
    const timer=setTimeout(()=>{child.kill();reject(Error('Desktop smoke timed out'));},30000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(fs.existsSync(result)?fs.readFileSync(result,'utf8'):'Electron exited '+code));});
  });
  const data=JSON.parse(fs.readFileSync(result));
  assert.equal(data.userData,profile);
  assert.equal(data.first.origin,new URL(release.origin).origin);
  assert.equal(data.first.build,release.build);
  assert.equal(data.first.status,200);
  assert.equal(data.heading,'A little better, every day.');
  assert.equal(data.dev.env,'dev');assert.equal(data.dev.build,release.build);
  if(phase===2)assert.equal(data.first.preserved,'keep-me');
}
(async()=>{await run(1);await run(2);console.log('Desktop smoke passed: live/dev assets load locally at the original origin, with network unavailable and storage preserved across restarts.');})().catch(e=>{console.error(e);process.exitCode=1;});
