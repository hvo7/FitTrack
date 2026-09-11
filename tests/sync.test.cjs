const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
// Exercise the actual pure merge code without initializing auth or network.
const source=fs.readFileSync(require.resolve('../sync.js'),'utf8');
const mergeSource=source.slice(source.indexOf('  function mergeById('),source.indexOf('  // ── STATE'));
const context=vm.createContext({Date});vm.runInContext(mergeSource,context);
const merge=(...args)=>JSON.parse(JSON.stringify(context.merge(...args)));
test('newer food edits survive stale remote and unrelated library edits',()=>{
  const local=[{id:'a',calories:200,updatedAt:20},{id:'b',calories:10,updatedAt:1}];
  const remote=[{id:'a',calories:100,updatedAt:10},{id:'b',calories:30,updatedAt:30}];
  const result=merge('ft_library',local,remote,false);
  assert.equal(result.find(f=>f.id==='a').calories,200);assert.equal(result.find(f=>f.id==='b').calories,30);
});
test('archive revisions beat stale records; newer restores beat archives',()=>{
  const archive={id:1,archived:true,updatedAt:10};
  assert.equal(merge('ft_library',[archive],[{id:1}],false)[0].archived,true);
  assert.equal(merge('ft_library',[archive],[{id:1,archived:false,updatedAt:20}],true)[0].archived,false);
});
test('legacy rows without revisions follow the known newer blob',()=>{
  assert.equal(merge('ft_library',[{id:1,name:'local'}],[{id:1,name:'remote'}],true)[0].name,'local');
});
test('same-day distinct log additions and per-log edits survive merging',()=>{
  const local={d:{date:'d',updatedAt:10,meals:[{id:1,quantity:2,updatedAt:10}],workouts:[]}};
  const remote={d:{date:'d',updatedAt:20,meals:[{id:1,quantity:1,updatedAt:5},{id:2,quantity:3,updatedAt:20}],workouts:[]}};
  const result=merge('ft_days',local,remote,false).d.meals;
  assert.equal(result.length,2);assert.equal(result.find(x=>x.id===1).quantity,2);
});
test('meal deletion tombstones still prevent resurrection',()=>{
  const local={d:{date:'d',updatedAt:Date.now(),meals:[],removed:{1:Date.now()}}};
  const remote={d:{date:'d',updatedAt:1,meals:[{id:1,quantity:1}]}};
  assert.equal(merge('ft_days',local,remote,true).d.meals.length,0);
});

function syncHarness() {
  const storage=new Map(), timers=[];
  const sandbox=vm.createContext({Date,JSON,URLSearchParams,Promise,location:{search:'',pathname:'/'},window:{},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{}});
  const prefix=source.slice(source.indexOf("  'use strict';"),source.indexOf('  // ── PUBLIC API'));
  vm.runInContext(prefix+`;var api={state:()=>({})};
    globalThis.harness={
      configure:(c)=>{client=c;session={user:{id:'test-user'}};hydrated=true;},
      write:(key,value)=>{localSave(key,value);localStamp(key,Date.now());},
      read:localLoad,setup:setupRealtime,queue:queuePush,flush,
      pending:()=>pending,onRemote:(fn)=>remoteHandlers.push(fn)
    };`,sandbox);
  return {h:sandbox.harness,timers};
}
test('realtime merges incoming records with pending local edits and queues the union',()=>{
  const {h}=syncHarness();let receive,emitted;
  const channel={on:(_event,_filter,fn)=>{receive=fn;return channel;},subscribe:()=>channel};
  h.configure({channel:()=>channel});
  h.write('ft_library',[{id:'a',calories:200,updatedAt:20}]);
  h.queue('ft_library',[{id:'a',calories:200,updatedAt:20}]);
  h.onRemote((key,value)=>emitted=value);h.setup();
  receive({new:{key:'ft_library',env:'live',updated_at:new Date().toISOString(),value:[{id:'a',calories:100,updatedAt:10},{id:'b',calories:50,updatedAt:30}]}});
  assert.equal(emitted.find(f=>f.id==='a').calories,200);
  assert.equal(h.read('ft_library').length,2);
  assert.equal(h.pending().ft_library.length,2);
});
test('a failed cloud push retains data for retry',async()=>{
  const {h,timers}=syncHarness();
  h.configure({from:()=>({upsert:()=>Promise.resolve({error:{message:'offline'}})})});
  h.queue('ft_library',[{id:'a',calories:200,updatedAt:20}]);h.flush('ft_library');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.pending().ft_library[0].calories,200);
  assert.ok(timers.length>=2);
});
