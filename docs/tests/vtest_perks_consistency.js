// vtest_perks_consistency.js —— 商店权益的一致性守值（2026-09-20）
//
// 为什么单独一个测试：上架一件商品要同时改四处 ——
//   ① 迁移 SQL（商品行 + CHECK 上限 + 服务端白名单）
//   ② config.js（Config.capacity 档位 / Config.shop.nameTags 名牌档）
//   ③ ui-shop.js（PERK_LABEL 权益文案）
//   ④ game.css（名牌的样式类）
// 这四处谁也不会自动跟着谁变，靠人记必然漏。**已经漏过一次**：
//   线上 products 里早有背包/育兽栏扩建商品，但迁移脚本里没有（库有脚本无），
//   重建库就会缺东西。本测试把那次的教训钉成断言。
//
// 纯静态解析（读文件 + 正则），不需要假装登录，跑得很快。
const fs = require('fs'), vm = require('vm');
const VTF = require('./vtest_files');
let failures = 0;
const A = (ok, msg) => { if (ok) console.log('PASS: ' + msg); else { console.error('FAIL: ' + msg); failures++; } };

/* ---- 读源 ---- */
const supaDir = '../../supabase';
const sqlAll = fs.readdirSync(supaDir).filter(f => /^migrate_shop.*\.sql$/i.test(f))
  .map(f => fs.readFileSync(supaDir + '/' + f, 'utf8')).join('\n');
const shopJs = fs.readFileSync('../js/ui/ui-shop.js', 'utf8');
const css = fs.readFileSync('../css/game.css', 'utf8');
const ctx = { console }; ctx.window = ctx; vm.createContext(ctx);
VTF.load(ctx, '../js/core/config.js');
const Config = ctx.Config;

/* ---- 解析迁移脚本里的商品行 ----
 * ⚠️ 历史上有**两种写法**，都要认（改 SQL 写法时记得回来同步这里，否则断言会静默变成"0 条"）：
 *   ① 字面量 values：('sku', '标题', 'convenience', 50, 5, '{"perks":{...}}', '<img…>', 10, true)
 *      —— migrate_shop.sql（充值档位）/ migrate_shop_perks.sql
 *   ② select … from (values …)：('sku', '标题', 50, 5, '{"perks":{...}}', 'ic_bag', 10)
 *      —— migrate_shop_perks2.sql（本批；kind 与 icon 在 select 里生成，所以元组里没有它们） */
