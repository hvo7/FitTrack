/* Run after npm run build:web, with Playwright available on NODE_PATH. */
const {chromium} = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const F = require('../food-model');
const root=path.resolve(__dirname,'../dist-web');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  if(file.endsWith('config.js')){res.setHeader('Content-Type','text/javascript');res.end('window.FT_CONFIG = {};');return;}
  try{res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge'});
  try {
    const context=await browser.newContext({viewport:{width:1280,height:1000},serviceWorkers:'block'});
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const bread={id:'bread',name:'Bread',servingQty:30,servingUnit:'g',servingSize:'30 g',calories:100,protein:4,carbs:15,fat:3,fiber:2,portions:[{qty:2,unit:'slice'}]};
    await page.addInitScript(({bread})=>{
      if(localStorage.getItem('test-seeded'))return;
      const now=new Date();const today=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
      localStorage.setItem('ft_profile',JSON.stringify({name:'Henry',goals:{calories:1800,protein:175,carbs:80,fat:70,fiber:25,water:128}}));
      localStorage.setItem('ft_library',JSON.stringify([bread]));
      localStorage.setItem('ft_days',JSON.stringify({'2026-09-01':{date:'2026-09-01',meals:[{id:'legacy',name:'Bread',servingSize:'60 g',calories:200,protein:8,carbs:30,fat:6,fiber:4,mealType:'Breakfast'}]},[today]:{date:today,meals:[],waterOz:64}}));
      localStorage.setItem('test-seeded','1');
    },{bread});
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('heading',{name:'A little better, every day.'}).waitFor();
    await page.getByRole('button',{name:'Log food',exact:true}).click();
    await page.getByRole('button',{name:/Bread.*30 g/}).click();
    const modal=page.locator('.food-log-modal');
    await modal.getByLabel('Amount eaten').fill('60');
    await modal.getByLabel('Unit',{exact:true}).selectOption('oz');
    assert.ok(Math.abs(Number(await modal.getByLabel('Amount eaten').inputValue())-60/28.349523125)<1e-7);
    await modal.getByLabel('Unit',{exact:true}).selectOption('slice');
    await modal.getByLabel('Amount eaten').fill('3');
    assert.equal(await modal.getByLabel('Calories (kcal)').inputValue(),'150');
    await modal.getByRole('button',{name:'Add to diary'}).click();
    await page.locator('.meal-row').filter({hasText:'Bread'}).waitFor();
    await page.getByRole('button',{name:'Food database',exact:true}).click();
    await page.locator('.database-row').getByRole('button',{name:'Edit',exact:true}).click();
    await page.getByLabel('Calories (kcal)').fill('200');
    await page.getByLabel('Label amount').fill('40');
    await page.getByLabel('Name',{exact:true}).fill('Bread corrected');
    assert.match(await page.locator('.food-impact').innerText(),/2 linked logs/);
    await page.getByRole('button',{name:'Save food',exact:true}).click();
    await page.getByRole('button',{name:'Today',exact:true}).click();
    const row=page.locator('.meal-row').filter({hasText:'Bread corrected'});
    assert.equal(await row.locator('.meal-cal-num').innerText(),'300');
    const historical=await page.evaluate(()=>FTFood.resolveDays(JSON.parse(localStorage.ft_days),JSON.parse(localStorage.ft_library))['2026-09-01'].meals[0]);
    assert.equal(historical.calories,300);assert.equal(historical.foodId,'bread');
    await page.getByRole('button',{name:'History',exact:true}).click();
    await page.locator('.hist-card').filter({has:page.locator('.hist-date').getByText('Tue, Sep 1',{exact:true})}).click();
    assert.equal(await page.locator('.meal-cal-num').innerText(),'300');
    assert.match(await page.locator('.meal-serving').innerText(),/60 g/);
    await page.getByRole('button',{name:'Jump to Today',exact:true}).click();
    await page.reload();await page.getByRole('heading',{name:'A little better, every day.'}).waitFor();
    assert.equal(await page.locator('.meal-cal-num').innerText(),'300');
    await page.getByRole('button',{name:'Food database',exact:true}).click();
    await page.locator('.database-row').getByRole('button',{name:'Edit',exact:true}).click();
    await page.getByRole('button',{name:'Remove equivalent 1'}).click();
    await page.getByRole('button',{name:'Save food',exact:true}).click();
    assert.match(await page.getByRole('alert').innerText(),/removes a conversion/);
    await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await page.locator('.database-row').getByRole('button',{name:'Archive',exact:true}).click();
    assert.equal(await page.locator('.database-row').count(),0);
    await page.getByLabel('Archived',{exact:true}).check();
    await page.locator('.database-row').getByRole('button',{name:'Restore',exact:true}).click();
    await page.getByLabel('Archived',{exact:true}).uncheck();
    assert.equal(await page.locator('.database-row').count(),1);
    await page.getByRole('button',{name:'Today',exact:true}).click();
    await page.getByRole('button',{name:'Remove Bread corrected',exact:true}).click();
    assert.equal(await page.locator('.meal-row').count(),0);
    await page.getByRole('button',{name:'Undo',exact:true}).click();
    assert.equal(await page.locator('.meal-row').count(),1);
    await page.getByRole('button',{name:'Food database',exact:true}).click();
    await page.getByRole('button',{name:'+ New food',exact:true}).click();
    await page.getByLabel('Name',{exact:true}).fill('Oats');
    await page.getByLabel('Calories (kcal)').fill('100');
    await page.getByRole('button',{name:'+ Add equivalent',exact:true}).click();
    await page.getByLabel('Equivalent 1 amount',{exact:true}).fill('0.5');
    await page.getByLabel('Equivalent 1 unit',{exact:true}).selectOption('cup');
    await page.getByRole('button',{name:'Save food',exact:true}).click();
    await page.locator('.database-row').filter({hasText:'Oats'}).getByRole('button',{name:'Log',exact:true}).click();
    assert.match(await page.locator('.food-log-modal .modal-title').innerText(),/Log food/);
    await modal.getByLabel('Unit',{exact:true}).selectOption('cup');
    assert.equal(await modal.getByLabel('Amount eaten').inputValue(),'0.5');
    await modal.getByRole('button',{name:'Add to diary',exact:true}).click();
    await page.getByRole('button',{name:'Today',exact:true}).click();
    assert.equal(await page.locator('.meal-row').filter({hasText:'Oats'}).locator('.meal-cal-num').innerText(),'100');
    await page.getByRole('button',{name:'Log food',exact:true}).click();
    await page.getByRole('button',{name:'+ Enter a new food',exact:true}).click();
    await modal.getByLabel('Food name',{exact:true}).fill('One-time soup');
    await modal.getByLabel('Calories (kcal)').fill('120');
    await modal.getByLabel('Save to food database for reuse').uncheck();
    await modal.getByRole('button',{name:'Add to diary',exact:true}).click();
    const standalone=await page.evaluate(()=>({foods:JSON.parse(localStorage.ft_library),logs:Object.values(JSON.parse(localStorage.ft_days)).flatMap(d=>d.meals||[])}));
    assert.equal(standalone.foods.some(f=>f.name==='One-time soup'),false);
    assert.equal(standalone.logs.find(m=>m.name==='One-time soup').standalone,true);
    for(const button of await page.getByRole('button',{name:'Dismiss notification'}).all())await button.click();
    await page.screenshot({path:path.join(root,'home-desktop.png'),fullPage:true});
    for(const width of [768,600,390,320]) {
      await page.setViewportSize({width,height:1000});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth || [...document.querySelectorAll('.home-grid,.topbar,.sidebar')].some(el=>el.scrollWidth>el.clientWidth+2));
      assert.equal(overflow,false,`Overflow at ${width}px`);
      if(width===390)await page.screenshot({path:path.join(root,'home-mobile.png'),fullPage:true});
    }
    await page.getByRole('button',{name:'Log food',exact:true}).click();
    await page.getByRole('button',{name:/Bread corrected.*40 g/}).click();
    assert.equal(await modal.evaluate(el=>el.scrollWidth>el.clientWidth+2),false,'Food modal overflows at 320px');
    await page.screenshot({path:path.join(root,'logging-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('Browser smoke passed: logging, conversions, historical correction, rename, reload, conversion guard, archive/restore, undo and responsive layouts.');
  }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
