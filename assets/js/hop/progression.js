export const STAGES = [
  { name: 'Outskirts', distance: 180, boss: 'Watcher', hp: 120, reward: 90, sky: '#101b20', accent: '#95d6bf' },
  { name: 'Foundry', distance: 230, boss: 'Furnace', hp: 190, reward: 140, sky: '#21171b', accent: '#efa87d' },
  { name: 'Relay', distance: 280, boss: 'Overseer', hp: 270, reward: 210, sky: '#17182a', accent: '#b9abf5' },
];
export const SKILLS = [
  { id: 'dash', branch: 'Movement', name: 'Long dash', detail: '+0.12 seconds of dash protection.', cost: 1, max: 2 },
  { id: 'air', branch: 'Movement', name: 'Air dash', detail: 'Dash while airborne.', cost: 2, max: 1, requires: 'dash' },
  { id: 'recharge', branch: 'Movement', name: 'Quick recovery', detail: 'Dash recharges 0.65 seconds faster.', cost: 2, max: 2, requires: 'air' },
  { id: 'health', branch: 'Survival', name: 'Extra heart', detail: '+1 maximum health.', cost: 1, max: 2 },
  { id: 'repair', branch: 'Survival', name: 'Field repair', detail: 'Restore a heart before a boss fight.', cost: 2, max: 1, requires: 'health' },
  { id: 'siphon', branch: 'Survival', name: 'Recovery', detail: 'Restore a heart after every 4 drones defeated.', cost: 2, max: 1, requires: 'repair' },
  { id: 'damage', branch: 'Combat', name: 'Charged rounds', detail: '+3 damage per shot.', cost: 1, max: 3 },
  { id: 'pierce', branch: 'Combat', name: 'Piercing rounds', detail: 'Shots pass through drones.', cost: 2, max: 1, requires: 'damage' },
  { id: 'rapid', branch: 'Combat', name: 'Rapid fire', detail: 'Fire 15% faster per rank.', cost: 2, max: 2, requires: 'pierce' },
];
export const UPGRADES = [
  { id: 'barrel', name: 'Barrel', detail: '+2 shot damage.', base: 60, max: 5 },
  { id: 'capacitor', name: 'Capacitor', detail: '5% faster firing.', base: 80, max: 4 },
  { id: 'plating', name: 'Plating', detail: '+1 maximum health.', base: 140, max: 2 },
];
const count = (n, max = 10000000) => Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : 0;
export function normalizeSave(raw = {}) {
  const save = { xp: count(raw.xp), credits: count(raw.credits), spent: count(raw.spent, 30), unlocked: count(raw.unlocked, 2), clears: count(raw.clears), skills: {}, upgrades: {} };
  for (const skill of SKILLS) save.skills[skill.id] = count(raw.skills?.[skill.id], skill.max);
  for (const upgrade of UPGRADES) save.upgrades[upgrade.id] = count(raw.upgrades?.[upgrade.id], upgrade.max);
  return save;
}
export const levelFor = xp => Math.floor(Math.sqrt(Math.max(0, xp) / 50)) + 1;
export const availablePoints = save => Math.max(0, 2 + levelFor(save.xp) - 1 - save.spent);
export const upgradeCost = (save, item) => item.base * (1 + save.upgrades[item.id]);
export function buySkill(save, id) {
  const item = SKILLS.find(item => item.id === id);
  if (!item || save.skills[id] >= item.max || availablePoints(save) < item.cost || (item.requires && !save.skills[item.requires])) return false;
  save.skills[id]++; save.spent += item.cost; return true;
}
export function buyUpgrade(save, id) {
  const item = UPGRADES.find(item => item.id === id);
  if (!item || save.upgrades[id] >= item.max || save.credits < upgradeCost(save, item)) return false;
  save.credits -= upgradeCost(save, item); save.upgrades[id]++; return true;
}
export function statsFor(save) {
  return { health: 3 + save.skills.health + save.upgrades.plating, damage: 8 + save.skills.damage * 3 + save.upgrades.barrel * 2,
    interval: .42 * (1 - save.skills.rapid * .15) * (1 - save.upgrades.capacitor * .05), dash: .24 + save.skills.dash * .12,
    cooldown: 4 - save.skills.recharge * .65, air: save.skills.air, pierce: save.skills.pierce, repair: save.skills.repair, siphon: save.skills.siphon };
}
export function rewardRun(save, run) {
  // A run is settled once by its caller. Defeats still retain earned progress.
  const distance = Math.max(0, Math.floor(run.distance));
  const credits = Math.floor(distance / 8) + run.kills * 7 + (run.won ? STAGES[run.stage].reward : 0);
  const xp = Math.floor(distance / 3) + run.kills * 12 + (run.won ? 100 + run.stage * 60 : 0);
  save.credits += credits; save.xp += xp;
  if (run.won) { save.unlocked = Math.min(2, Math.max(save.unlocked, run.stage + 1)); save.clears++; }
  return { credits, xp };
}