const rowsBySku = {};
let m;
const reLiteral = /\(\s*'([a-z0-9_]+)'\s*,\s*'([^']*)'\s*,\s*'(convenience|recharge)'\s*,\s*(\d+|null)\s*,\s*(\d+|null)\s*,\s*'([^']*)'\s*,/gi;
while ((m = reLiteral.exec(sqlAll))) {
  let payload = {};
  try { payload = JSON.parse(m[6]); } catch (e) { /* 非 JSON payload（充值档位是 {}）跳过 */ }
  rowsBySku[m[1]] = {
    sku: m[1], title: m[2], kind: m[3],
    price: m[4] === 'null' ? null : Number(m[4]),
    limit: m[5] === 'null' ? null : Number(m[5]),
    payload
  };
}
const reTuple = /\(\s*'([a-z0-9_]+)'\s*,\s*'([^']*)'\s*,\s*(\d+)\s*,\s*(\d+|null)\s*,\s*'(\{[\s\S]*?\})'\s*,\s*'([a-z_]+)'\s*,\s*(\d+)\s*\)/g;
while ((m = reTuple.exec(sqlAll))) {
  let payload = {};
  try { payload = JSON.parse(m[5]); } catch (e) { payload = {}; }
  // 后出现的写法覆盖前面的（新脚本是幂等 upsert，以它为准）
  rowsBySku[m[1]] = {
    sku: m[1], title: m[2], kind: 'convenience',
    price: Number(m[3]), limit: m[4] === 'null' ? null : Number(m[4]),
    payload
  };
}
const rows = Object.values(rowsBySku);
A(rows.length >= 9, 'SQL 里解析到商品行 ' + rows.length + ' 条（商店本批应为 9 件便利商品 + 充值档位）');

const goods = rows.filter(r => r.kind === 'convenience');
const perkRows = goods.filter(r => r.payload.perks);
const bundleRows = perkRows.filter(r => Object.keys(r.payload.perks).length > 1);
const soloRows = perkRows.filter(r => Object.keys(r.payload.perks).length === 1);
const tagRows = goods.filter(r => r.payload.cosmetics);
A(perkRows.length >= 5, '权益类商品 ' + perkRows.length + ' 件（含礼包）');
A(tagRows.length >= 4, '名牌类商品 ' + tagRows.length + ' 档');

/* ---- ① 权益键必须有文案：PERK_LABEL 是唯一处 ---- */
const pelM = shopJs.match(/const PERK_LABEL\s*=\s*\{([\s\S]*?)\};/);
A(!!pelM, '能在 ui-shop.js 定位 PERK_LABEL（改了写法请同步本断言）');
const labels = pelM ? pelM[1] : '';
for (const key of [...new Set(perkRows.flatMap(r => Object.keys(r.payload.perks)))]) {
  A(new RegExp('\\b' + key + '\\s*:').test(labels), '权益键 ' + key + ' 在 PERK_LABEL 里有文案（否则卡片显示 undefined）');
}
/* 每个档位必须是正数：写 0 等于花了钱什么都没发 */
for (const r of perkRows) {
  for (const [k, v] of Object.entries(r.payload.perks)) {
    A(Number(v) > 0, r.sku + ' 的 ' + k + ' 档位为正数（' + v + '）');
  }
}

/* ---- ② 名牌：config / CSS / 服务端白名单三处 key 必须一致 ---- */
const tagDefs = Object.keys((Config.shop && Config.shop.nameTags) || {});
A(tagDefs.length === tagRows.length,
  'config.shop.nameTags 档数(' + tagDefs.length + ')与 SQL 商品数(' + tagRows.length + ')一致');
const wlM = sqlAll.match(/not in \(([^)]*'jade'[^)]*)\)/);
const wlKeys = wlM ? (wlM[1].match(/'([a-z_]+)'/g) || []).map(s => s.replace(/'/g, '')) : [];
A(wlKeys.length > 0, '能在 SQL 里定位 spend_gems 的名牌白名单');
for (const r of tagRows) {
  const key = r.payload.cosmetics.unlock_tag;
  A(tagDefs.indexOf(key) >= 0, '名牌 ' + r.sku + ' 的 key「' + key + '」在 Config.shop.nameTags 里');
  A(new RegExp('\\.name-tag--' + key + '\\b').test(css), '名牌 key「' + key + '」在 game.css 里有样式类');
  A(wlKeys.indexOf(key) >= 0, '名牌 key「' + key + '」在 spend_gems 的服务端白名单里（不在的话发货时 raise exception、整单回滚）');
  // 名牌不设限购：重复购买由服务端返回 owned 挡住，这样玩家看到的是「已拥有」而不是「已达上限」
  A(r.limit === null, r.sku + ' 不设 limit_per_user（重复购买交给服务端的 owned 判断）');
}

/* ---- ③ 扩容档位 ↔ Config.capacity 必须逐字一致 ---- */
const cap = Config.capacity || {};
function soloOf(slotKey) { return soloRows.find(r => Object.prototype.hasOwnProperty.call(r.payload.perks, slotKey)); }
const bagSolo = soloOf('inventory_slots'), petSolo = soloOf('pet_slots');
A(!!bagSolo, '找得到背包扩建商品');
A(!!petSolo, '找得到育兽栏扩建商品');
if (bagSolo && cap.bag) {
  A(bagSolo.payload.perks.inventory_slots === cap.bag.step,
    '背包扩建一次 +' + bagSolo.payload.perks.inventory_slots + ' 与 Config.capacity.bag.step(' + cap.bag.step + ') 一致');
  A(bagSolo.limit === cap.bag.maxBuy, '背包扩建限购 ' + bagSolo.limit + ' 次与 maxBuy(' + cap.bag.maxBuy + ') 一致');
}
if (petSolo && cap.pet) {
  A(petSolo.payload.perks.pet_slots === cap.pet.step,
    '育兽栏扩建一次 +' + petSolo.payload.perks.pet_slots + ' 与 Config.capacity.pet.step(' + cap.pet.step + ') 一致');
  A(petSolo.limit === cap.pet.maxBuy, '育兽栏扩建限购 ' + petSolo.limit + ' 次与 maxBuy(' + cap.pet.maxBuy + ') 一致');
}

/* ---- ④ CHECK 上限 ≥「单买买满 + 礼包买满」----
 * 不够大 = 玩家买满之后，礼包那一单会在写库时抛异常、整单回滚
 * （钱会退回，但玩家看到的是"买不了"，属于我们自己配置错的锅）。 */
const checkOf = col => {
  const mm = sqlAll.match(new RegExp(col + '\\s*<=\\s*(\\d+)'));
  return mm ? Number(mm[1]) : null;
};
const needOf = key =>
  soloRows.reduce((s, r) => s + Number(r.payload.perks[key] || 0) * (r.limit || 0), 0)
  + bundleRows.reduce((s, r) => s + Number(r.payload.perks[key] || 0), 0);
const bagCheck = checkOf('inventory_slots'), petCheck = checkOf('pet_slots');
A(bagCheck !== null && bagCheck >= needOf('inventory_slots'),
  'inventory_slots 的 CHECK 上限 ' + bagCheck + ' ≥ 全买满 ' + needOf('inventory_slots'));
A(petCheck !== null && petCheck >= needOf('pet_slots'),
  'pet_slots 的 CHECK 上限 ' + petCheck + ' ≥ 全买满 ' + needOf('pet_slots'));

/* ---- ⑤ 礼包必须真的比单买便宜（否则礼包没意义，玩家会骂） ---- */
for (const r of bundleRows) {
  const soloPrice = Object.entries(r.payload.perks).reduce((s, [k, v]) => {
    const unit = soloOf(k);
    return s + (unit ? unit.price * Number(v) / Number(unit.payload.perks[k]) : 0);
  }, 0);
  A(r.price < soloPrice, r.sku + ' 打包价 ' + r.price + ' 低于单买价 ' + soloPrice);
}

/* ---- ⑦ 商品图标：必须是 assets/ui 的水墨 PNG，⛔ 不许 emoji ----
 * 用户 2026-09-20 点名：「为什么还是用 emoji 占位，真的太廉价了」。
 * 两条断言各挡一类问题：
 *   (a) 图标文件真实存在 —— 名字写错**不会报错**，只会在商店里显示成破图；
 *   (b) 没有 emoji —— emoji 是彩色位图，跟水墨牌匾风格打架，换字体/换平台还会变形。 */
const iconNames = [...new Set((sqlAll.match(/'ic_[a-z_]+'/g) || []).map(s => s.slice(1, -1)))];
A(iconNames.length >= 8, 'SQL 里解析到商店图标引用 ' + iconNames.length + ' 个');
for (const n of iconNames) {
  A(fs.existsSync('../assets/ui/' + n + '.png'), '图标文件存在：assets/ui/' + n + '.png');
}
// 前端桩数据（vtest_shop.js 用的是 ic('xxx') 写法）里的图标名同样要存在
const stubSrc = fs.readFileSync('vtest_shop.js', 'utf8');
const stubNames = [...new Set((stubSrc.match(/ic\('([a-z_]+)'\)/g) || []).map(s => s.slice(4, -2)))];
for (const n of stubNames) {
  A(fs.existsSync('../assets/ui/' + n + '.png'), 'vtest_shop 桩数据的图标存在：assets/ui/' + n + '.png');
}
const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;
const badIcon = [];
for (const line of sqlAll.split(/\r?\n/)) {
  if (/'convenience'/.test(line) && emojiRe.test(line)) badIcon.push(line.trim().slice(0, 70));
}
A(badIcon.length === 0, '商店商品没有用 emoji 当图标：' + (badIcon.join(' | ') || '无'));

/* ---- ⑥ 不许出现「卖数值」的商品（2026-09-12 定调，全项目反复强调） ---- */
const bad = [];
for (const f of fs.readdirSync(supaDir).filter(x => /^migrate_shop.*\.sql$/i.test(x))) {
  fs.readFileSync(supaDir + '/' + f, 'utf8').split(/\r?\n/).forEach(line => {
    if (/'convenience'/.test(line) && /"materials"\s*:/.test(line)) bad.push(f + ' → ' + line.trim().slice(0, 70));
  });
}
A(bad.length === 0, '商店里没有卖数值的商品（convenience + payload.materials）：' + (bad.join(' | ') || '无'));

console.log(failures ? 'PERKS CONSISTENCY FAILED: ' + failures : 'ALL PERKS CONSISTENCY TESTS PASSED');
process.exit(failures ? 1 : 0);
