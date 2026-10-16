import { STAGES, SKILLS, UPGRADES, normalizeSave, levelFor, availablePoints, buySkill, buyUpgrade, upgradeCost, statsFor, rewardRun } from './progression.js';
import { Combat } from './combat.js';
export function createCampaign(engine) {
  let save; try { save = normalizeSave(JSON.parse(localStorage.getItem('hop-campaign') || '{}')); } catch { save = normalizeSave(); }
  let stage = 0, endless = false, combat = null, active = false, settled = true;
  const panel = document.querySelector('#hop-campaign');
  const stats = document.querySelector('#hop-profile');
  const hud = document.querySelector('#hop-health');
  const dash = document.querySelector('#hop-dash');
  const route = document.querySelector('#hop-route');
  function refreshSave() { try { const latest = localStorage.getItem('hop-campaign'); if (latest) save = normalizeSave(JSON.parse(latest)); } catch {} }
  function persist() { try { localStorage.setItem('hop-campaign', JSON.stringify(save)); } catch { document.querySelector('#hop-status').textContent = 'Progress could not be saved in this browser.'; } }
  function render() {
    stats.textContent = `level ${levelFor(save.xp)} · ${save.credits} credits · ${availablePoints(save)} skill point${availablePoints(save) === 1 ? '' : 's'}`;
    panel.querySelectorAll('[data-stage]').forEach(button => { const value = Number(button.dataset.stage); button.disabled = active || (value >= 0 && value > save.unlocked); button.setAttribute('aria-pressed', String(value < 0 ? endless : !endless && value === stage)); });
    const selected = statsFor(save);
    if (!active) { hud.textContent = '♥'.repeat(selected.health); hud.setAttribute('aria-label', `${selected.health} maximum health`); route.textContent = endless ? 'Endless' : STAGES[stage].name; }
    document.querySelector('#hop-loadout').textContent = `${selected.health} hearts · ${selected.damage} damage · ${selected.cooldown.toFixed(1)}s dash`;
    for (const item of SKILLS) {
      const button = panel.querySelector(`[data-skill="${item.id}"]`), rank = save.skills[item.id];
      const locked = item.requires && !save.skills[item.requires];
      button.disabled = active || rank >= item.max || locked || availablePoints(save) < item.cost;
      button.classList.toggle('is-owned', rank > 0); button.classList.toggle('is-locked', Boolean(locked));
      button.querySelector('output').textContent = rank >= item.max ? 'max' : `${rank}/${item.max} · ${item.cost} sp`;
    }
    for (const item of UPGRADES) {
      const button = panel.querySelector(`[data-upgrade="${item.id}"]`), rank = save.upgrades[item.id];
      button.disabled = active || rank >= item.max || save.credits < upgradeCost(save, item);
      button.querySelector('output').textContent = rank >= item.max ? 'max' : `${rank}/${item.max} · ${upgradeCost(save, item)} credits`;
    }
    document.querySelector('#hop-respec').disabled = active || save.spent === 0;
  }
  const stages = panel.querySelector('.hop-stage-list');
  STAGES.forEach((item, i) => { const button = document.createElement('button'); button.className = 'hop-stage-choice'; button.dataset.stage = i; button.textContent = item.name; stages.append(button); });
  const endlessButton = document.createElement('button'); endlessButton.className = 'hop-stage-choice'; endlessButton.dataset.stage = -1; endlessButton.textContent = 'Endless'; stages.append(endlessButton);
  for (const branch of ['Movement', 'Survival', 'Combat']) {
    const column = document.createElement('section'); column.className = 'hop-skill-branch';
    const title = document.createElement('h3'); title.textContent = branch; column.append(title);
    for (const item of SKILLS.filter(item => item.branch === branch)) {
      const button = document.createElement('button'); button.className = 'hop-node'; button.dataset.skill = item.id; button.setAttribute('aria-label', item.name);
      button.innerHTML = `<span>${item.name}</span><small>${item.detail}</small><output></output>`;
      column.append(button);
    }
    panel.querySelector('#hop-skill-tree').append(column);
  }
  for (const item of UPGRADES) {
    const button = document.createElement('button'); button.className = 'hop-node'; button.dataset.upgrade = item.id; button.setAttribute('aria-label', item.name);
    button.innerHTML = `<span>${item.name}</span><small>${item.detail}</small><output></output>`;
    panel.querySelector('#hop-upgrades').append(button);
  }
  panel.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || active) return;
    refreshSave();
    if (button.dataset.stage !== undefined) { const next = Number(button.dataset.stage); if (next > save.unlocked) return; endless = next < 0; stage = Math.max(0, next); document.querySelector('#hop-start').textContent = 'Start'; }
    if (button.dataset.skill && buySkill(save, button.dataset.skill)) persist();
    if (button.dataset.upgrade && buyUpgrade(save, button.dataset.upgrade)) persist();
    if (button.id === 'hop-respec') { save.skills = normalizeSave().skills; save.spent = 0; persist(); }
    render();
  });
  window.addEventListener('storage', event => { if (event.key === 'hop-campaign' && !active) { refreshSave(); render(); } });
  render();
  return {
    begin() {
      const values = statsFor(save); engine.runner_configure(values.health, values.dash, values.cooldown, values.air);
      combat = new Combat(engine, values, stage, endless); active = true; settled = false; render();
    },
    step(dt, firing) { combat?.step(dt, firing); },
    fire() { return combat?.fire(); },
    draw(ctx, reducedMotion) { combat?.draw(ctx, reducedMotion); },
    get won() { return Boolean(combat?.won); },
    get sky() { return STAGES[stage].sky; },
    get label() { return endless ? 'Endless' : STAGES[stage].name; },
    updateHud() {
      const health = Math.max(0, engine.runner_value(11)); hud.textContent = '♥'.repeat(health) + '♡'.repeat(Math.max(0, engine.runner_value(15) - health));
      hud.setAttribute('aria-label', `${health} health remaining`);
      const cooldown = engine.runner_value(14); dash.textContent = cooldown > 0 ? `Dash ${cooldown.toFixed(1)}` : 'Dash';
      dash.disabled = !active || cooldown > 0;
      const distance = engine.runner_value(2) / 12;
      route.textContent = combat?.boss ? STAGES[stage].boss : endless ? 'Endless' : `${STAGES[stage].name} · ${Math.min(STAGES[stage].distance, Math.floor(distance))}/${STAGES[stage].distance} m`;
    },
    finish() {
      if (settled || !combat) return '';
      settled = true; active = false;
      refreshSave();
      const reward = rewardRun(save, { stage, distance: engine.runner_value(2) / 12, kills: combat.kills, won: combat.won });
      persist(); render();
      return `${combat.won ? 'Stage clear' : 'Run complete'} · +${reward.xp} XP · +${reward.credits} credits`;
    },
  };
}
