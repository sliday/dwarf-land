import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const indexHtml = readFileSync(
  join(process.cwd(), 'public/index.html'),
  'utf8'
);
const gameWorker = readFileSync(
  join(process.cwd(), 'public/game-worker.js'),
  'utf8'
);

describe('client state contract', () => {
  it('serializes extended world state for local saves', () => {
    expect(indexHtml).toContain("graves: G.graves || {}");
    expect(indexHtml).toContain("yearResolutions: G.yearResolutions || []");
    expect(indexHtml).toContain("suburbs: G.suburbs || []");
    expect(indexHtml).toContain("dirtTiles: G.dirtTiles || []");
  });

  it('serializes extended dwarf state for reloads', () => {
    expect(indexHtml).toContain("travelMode: d.travelMode || null");
    expect(indexHtml).toContain("hp: d.hp, maxHp: d.maxHp, ac: d.ac, poisonTicks: d.poisonTicks || 0, pet: d.pet || null");
    expect(indexHtml).toContain("sponsored: d.sponsored || false");
    expect(indexHtml).toContain("relationships: d.relationships || []");
  });

  it('restores extended dwarf state from saves', () => {
    expect(indexHtml).toContain("hp: sd.hp ?? d.hp, maxHp: sd.maxHp ?? d.maxHp, ac: sd.ac ?? d.ac");
    expect(indexHtml).toContain("poisonTicks: sd.poisonTicks || 0, pet: sd.pet || null");
    expect(indexHtml).toContain("travelMode: sd.travelMode ?? null");
    expect(indexHtml).toContain("sponsored: sd.sponsored || false, sponsorTier: sd.sponsorTier || null");
    expect(indexHtml).toContain("relationships: sd.relationships || []");
  });

  it('passes restored world state into worker init', () => {
    expect(indexHtml).toContain("yearResolutions: G.yearResolutions || []");
    expect(indexHtml).toContain("suburbs: G.suburbs || []");
    expect(indexHtml).toContain("dirtTiles: G.dirtTiles || []");
  });

  it('preserves dwarf detail fields across lightweight worker snapshots', () => {
    expect(indexHtml).toContain('const previousDwarves = new Map(G.dwarves.map(d => [d.id, d]))');
    expect(indexHtml).toContain('G.dwarves = data.dwarves.map(d => ({ ...previousDwarves.get(d.id), ...d }))');
    expect(gameWorker).toContain('const includeDetails = G.tick % 30 === 0');
    expect(gameWorker).toContain('...(includeDetails ? {');
    expect(gameWorker).toContain('eventLog:d.eventLog?.slice(-50)');
  });

  it('interpolates render positions without changing simulation coordinates', () => {
    expect(indexHtml).toContain('function getEntityRenderPosition(entity, nowMs, snapTiles)');
    expect(indexHtml).toContain('function unwrapRenderX(fromX, rawX)');
    expect(indexHtml).toContain("const pos = getEntityRenderPosition(d, renderNowMs, d.state === 'traveling' ? 40 : 8)");
    expect(indexHtml).toContain('const pos = getEntityRenderPosition(a, renderNowMs, 8)');
    expect(indexHtml).toContain('const previousAnimals = new Map(G.animals.map(a => [a.id, a]))');
  });

  it('draws selected dwarf routes from focused worker paths', () => {
    expect(indexHtml).toContain('function drawSelectedDwarfRoute(nowMs)');
    expect(indexHtml).toContain('drawSelectedDwarfRoute(renderNowMs)');
    expect(indexHtml).toContain("gameWorker.postMessage({ type: 'route_focus', dwarfId: nextId })");
    expect(indexHtml).toContain('routeDwarfId: G.routeDwarfId || null');
    expect(gameWorker).toContain("case 'route_focus':");
    expect(gameWorker).toContain('G.routeDwarfId = data.dwarfId || null');
    expect(gameWorker).toContain("...(d.id === G.routeDwarfId ? {path:d.path||[]} : {})");
  });

  it('lets dwarves claim empty towns and repairs production zero-pop cities', () => {
    expect(indexHtml).toContain('function tryMoveIntoEmptyTown(d)');
    expect(indexHtml).toContain('function rebalanceEmptyCities()');
    expect(indexHtml).toContain("d.target = { type: 'move_town', cityId: town.id, x: town.mx, y: town.my }");
    expect(indexHtml).toContain("else if (tt === 'move_town')");
    expect(indexHtml).toContain('if (G.dwarves.length === 0 && G.homeCity) spawnDwarfAtCity(G.homeCity)');
    expect(indexHtml).toContain('rebalanceEmptyCities();');
    expect(gameWorker).toContain('function tryMoveIntoEmptyTown(d)');
    expect(gameWorker).toContain('function rebalanceEmptyCities()');
    expect(gameWorker).toContain("d.target = {type:'move_town', cityId:town.id, x:town.mx, y:town.my}");
    expect(gameWorker).toContain("} else if (tt === 'move_town') {");
    expect(gameWorker).toContain('if (G.dwarves.length === 0 && G.homeCity) spawnDwarfAtCity(G.homeCity)');
    expect(gameWorker).toContain('donor.cityId = city.id');
  });

  it('uses JetBrains Mono as the compact UI monospace face', () => {
    expect(indexHtml).toContain("family=JetBrains+Mono");
    expect(indexHtml).toContain("--ui-mono: 'JetBrains Mono'");
    expect(indexHtml).toContain('body { font-family: var(--ui-mono)');
  });

  it('keeps worker save and restore fields aligned with browser saves', () => {
    expect(gameWorker).toContain('travelMode:d.travelMode||null');
    expect(gameWorker).toContain('starveTicks:d.starveTicks||0');
    expect(gameWorker).toContain('relationships:d.relationships||[]');
    expect(gameWorker).toContain('travelMode:sd.travelMode??null');
    expect(gameWorker).toContain('starveTicks:sd.starveTicks||0');
    expect(gameWorker).toContain('relationships:sd.relationships||[]');
  });

  it('sends designation resource deductions into the worker', () => {
    expect(indexHtml).toContain("gameWorker.postMessage({ type: 'designate', changes, cityResources: getCityResourcesSnapshot() })");
    expect(gameWorker).toContain('if (data.cityResources) {');
    expect(gameWorker).toContain('Object.assign(city.res, res)');
  });

  it('keeps terrain updates tracked in fallback and worker snapshot paths', () => {
    expect(indexHtml).toContain("setWorldTile(ch.x, ch.y, ch.tile, { markDirty: false })");
    expect(indexHtml).toContain("setWorldTile(x, y, T.D_MINE)");
    expect(indexHtml).toContain("setWorldTile(x, y, T.D_FARM)");
  });

  it('patches minimap tile changes instead of rebuilding the full minimap', () => {
    expect(indexHtml).toContain('const pendingMmPatches = []');
    expect(indexHtml).toContain('mmBufferCtx.createImageData(mw, mh)');
    expect(indexHtml).toContain('pendingMmPatches.push({ x: wx, y, tile })');
    expect(indexHtml).toContain('else if (pendingMmPatches.length) patchMmBuffer()');
    expect(indexHtml).toContain('if (!mmBufferCtx) mmDirty = true');
  });

  it('uses a higher desktop frame cap while keeping mobile capped lower', () => {
    expect(indexHtml).toContain('const TARGET_FPS = isMobile ? 30 : 60');
    expect(indexHtml).toContain('const FRAME_MS = 1000 / TARGET_FPS');
    expect(indexHtml).toContain('lastTime = ts - (elapsed % FRAME_MS)');
    expect(indexHtml).toContain("Math.round(frames * 1000 / (ts - fpsTimer)) + ' fps'");
  });

  it('keeps geometric industry recipes aligned between fallback and worker', () => {
    const indexRecipes = indexHtml.match(/const INDUSTRY_RECIPES = \[[\s\S]*?\];/)?.[0].replace(/\s+/g, '');
    const workerRecipes = gameWorker.match(/const INDUSTRY_RECIPES = \[[\s\S]*?\];/)?.[0].replace(/\s+/g, '');
    expect(indexRecipes).toBe(workerRecipes);
    expect(indexHtml).toContain("tools:'Tools'");
    expect(indexHtml).toContain("relics:'Relics'");
    expect(indexHtml).toContain("['🛠️','tools']");
    expect(indexHtml).toContain("['💎','relics']");
    expect(indexHtml).toContain('runCityIndustry(city, { tableCount, factoryCount }, cityPop)');
    expect(gameWorker).toContain('runCityIndustry(city, { tableCount, factoryCount }, cityPop)');
    expect(indexHtml).not.toContain('city.res.ale += Math.min(5');
    expect(gameWorker).not.toContain('city.res.ale += Math.min(5');
  });

  it('preserves travel intents in fallback mode', () => {
    expect(indexHtml).toContain("case 'travel':");
    expect(indexHtml).toContain('tryTravelFallback(d)');
  });
});
