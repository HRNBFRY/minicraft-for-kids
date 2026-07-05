import { CFG, DIM, blockIdByName, DEFAULT_SKY } from './constants.js';

const BASE = new URL('../../', import.meta.url); // index.html と同じ階層

async function fetchJSON(path) {
  const res = await fetch(new URL(path, BASE).href, { cache: 'no-cache' });
  if (!res.ok) throw new Error('failed to load ' + path);
  return res.json();
}

export async function listProfiles() {
  return fetchJSON('profiles/manifest.json');
}
export async function listWorlds() {
  return fetchJSON('worlds/manifest.json');
}

export async function loadProfile(id) {
  const raw = await fetchJSON('profiles/' + id + '.json');
  if (raw.extends) {
    const base = await fetchJSON('profiles/' + raw.extends + '.json');
    return deepMerge(base, raw);
  }
  return raw;
}

export async function loadWorld(id) {
  return fetchJSON('worlds/' + id + '.json');
}

function deepMerge(base, override) {
  const out = Object.assign({}, base);
  for (const k in override) {
    if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k]) &&
        base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], override[k]);
    } else {
      out[k] = override[k];
    }
  }
  return out;
}

function hexToInt(hex, fallback) {
  if (typeof hex === 'number') return hex;
  if (typeof hex === 'string' && hex[0] === '#') return parseInt(hex.slice(1), 16);
  return fallback;
}

// world.json の "ores" 定義を World が使える形（blockId 済み）に変換
function resolveOres(list) {
  return (list || []).map(o => ({
    blockId: blockIdByName(o.id),
    chance: o.chance, minY: o.minY, maxY: o.maxY
  })).filter(o => o.blockId !== undefined);
}

// CFG（可変グローバル設定）に world.json を反映し、Game 生成に必要な
// 派生設定（次元ごとの terrain / sky / oreDefs）をまとめて返す
export function applyWorldConfig(profile, world) {
  CFG.SEED = world.seed;
  CFG.WORLD_SIZE = world.worldSize;
  CFG.CHUNK = world.chunkSize;
  CFG.CHUNKS = world.worldSize / world.chunkSize;
  CFG.HEIGHT = world.height;
  CFG.RENDER_DIST = world.renderDist;
  CFG.SEA = world.terrain.overworld.sea;
  CFG.SNOW_LINE = world.terrain.overworld.snowLine;
  CFG.GRAVITY = 28 * (world.gravityMultiplier || 1);
  CFG.SPEED_WALK = world.movement.walk;
  CFG.SPEED_FLY = world.movement.fly;
  CFG.SPEED_WATER = world.movement.water;
  CFG.SAVE_KEY = 'minicraft_' + profile.id + '_' + world.id + '_v1';

  const overOres = resolveOres(world.terrain.overworld.ores);

  const sky = DEFAULT_SKY.map((base, i) => {
    const key = i === DIM.OVER ? 'overworld' : i === DIM.NETHER ? 'nether' : 'end';
    const ov = (world.sky && world.sky[key]) || {};
    return {
      sky: hexToInt(ov.sky, base.sky),
      fogNear: ov.fogNear !== undefined ? ov.fogNear : base.fogNear,
      fogFar: ov.fogFar !== undefined ? ov.fogFar : (base.fogFar != null ? base.fogFar : CFG.RENDER_DIST * 16 - 4),
      fogFarAuto: ov.fogFar === undefined && base.fogFar == null,
      ambIntensity: ov.ambIntensity !== undefined ? ov.ambIntensity : base.ambIntensity,
      ambColor: hexToInt(ov.ambColor, base.ambColor),
      sunIntensity: ov.sunIntensity !== undefined ? ov.sunIntensity : base.sunIntensity,
      sunColor: hexToInt(ov.sunColor, base.sunColor)
    };
  });

  return {
    terrainByDim: [world.terrain.overworld, world.terrain.nether, world.terrain.end],
    oreDefs: overOres,
    sky,
    plantsEnabled: !!(world.plants && world.plants.trees)
  };
}
