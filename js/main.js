import { listProfiles, listWorlds, loadProfile, loadWorld, applyWorldConfig } from './core/config-loader.js';
import { resolveModules } from './modules/registry.js';
import { Game } from './core/game.js';

const LAST_CHOICE_KEY = 'minicraft_last_choice_v1';

function readLastChoice() {
  try { return JSON.parse(localStorage.getItem(LAST_CHOICE_KEY)) || {}; }
  catch (e) { return {}; }
}
function writeLastChoice(profileId, worldId) {
  try { localStorage.setItem(LAST_CHOICE_KEY, JSON.stringify({ profileId, worldId })); }
  catch (e) { /* ignore */ }
}

// プロフィール/ワールド選択画面を manifest.json から動的に組み立てる。
// 新しいプロフィール/ワールドの json を追加しても、ここは一切変更不要。
async function showSetupScreen() {
  const [profileIds, worldIds] = await Promise.all([listProfiles(), listWorlds()]);
  const [profiles, worlds] = await Promise.all([
    Promise.all(profileIds.map(loadProfile)),
    Promise.all(worldIds.map(loadWorld))
  ]);

  const last = readLastChoice();
  let selProfile = profiles.find(p => p.id === last.profileId) ? last.profileId : profiles[0].id;
  let selWorld = worlds.find(w => w.id === last.worldId) ? last.worldId : worlds[0].id;

  const root = document.getElementById('setupScreen');
  root.innerHTML = '';
  root.classList.remove('hidden');

  const box = document.createElement('div');
  box.className = 'setupBox';
  box.innerHTML =
    '<h1>MiniCraft</h1>' +
    '<div class="setupLabel">だれがあそぶ？</div>' +
    '<div class="setupRow" id="setupProfiles"></div>' +
    '<div class="setupLabel">どのワールド？</div>' +
    '<div class="setupRow" id="setupWorlds"></div>' +
    '<button id="setupStart" class="setupStart">スタート</button>';
  root.appendChild(box);

  const profileRow = box.querySelector('#setupProfiles');
  const worldRow = box.querySelector('#setupWorlds');

  function renderChoices(row, items, selectedId, onPick) {
    row.innerHTML = '';
    items.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'setupChoice' + (item.id === selectedId ? ' selected' : '');
      btn.textContent = item.playerName || item.name || item.id;
      if (item.skin && item.skin.color) btn.style.borderColor = item.skin.color;
      btn.addEventListener('click', () => { onPick(item.id); renderAll(); });
      row.appendChild(btn);
    });
  }
  function renderAll() {
    renderChoices(profileRow, profiles, selProfile, id => { selProfile = id; });
    renderChoices(worldRow, worlds, selWorld, id => { selWorld = id; });
  }
  renderAll();

  return new Promise(resolve => {
    box.querySelector('#setupStart').addEventListener('click', () => {
      writeLastChoice(selProfile, selWorld);
      root.classList.add('hidden');
      resolve({
        profile: profiles.find(p => p.id === selProfile),
        world: worlds.find(w => w.id === selWorld)
      });
    });
  });
}

async function boot() {
  let profile, world;
  try {
    ({ profile, world } = await showSetupScreen());
  } catch (e) {
    console.error('setup screen failed, falling back to defaults', e);
    profile = await loadProfile('brother');
    world = await loadWorld('normal');
  }

  const derived = applyWorldConfig(profile, world);
  const moduleDefs = await resolveModules(profile, world);
  new Game(profile, world, derived, moduleDefs);
}

window.addEventListener('load', () => { boot(); });
