// mock bootstrap —— 仅用于接入验证页，模拟游戏全局
window.PetSprites = {};
const PETS = [
  { id: 1, name: '血狐', icon: '🦊', level: 24, growth: 42.5, evolveTimes: 1, rebornCount: 0, cloudId: 'c1', equipment: {} },
  { id: 2, name: '血牙狐', icon: '🦊', level: 40, growth: 55.3, evolveTimes: 2, rebornCount: 0, cloudId: 'c2', equipment: {} },
  { id: 3, name: '幽火狐', icon: '🦊', level: 60, growth: 62.0, evolveTimes: 4, rebornCount: 0, cloudId: 'c3', equipment: {} },
  { id: 4, name: '冥霜狼', icon: '🐺', level: 60, growth: 63.5, evolveTimes: 4, rebornCount: 0, cloudId: 'c4', equipment: {} },
  { id: 5, name: '赤霄神龙', icon: '🐉', level: 60, growth: 66.0, evolveTimes: 4, rebornCount: 0, cloudId: 'c5', equipment: {}, isGodPet: true }
];
const godPets = { minGrowth: 60, list: [{ id: 'god1', name: '赤霄神龙', minGrowth: 60 }] };
window.Config = {
  pet: { evolution: { maxEvolveTimes: 10, materialName: '进化素材', stages: [{ stage: 2, growthBoost: [0.1, 0.2] }, { stage: 3, growthBoost: [0.3, 0.4] }], growthBoost: [0.1, 0.2], boostItems: ['ev_essence'] }, godPets: godPets },
  synthesize: { material: { name: '合成之石', amount: 1 }, minLevel: 10, mutation: { chance: 0.5, growthBonus: [1, 3] }, god: { minStage: 5 } },
  nirvana: { minLevel: 60, absorbRatio: 0.5, resetLevel: true, defaultItem: 'nir_pill' },
  itemsOf: (cat) => [
    { id: 'synth_boost', category: 'synth', name: '越龙之石', icon: '💎', effect: '+10% 成长 / 神级30%' },
    { id: 'synth_god', category: 'synth', name: '至尊神石', icon: '👑', effect: '+30% 成长 / 神级100%' },
    { id: 'nir_pill', category: 'nirvana', name: '涅槃丹', icon: '🔥', effect: '吸收×1.2', boostMult: 1.2 },
    { id: 'ev_essence', category: 'evolve', name: '进化精粹', icon: '✨', effect: '成长+50%', boost: 0.5 }
  ],
  itemOf: (id) => (({ synth_boost: { id: 'synth_boost', category: 'synth', name: '越龙之石', icon: '💎', effect: '+10% 成长 / 神级30%', godChance: 0.3 }, synth_god: { id: 'synth_god', category: 'synth', name: '至尊神石', icon: '👑', effect: '+30% 成长 / 神级100%', godChance: 1 }, nir_pill: { id: 'nir_pill', category: 'nirvana', name: '涅槃丹', icon: '🔥', effect: '吸收×1.2', boostMult: 1.2 }, ev_essence: { id: 'ev_essence', category: 'evolve', name: '进化精粹', icon: '✨', effect: '成长+50%', boost: 0.5 } })[id] || null)
};
const pstage = (p) => p.isGodPet ? 5 : Math.min(5, p.level >= 60 ? 5 : p.level >= 40 ? 4 : p.level >= 25 ? 3 : p.level >= 10 ? 2 : 1);
const plabel = (p) => ['初始', '一阶', '二阶', '三阶', '终阶'][pstage(p) - 1];
const stats = (p) => { const g = p.growth || 1; return { hp: Math.round(80 + g * 26), atk: Math.round(20 + g * 11), def: Math.round(14 + g * 6.2), spd: Math.round(8 + g * 1.4) }; };
window.Pet = {
  getPets: () => PETS,
  getActivePet: () => PETS[4],
  setActive: () => {},
  getStats: (p) => stats(p),
  getCurHp: () => 1,
  getBonusText: () => '',
  expNeed: () => 1000,
  getEvolveStage: (p) => pstage(p),
  stageLabel: (p) => plabel(p),
  isGodPet: (p) => !!p.isGodPet
};
window.Util = { randFloat: (a, b) => a + 0.15 };
window.Equipment = { SLOTS: [], unequip: () => {}, describeItem: () => null, rarityOf: () => 'common', equipItem: () => {}, getInventory: () => [], flattenAffixes: () => [] };
window.Materials = { getQuantity: (n) => ({ '合成之石': 8, '进化素材': 5, '进化精粹': 2, '涅槃丹': 3, '越龙之石': 1, '至尊神石': 0 }[n] || 1) };
window.Market = { isListed: () => false };
const synthCalc = (main, sub, mutated) => Math.round((main.growth + sub.growth * 0.25 + (mutated ? 2 : 0) + 1) * 10) / 10;
window.Merge = {
  canSynthesize: (p) => !p.isGodPet && p.growth >= 10,
  canMerge: (p) => !!p.isGodPet,
  getMergeCandidates: (mainId) => PETS.filter(p => p.id !== mainId && !p.isGodPet && p.growth >= 10),
  calcSynthesizeGrowth: (main, sub, mutated) => synthCalc(main, sub, mutated),
  godSynthInfo: (main, sub) => {
    const ready = pstage(main) >= 5 && pstage(sub) >= 5 && main.growth >= 60 && sub.growth >= 60;
    return { god: ready ? { name: '赤霄神龙', icon: '🐉' } : null, chance: 0.3, minGrowth: 60, ready: ready };
  },
  synthesize: async (mainId, subId) => ({ baby: { id: 99, name: '赤霄神龙', growth: 70 }, isGod: true, newGrowth: 70, mainName: 'A', subName: 'B' }),
  calcNirvanaGrowth: (main, sub, mult) => ({ growth: Math.round((main.growth + sub.growth * 0.5 * (mult || 1)) * 10) / 10, absorb: Math.round(sub.growth * 0.5 * (mult || 1) * 10) / 10 }),
  nirvana: async (mainId, subId, x, pill) => ({ main: { ...PETS[4], level: 1, growth: 80 }, oldGrowth: 66, newGrowth: 80 })
};
const routes = {
  1: [{ to: '血牙狐', minLevel: 25, stage: 2, label: '二阶·利爪' }],
  2: [{ to: '九尾狐', minLevel: 40, stage: 3, label: '三阶·妖火' }],
  3: [{ to: '幽火狐', minLevel: 60, stage: 4, label: '四阶·灵焰' }],
  4: [{ to: '寒霜狼王', minLevel: 60, stage: 4, label: '四阶·冰魄' }]
};
window.Evolve = {
  hasRoute: (p) => !p.isGodPet && !!routes[p.id],
  getEvolutionRoutes: (p) => routes[p.id] || [],
  getRouteMaterial: (p) => ({ name: '进化素材', amount: 3, have: 5, enough: true, label: '二阶·利爪' }),
  evolve: async (id, i, boost) => ({ pet: { ...PETS[0], growth: 44 }, newGrowth: 44, result: '血牙狐', keepForm: false })
};
const EMOJI = { '血狐': '🦊', '血牙狐': '🦊', '幽火狐': '🦊', '冥霜狼': '🐺', '赤霄神龙': '🐉', '九尾狐': '🦊', '寒霜狼王': '🐺' };
window.PetUI = {
  iconHtml: (name) => `<span class="pet-emoji">${EMOJI[name] || '🐾'}</span>`,
  petTipHtml: () => '', showPetTip: () => {}, hidePetTip: () => {}, bindPetTip: () => {}, flashStat: () => {},
  traitInheritLine: () => ''
};
window.UI = {
  escapeHtml: (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  $: (id) => document.getElementById(id),
  showToast: (t, m) => { console.log('[toast]', t, m); },
  addLog: (m) => { console.log('[log]', m); },
  renderAll: () => { try { window.UI.renderSynthTab(); window.UI.renderEvolveTab(); window.UI.renderMergeTab(); } catch (e) { console.error(e); } }
};
