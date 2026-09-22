/* vtest_exp_pack_cloud.js —— 经验包「使用后必须写云端」守值（2026-09-22）
 *
 * 守的是什么：**吃了经验包涨出来的等级/经验，必须真的落到服务器。**
 *
 * 用户实测报的 bug：「tmd 使用了经验包不会上传到服务器？？？？」
 *   根因：`TutorialMode.useExpPack` 的通用经验包分支只调了 `Pet.grantExp`（纯本地），
 *   **从没写过云端**；而包本身是 `Materials.spend` 在**服务端原子扣**掉的。
 *   ⇒ 包没了、等级只在内存里涨，刷新/重登后等级回退 —— 玩家眼里就是"经验被吞"。
 *   （引导经验包那一路本来就写云端，所以只有通用那 5 档出问题：
 *     微光经验屑 / 残魂经验囊 / 聚魂经验囊 / 魂晶经验匣 / 幽冥经验髓。）
 *
 * 顺带守两件同源的事（都在同一个 helper 里，写错就是同一类事故）：
 *   ① 已建档的宠必须 updatePet —— savePet 是无条件 INSERT（建档语义），
 *      用它"保存"会复制出一行，刷新后「莫名多出一堆重复宠」（2026-09-08 血泪）。
 *   ② 云端写失败必须吭声 —— 2026-09-11 定过：包已扣、账本已记（不可能再领一次），
 *      静默 = 玩家凭空丢一份收益还以为游戏坏了。
 */
const fs = require('fs');
const vm = require('vm');
const VTF = require('./vtest_files');

let failures = 0;
const A = (ok, msg) => { if (ok) console.log('PASS: ' + msg); else { console.error('FAIL: ' + msg); failures++; } };

const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  navigator: {},
  localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
  document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() { } }
};
ctx.window = ctx;
vm.createContext(ctx);

// 每级 600 经验：吃 1000（残魂经验囊）→ Lv5→Lv6，余 400 —— 等级和经验都变了，能同时验两个字段
const NEED = 600;
function grantExp(pet, amt) {
  pet.exp = (Number(pet.exp) || 0) + Number(amt || 0);
  while (pet.exp >= NEED && pet.level < 60) { pet.exp -= NEED; pet.level++; }
  return { leveled: true, newLevel: pet.level };
}

const cloud = [];      // 记录所有云端写（update / insert）
const logs = [];       // 记录 UI.addLog（失败必须吭声）
let spendOk = true;

ctx.Pet = {
  getPets: () => pets,
  getActivePet: () => pets[0] || null,
  grantExp
};
ctx.Materials = {
  getQuantity: (name) => (name === '残魂经验囊' ? 1 : 0),
  spend: async () => (spendOk ? { ok: true } : { ok: false, error: '余额不足' })
};
ctx.Supabase = {
  getCurrentUser: async () => ({ id: 'u1', email: 'a@b.c' }),
  updatePet: async (id, patch) => { cloud.push({ kind: 'update', id, patch }); return {}; },
  savePet: async (pet) => { cloud.push({ kind: 'insert', pet }); return { data: { id: 'new-cloud-1' } }; }
};
ctx.UI = {
  getAuthUser: () => ({ id: 'u1', email: 'a@b.c' }),
  addLog: (t) => logs.push(String(t)),
  renderAll() { }
};

let pets = [];
VTF.load(ctx, '../js/core/config.js');
VTF.load(ctx, '../js/core/tutorial_mode.js');

(async () => {
  const TM = ctx.TutorialMode;
  if (!TM || typeof TM.useExpPack !== 'function') {
    console.error('FAIL: TutorialMode.useExpPack 不存在（经验包使用的唯一入口）');
    process.exit(1);
  }

  /* ---- ① 已建档的宠：必须 updatePet 写等级+经验，绝不能 INSERT ---- */
  pets = [{ id: 'p1', name: '腐噜兽', level: 5, exp: 0, cloudId: 'c-1' }];
  cloud.length = 0;
  let r = await TM.useExpPack('残魂经验囊');
  A(r && r.ok, '使用残魂经验囊成功（返回 ok）');
  A(pets[0].level === 6 && pets[0].exp === 400,
    '本地经验生效（Lv5→Lv6、余 400；实际 Lv.' + pets[0].level + ' exp' + pets[0].exp + '）');
  const upd = cloud.filter(c => c.kind === 'update');
  A(upd.length === 1, '等级/经验写了一次云端（updatePet；实际 ' + upd.length + ' 次）');
  A(upd.length === 1 && upd[0].id === 'c-1', '写的是这只宠自己的 cloudId（c-1）');
  A(upd.length === 1 && upd[0].patch.level === 6 && upd[0].patch.exp === 400,
    '写入的 level/exp 就是吃包后的值（level=' + (upd[0] && upd[0].patch.level) + ' exp=' + (upd[0] && upd[0].patch.exp) + '）');
  A(!cloud.some(c => c.kind === 'insert'),
    '已建档的宠没有走 savePet（INSERT 会复制出重复宠 —— 2026-09-08 血泪）');
  A(r && r.saved === true, '返回值带 saved=true（调用方可据此提示）');

  /* ---- ② 没 cloudId 的宠（建档失败过）：必须建档，不能什么都不写 ---- */
  pets = [{ id: 'p2', name: '腐噜兽', level: 5, exp: 0 }];
  cloud.length = 0;
  r = await TM.useExpPack('残魂经验囊');
  const ins = cloud.filter(c => c.kind === 'insert');
  A(ins.length === 1, '无 cloudId 的宠走 savePet 建档（实际 ' + ins.length + ' 次）');
  A(pets[0].cloudId === 'new-cloud-1', '建档后回填 cloudId（下次就不会再 INSERT）');

  /* ---- ③ 云端写失败：必须吭声，不能静默（包已在服务端扣掉） ---- */
  pets = [{ id: 'p3', name: '腐噜兽', level: 5, exp: 0, cloudId: 'c-3' }];
  cloud.length = 0; logs.length = 0;
  ctx.Supabase.updatePet = async () => ({ error: { message: '网络炸了' } });
  r = await TM.useExpPack('残魂经验囊');
  A(r && r.ok, '云端失败不影响本地生效（等级照涨）');
  A(r && r.saved === false, '返回值带 saved=false');
  A(logs.some(t => /存档失败/.test(t)), '云端写失败时明确提示玩家（不是静默）');

  /* ---- ④ 材料都没扣成功就别改等级（spend 失败 → 不能白送经验） ---- */
  ctx.Supabase.updatePet = async (id, patch) => { cloud.push({ kind: 'update', id, patch }); return {}; };
  pets = [{ id: 'p4', name: '腐噜兽', level: 5, exp: 0, cloudId: 'c-4' }];
  cloud.length = 0;
  spendOk = false;
  r = await TM.useExpPack('残魂经验囊');
  A(r && !r.ok, '扣包失败 → 使用失败（不会白送经验）');
  A(pets[0].level === 5 && !cloud.length, '扣包失败时不改等级、不写云端');
  spendOk = true;

  console.log(failures ? `\nFAILURES: ${failures}` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();
