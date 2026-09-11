const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const asar=require('@electron/asar');
const ROOT=path.resolve(__dirname,'..');
const output=path.join(ROOT,'dist');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

(async()=>{
  execFileSync(process.execPath,[path.join(ROOT,'build.js'),'--desktop'],{cwd:ROOT,stdio:'inherit'});
  execFileSync(process.execPath,[path.join(ROOT,'build.js'),'--desktop','--dev'],{cwd:ROOT,stdio:'inherit'});
  fs.mkdirSync(output,{recursive:true});
  const stage=fs.mkdtempSync(path.join(output,'installed-stage-'));
  const files=[];
  function copyAssets(source,target,prefix='') {
    for(const name of fs.readdirSync(source)) {
      if(name==='sw.js') continue;
      const from=path.join(source,name),to=path.join(target,name);
      if(fs.statSync(from).isDirectory()){fs.mkdirSync(to,{recursive:true});copyAssets(from,to,prefix+name+'/');}
      else {fs.copyFileSync(from,to);files.push(prefix+name);}
    }
  }
  copyAssets(path.join(ROOT,'dist-desktop-web'),stage);
  fs.mkdirSync(path.join(stage,'dev'));
  copyAssets(path.join(ROOT,'dist-desktop-web-dev'),path.join(stage,'dev'),'dev/');
  for(const name of ['main.js','desktop-bundle.js']) fs.copyFileSync(path.join(ROOT,name),path.join(stage,name));
  fs.cpSync(path.join(ROOT,'public','icons'),path.join(stage,'public','icons'),{recursive:true});
  const pkg=require('../package.json');
  fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({name:pkg.name,productName:pkg.productName,version:pkg.version,main:'main.js'},null,2));
  const origin=fs.readFileSync(path.join(stage,'config.js'),'utf8').match(/APP_URL\s*:\s*'([^']*)'/)?.[1];
  if(!origin) throw new Error('The installed update needs APP_URL to preserve the existing storage origin.');
  const build=hash(path.join(stage,'index.html')).slice(0,12);
  fs.writeFileSync(path.join(stage,'desktop-local.json'),JSON.stringify({origin,build,createdAt:new Date().toISOString(),files},null,2));
  const archive=path.join(output,'installed-app.asar');
  await asar.createPackage(stage,archive);
  for(const file of ['index.html','dev/index.html','food-model.js','theme.css','main.js','desktop-bundle.js','desktop-local.json']) {
    if(!asar.extractFile(archive,file).length) throw new Error('Missing package asset: '+file);
  }
  const release={archive,stage,build,sha256:hash(archive),origin,configSha256:hash(path.join(stage,'config.js')),createdAt:new Date().toISOString()};
  fs.writeFileSync(path.join(output,'installed-release.json'),JSON.stringify(release,null,2));
  console.log(JSON.stringify(release,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
