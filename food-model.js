/* Shared nutrition model: logged amounts are facts; library nutrition is live.
 * Snapshots remain on meals for offline compatibility and missing food records. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FTFood = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const nutrients = ['calories', 'protein', 'carbs', 'fat', 'fiber'];
  const mass = { g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237 };
  // US customary volume. Mass/volume conversions require a food-specific equivalent.
  const volume = { ml: 1, l: 1000, 'fl oz': 29.5735295625, cup: 236.5882365, tbsp: 14.78676478125, tsp: 4.92892159375 };
  const units = [...Object.keys(mass), ...Object.keys(volume), 'slice', 'piece', 'scoop', 'serving'];
  const nameKey = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const positive = x => x !== '' && Number.isFinite(Number(x)) && Number(x) > 0;
  const nonnegative = x => x !== '' && x != null && Number.isFinite(Number(x)) && Number(x) >= 0;
  const id = () => globalThis.crypto?.randomUUID?.() || `food-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const family = unit => mass[unit] ? 'mass' : volume[unit] ? 'volume' : unit;
  function ratioBetween(fromQty, fromUnit, toQty, toUnit) {
    if (!positive(fromQty) || !nonnegative(toQty)) return null;
    if (fromUnit === toUnit) return Number(toQty) / Number(fromQty);
    const table = mass[fromUnit] && mass[toUnit] ? mass : volume[fromUnit] && volume[toUnit] ? volume : null;
    return table ? Number(toQty) * table[toUnit] / (Number(fromQty) * table[fromUnit]) : null;
  }
  function parseAmount(value) {
    const match = String(value || '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?|\.\d+)\s*([a-z ]+)$/);
    if (!match || !positive(match[1])) return null;
    const aliases = { grams:'g', gram:'g', ounces:'oz', ounce:'oz', slices:'slice', pieces:'piece', servings:'serving', scoops:'scoop', cups:'cup', milliliters:'ml' };
    const unit = aliases[match[2]] || match[2];
    return units.includes(unit) ? { qty:Number(match[1]), unit } : null;
  }
  function basis(food) {
    if (positive(food?.servingQty) && units.includes(food.servingUnit)) return { qty:Number(food.servingQty), unit:food.servingUnit };
    const parsed = parseAmount(food?.servingSize);
    if (parsed) return parsed;
    return positive(food?.grams) ? { qty:Number(food.grams), unit:'g' } : null;
  }
  function anchors(food) {
    const base = basis(food);
    if (!base) return [{qty:1, unit:'serving'}];
    return [base, ...(food.portions || []), ...(base.unit === 'serving' ? [] : [{qty:1, unit:'serving'}])];
  }
  function ratio(food, qty, unit) {
    for (const anchor of anchors(food)) {
      const result = ratioBetween(anchor.qty, anchor.unit, qty, unit);
      if (result != null) return result;
    }
    return null;
  }
  const availableUnits = food => units.filter(unit => ratio(food, 1, unit) != null);
  function convert(food, qty, from, to) {
    const a = ratio(food, qty, from), b = ratio(food, 1, to);
    return a != null && b > 0 ? a / b : null;
  }
  const scale = (food, multiple) => Object.fromEntries(nutrients.map(key => [key, Math.round(Number(food[key] || 0) * multiple * 100) / 100]));
  function validate(food, library = []) {
    if (!nameKey(food.name)) return 'Enter a food name.';
    if (library.some(f => String(f.id) !== String(food.id) && nameKey(f.name) === nameKey(food.name))) return 'A food with this name already exists. Edit or restore that record, or use a distinct name.';
    if (!basis(food)) return 'Enter a positive serving amount and a supported unit.';
    if (nutrients.some(key => !nonnegative(food[key]))) return 'All nutrition values must be finite numbers of zero or more.';
    const seen = new Set([family(basis(food).unit), 'serving']);
    for (const portion of food.portions || []) {
      if (!positive(portion.qty) || !units.includes(portion.unit)) return 'Each equivalent needs a positive amount and a supported unit.';
      if (seen.has(family(portion.unit))) return 'Use only one equivalent per unit family. Weight and volume units convert automatically.';
      seen.add(family(portion.unit));
    }
    return '';
  }
  function mealAmount(meal) {
    if (positive(meal.quantity) && units.includes(meal.unit)) return {qty:Number(meal.quantity), unit:meal.unit};
    return parseAmount(meal.servingSize);
  }
  function createMeal(food, qty, unit, mealType, existing = {}) {
    const multiple = ratio(food, qty, unit);
    if (!positive(qty) || multiple == null) throw new Error('Choose a positive amount in a supported unit.');
    return { ...existing, id:existing.id || id(), foodId:food.id, name:food.name,
      quantity:Number(qty), unit, servingSize:`${Number(qty)} ${unit}`, mealType,
      ...scale(food, multiple), addedAt:existing.addedAt || new Date().toISOString(), updatedAt:Date.now(), standalone:undefined, nutritionIssue:undefined };
  }
  function indexLibrary(library) {
    const byId = new Map(), byName = new Map();
    for (const food of library || []) {
      byId.set(String(food.id), food);
      const key = nameKey(food.name);
      byName.set(key, byName.has(key) ? null : food); // ambiguous legacy names must remain unlinked
    }
    return {byId, byName};
  }
  // Migration only adds identity/amount metadata. It never invents an amount,
  // rewrites timestamps, or links explicitly one-time records.
  function linkLegacyDays(days, library) {
    const {byName} = indexLibrary(library);
    let next = days;
    for (const [date, day] of Object.entries(days || {})) {
      let changed = false;
      const meals = (day.meals || []).map(meal => {
        if (meal.foodId != null || meal.standalone) return meal;
        const food = byName.get(nameKey(meal.name)), amount = mealAmount(meal);
        if (!food || !amount || ratio(food, amount.qty, amount.unit) == null) return meal;
        changed = true;
        return {...meal, foodId:food.id, quantity:amount.qty, unit:amount.unit};
      });
      if (changed) { if (next === days) next = {...days}; next[date] = {...day, meals}; }
    }
    return next;
  }
  function resolveDays(days, library) {
    const {byId} = indexLibrary(library);
    const result = {};
    for (const [date, day] of Object.entries(days || {})) {
      result[date] = {...day, meals:(day.meals || []).map(meal => {
        if (meal.foodId == null) return meal;
        const food = byId.get(String(meal.foodId)), amount = mealAmount(meal);
        const multiple = food && amount ? ratio(food, amount.qty, amount.unit) : null;
        if (multiple == null) return {...meal, nutritionIssue:food ? 'Unit conversion needs review; showing saved nutrition.' : 'Food record unavailable; showing saved nutrition.'};
        return {...meal, ...scale(food, multiple), name:food.name, nutritionIssue:undefined};
      })};
    }
    return result;
  }
  function impact(days, food) {
    let entries = 0, blocked = 0;
    const dates = new Set();
    for (const [date, day] of Object.entries(days || {})) for (const meal of day.meals || []) {
      if (meal.foodId == null || String(meal.foodId) !== String(food.id)) continue;
      entries++; dates.add(date);
      const amount = mealAmount(meal);
      if (!amount || ratio(food, amount.qty, amount.unit) == null) blocked++;
    }
    return {entries, days:dates.size, blocked};
  }
  function recentFoods(days, library) {
    const {byId} = indexLibrary(library), latest = new Map();
    for (const [date, day] of Object.entries(days || {})) for (const meal of day.meals || []) {
      const food = byId.get(String(meal.foodId));
      if (!food || food.archived) continue;
      const stamp = date + (meal.addedAt || '');
      if (!latest.has(String(food.id)) || stamp > latest.get(String(food.id)).stamp) latest.set(String(food.id), {food, meal, stamp});
    }
    return [...latest.values()].sort((a,b) => b.stamp.localeCompare(a.stamp));
  }
  return {nutrients, units, mass, volume, id, nameKey, positive, ratioBetween, parseAmount, basis, ratio, availableUnits, convert, scale, validate, mealAmount, createMeal, linkLegacyDays, resolveDays, impact, recentFoods};
});
