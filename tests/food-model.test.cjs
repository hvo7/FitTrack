const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../food-model');
const bread = {id:'bread',name:'Bread',servingQty:30,servingUnit:'g',calories:100,protein:4,carbs:15,fat:3,fiber:2,portions:[{qty:2,unit:'slice'}]};
const day = meal => ({'2026-09-01':{date:'2026-09-01',meals:[meal],waterOz:16,updatedAt:1}});
test('weight units preserve physical quantity and nutrition', () => {
  assert.equal(F.convert(bread,1,'oz','g'),28.349523125);
  assert.equal(F.convert(bread,2,'slice','g'),30);
  assert.equal(F.convert(bread,30,'g','serving'),1);
  assert.equal(F.convert(bread,1,'lb','oz'),16);
  assert.equal(F.createMeal(bread,3,'slice','Lunch').calories,150);
});
test('US volume converts independently; food equivalents explicitly bridge families', () => {
  const milk={...bread,servingQty:240,servingUnit:'ml',portions:[{qty:244,unit:'g'}]};
  assert.equal(F.convert(milk,244,'g','ml'),240);
  assert.ok(Math.abs(F.convert(milk,1,'cup','tbsp')-16)<1e-8);
  assert.equal(F.ratio(bread,1,'cup'),null);
  assert.ok(!F.availableUnits(bread).includes('cup'));
  assert.equal(F.ratio({name:'unknown'},100,'g'),null);
  assert.equal(F.ratio({name:'unknown'},2,'serving'),2);
});
test('past days resolve new macros and serving definitions by stable ID, including renamed foods', () => {
  const original=F.createMeal(bread,60,'g','Lunch');
  const raw=day(original);
  const edited={...bread,name:'Bread, corrected',servingQty:40,calories:120,protein:8};
  const resolved=F.resolveDays(raw,[edited]);
  assert.equal(resolved['2026-09-01'].meals[0].calories,180);
  assert.equal(resolved['2026-09-01'].meals[0].protein,12);
  assert.equal(resolved['2026-09-01'].meals[0].name,'Bread, corrected');
  assert.equal(resolved['2026-09-01'].meals[0].quantity,60);
  assert.equal(raw['2026-09-01'].meals[0].calories,200);
  assert.equal(resolved['2026-09-01'].waterOz,16);
  assert.equal(resolved['2026-09-01'].updatedAt,1);
});
test('serving and portion logs follow the latest definition without converting their recorded quantities', () => {
  const edited={...bread,calories:150,servingQty:40};
  for(const [qty,unit,expected] of [[1,'serving',150],[2,'slice',150],[60,'g',225]]) {
    const resolved=F.resolveDays(day(F.createMeal(bread,qty,unit,'Dinner')),[edited]);
    assert.equal(resolved['2026-09-01'].meals[0].calories,expected);
  }
});
test('legacy linking is idempotent and only links unique convertible records', () => {
  const meal={id:1,name:'  bread ',servingSize:'60 g',calories:200};
  const raw=day(meal), linked=F.linkLegacyDays(raw,[bread]);
  assert.equal(linked['2026-09-01'].meals[0].foodId,'bread');
  assert.equal(F.linkLegacyDays(linked,[bread]),linked);
  assert.equal(F.linkLegacyDays(raw,[bread,{...bread,id:'other'}]),raw);
  assert.equal(F.linkLegacyDays(day({...meal,standalone:true}),[bread])['2026-09-01'].meals[0].foodId,undefined);
  assert.equal(F.linkLegacyDays(day({...meal,servingSize:'a handful'}),[bread])['2026-09-01'].meals[0].foodId,undefined);
  assert.equal(F.linkLegacyDays(day({...meal,servingSize:'1 cup'}),[bread])['2026-09-01'].meals[0].foodId,undefined);
});
test('bad legacy serving labels never masquerade as grams', () => {
  for(const s of ['2 handfuls','1..5 g','0 g','-4 oz','','100']) assert.equal(F.parseAmount(s),null);
  assert.deepEqual(F.parseAmount('2 slices'),{qty:2,unit:'slice'});
  assert.deepEqual(F.basis({grams:100}),{qty:100,unit:'g'});
});
test('archiving preserves history and excludes foods from recents; missing records use snapshots', () => {
  const raw=day(F.createMeal(bread,30,'g','Lunch'));
  assert.equal(F.resolveDays(raw,[{...bread,archived:true,calories:110}])['2026-09-01'].meals[0].calories,110);
  assert.equal(F.recentFoods(raw,[{...bread,archived:true}]).length,0);
  const meal=F.resolveDays(raw,[])['2026-09-01'].meals[0];
  assert.equal(meal.calories,100);assert.match(meal.nutritionIssue,/unavailable/);
});
test('conversion removals are detected and do not silently rewrite snapshots', () => {
  const raw=day(F.createMeal(bread,2,'slice','Lunch'));
  const edited={...bread,portions:[]};
  assert.deepEqual(F.impact(raw,edited),{entries:1,days:1,blocked:1});
  const meal=F.resolveDays(raw,[edited])['2026-09-01'].meals[0];
  assert.equal(meal.calories,100);assert.match(meal.nutritionIssue,/conversion/);
});
test('validation rejects duplicates, contradictory equivalents and invalid numeric input', () => {
  assert.equal(F.validate(bread), '');
  assert.match(F.validate({...bread,id:'other'},[bread]),/already exists/);
  for(const x of [-1,Infinity,NaN,'']) assert.ok(F.validate({...bread,calories:x}));
  assert.ok(F.validate({...bread,servingQty:0}));
  assert.ok(F.validate({...bread,portions:[{qty:1,unit:'oz'}]}));
  assert.ok(F.validate({...bread,portions:[{qty:1,unit:'cup'},{qty:16,unit:'tbsp'}]}));
  assert.throws(()=>F.createMeal(bread,0,'g','Lunch'));
  assert.throws(()=>F.createMeal(bread,1,'cup','Lunch'));
});
test('precision comes from current food definition, never previously rounded snapshots', () => {
  const raw=day(F.createMeal({...bread,calories:103},7,'g','Lunch'));
  const a=F.resolveDays(raw,[{...bread,calories:107}]);
  const b=F.resolveDays(a,[{...bread,calories:103}]);
  assert.equal(b['2026-09-01'].meals[0].calories,raw['2026-09-01'].meals[0].calories);
});
