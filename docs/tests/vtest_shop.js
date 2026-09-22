// vtest_shop.js —— 魔石充值（卡密）+ 商店消费 专项自测
// 覆盖：余额读取 / 卡密兑换（成功·重复·无效）/ 魔石购买并发材料 / 余额不足 / 充值档位不进商店 / 未开通提示
const fs=require('fs'),vm=require('vm');
const VTF=require('./vtest_files');
const mem=(()=>{const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}})();
function el(){return{setAttribute(){},removeAttribute(){},getAttribute:()=>null,textContent:'',innerHTML:'',style:{setProperty(){}},classList:{add(){},remove(){},toggle(){},contains(){return false}},dataset:{},appendChild(){},append(){},addEventListener(t,f){this.handlers=this.handlers||{};this.handlers[t]=f},querySelector:()=>el(),querySelectorAll:()=>[],children:[],remove(){},scrollTop:0,scrollHeight:0,disabled:false,value:''}}
const els={};
const ctx={console,setTimeout,clearTimeout,setInterval,clearInterval,fetch:global.fetch,URL,URLSearchParams,TextEncoder,TextDecoder,AbortController,Blob,FormData,Headers,Request,Response,ReadableStream,WritableStream,crypto:global.crypto,WebSocket:globalThis.WebSocket,navigator:{lock:undefined},location:{href:'http://x'},localStorage:mem,document:{getElementById:id=>els[id]||(els[id]=el()),createElement:()=>el(),querySelector:()=>el(),querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}},els,session:null,petsTable:[],itemsTable:[],listingsTable:[],itemListTable:[],materialsTable:[],petEggTable:[],walletsTable:[],productsTable:[],ordersTable:[],redeemTable:[],uidSeq:0,rpcCalls:[],delCalls:[]};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../js/vendor/supabase.min.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('vstub.js','utf8'),ctx);
for(const f of ['../js/core/config.js','../js/core/supabase.js','../js/equipment/equipment.js','../js/pet/pet.js','../js/core/items.js','../js/core/materials.js','../js/core/drop.js','../js/core/market.js','../js/equipment/equipment_craft.js','../js/equipment/salvage.js','../js/pet/pet_merge.js','../js/pet/pet_evolve.js','../js/core/battle.js','../js/ui/ui-common.js','../js/ui/ui-shell.js','../js/ui/ui-login.js','../js/ui/ui-dialog.js','../js/ui/ui-popover.js','../js/ui/battle/index.js','../js/ui/battle/tip.js','../js/ui/battle/stage-fx.js','../js/ui/battle/loot.js','../js/ui/battle/act.js','../js/ui/battle/roster.js','../js/ui/battle/summary.js','../js/ui/ui-pet.js','../js/ui/ui-pet-evolve.js','../js/ui/ui-pet-merge.js','../js/ui/ui-pet-synth.js','../js/ui/ui-bag.js','../js/ui/ui-equipment.js','../js/ui/ui-craft.js','../js/ui/ui-market.js','../js/ui/ui-market-sell.js','../js/ui/ui-market-records.js','../js/ui/ui-shop.js','../js/main.js'])VTF.load(ctx,f);
let failures=0;const A=(ok,msg)=>{if(ok)console.log('PASS: '+msg);else{console.error('FAIL: '+msg);failures++}};const C=code=>vm.runInContext(code,ctx);const S=ms=>new Promise(r=>setTimeout(r,ms));

/* 商品按【真实服务端现状】摆放，不是按 migrate_shop.sql 的初始数据。
 * ⚠️ 2026-09-12 起商店只卖便利、不卖数值：涅磐兽 / 传说进化素材 / 凝魂晶石 / 宠物蛋 / 打造石礼包
 *    五个 materials 类商品已全部下架（见 migrate_shop_perks.sql），只留 perks 类。
 *    桩数据必须与真实 products 表同步，否则「测试全绿、线上对不上」——这次就是这么漂的。 */
/* 商品图标：一律用 assets/ui 的水墨 PNG，**不用 emoji**（emoji 是彩色位图，跟水墨牌匾风格打架，
 * 且换字体/换平台会变形；用户 2026-09-20 点名「为什么还是用 emoji 占位，真的太廉价了」）。
 * 下面这个 ic() 与迁移脚本里拼串的写法等价，两边必须同源。 */
C(`const ic = n => '<img class="mat-img" src="assets/ui/' + n + '.png" alt="">'`);
C(`productsTable.push(
  {sku:'gems_60',title:'小袋魔石',kind:'recharge',price_cents:600,price_gems:null,gems:60,bonus_gems:6,payload:{},icon:ic('ic_gem'),active:true,sort:1},
  {sku:'perk_bag_50',title:'背包扩建 +50 格',kind:'convenience',price_cents:null,price_gems:50,gems:0,bonus_gems:0,payload:{perks:{inventory_slots:50}},icon:ic('ic_bag'),active:true,sort:10,limit_per_user:5},
  {sku:'perk_pet_5',title:'育兽栏扩建 +5 位',kind:'convenience',price_cents:null,price_gems:50,gems:0,bonus_gems:0,payload:{perks:{pet_slots:5}},icon:ic('ic_egg'),active:true,sort:11,limit_per_user:4},
  {sku:'perk_listing_5',title:'市场挂单额度 +5',kind:'convenience',price_cents:null,price_gems:20,gems:0,bonus_gems:0,payload:{perks:{listing_slots:5}},icon:ic('ic_stall'),active:true,sort:12,limit_per_user:2},
  {sku:'bundle_traveler',title:'旅者行囊',kind:'convenience',price_cents:null,price_gems:85,gems:0,bonus_gems:0,payload:{perks:{inventory_slots:50,pet_slots:5}},icon:ic('ic_box'),active:true,sort:20,limit_per_user:1},
  {sku:'bundle_pioneer',title:'拓荒者行囊',kind:'convenience',price_cents:null,price_gems:170,gems:0,bonus_gems:0,payload:{perks:{inventory_slots:100,pet_slots:10}},icon:ic('ic_crown'),active:true,sort:21,limit_per_user:1},
  {sku:'tag_jade',title:'青玉名牌',kind:'convenience',price_cents:null,price_gems:15,gems:0,bonus_gems:0,payload:{cosmetics:{unlock_tag:'jade'}},icon:ic('ic_mat_souljade'),active:true,sort:30,limit_per_user:null},
  {sku:'tag_violet',title:'幽紫名牌',kind:'convenience',price_cents:null,price_gems:30,gems:0,bonus_gems:0,payload:{cosmetics:{unlock_tag:'violet'}},icon:ic('ic_rune'),active:true,sort:31,limit_per_user:null},
  {sku:'tag_gilded',title:'鎏金名牌',kind:'convenience',price_cents:null,price_gems:60,gems:0,bonus_gems:0,payload:{cosmetics:{unlock_tag:'gilded'}},icon:ic('ic_gem'),active:true,sort:32,limit_per_user:null},
  {sku:'tag_bloodmoon',title:'血月名牌',kind:'convenience',price_cents:null,price_gems:100,gems:0,bonus_gems:0,payload:{cosmetics:{unlock_tag:'bloodmoon'}},icon:ic('ic_mat_bloodcrystal'),active:true,sort:33,limit_per_user:null},
  {sku:'perk_pricey',title:'贵价便利品（测余额不足）',kind:'convenience',price_cents:null,price_gems:50,gems:0,bonus_gems:0,payload:{perks:{listing_slots:1}},icon:ic('ic_rune'),active:true,sort:40,limit_per_user:null}
)`);
C(`redeemTable.push({code:'SOUL-TEST-01',sku:'gems_60',max_uses:1,used_count:0,expires_at:null})`);
// 桩里没有 user_perks 表，给个本地兜底（真实环境由 get_my_perks RPC 提供五列：
// 三列容量 + name_tag 当前佩戴 + name_tags 已解锁集合，见 migrate_shop_perks2.sql）
C(`Supabase.getMyPerks=async()=>({listing_slots:0,inventory_slots:0,pet_slots:0,name_tag:null,name_tags:[]})`);
C(`Supabase.fetchPerksOf=async()=>({})`);

// Config.shop.enabled 已于 2026-09-12 打开（魔石=便利货币）。这里显式再写一次，
// 免得以后有人关掉开关时本测试静默失效。
C('Config.shop.enabled=true');

(async()=>{await S(300);await C('Game.onLogin("shop@test.com","123456")');await S(400);
// 建一只宠物，否则 onAuthenticated 提前返回，走不到商店数据加载
await C('(async()=>{const p=Pet.createPet("血狐","🦊",6,100,20,10,8);Pet.addPet(p);Pet.setActive(p.id);const s=await Supabase.savePet(p);p.cloudId=s.data.id})()');
await C('Game.onLogin("shop@test.com","123456")');await S(400);

A(C('UI.getGems()')===0,'初始余额 0 魔石');
A(C(`els['gem-balance'].innerHTML`).indexOf('0')>=0,'顶栏余额芯片已渲染：'+C(`els['gem-balance'].innerHTML`));
const root=C(`els['shop-root'].innerHTML`);
A(root.indexOf('市场挂单额度 +5')>=0,'商店页渲染出商品（服务端 products 表）');
A(root.indexOf('涅磐兽')<0&&root.indexOf('传说进化素材')<0&&root.indexOf('凝魂晶石')<0,
  '已下架的卖数值商品不再出现在商店（2026-09-12 定调：不卖数值）');
A(root.indexOf('小袋魔石')<0,'充值档位不出现在商店列表（自测阶段不发卡，不直接买）');
A(root.indexOf('自测阶段')>=0,'页头说明自测阶段不对外收费');
A(root.indexOf('收款码')<0&&root.indexOf('转账')<0&&root.indexOf('支付宝')<0,'界面不含任何收款码/转账引导（用户 2026-08-31 明令去掉）');
A(root.indexOf('魔石商店尚未开通')<0,'表存在时不显示「未开通」提示');

/* ---- 卡密兑换 ---- */
let r=await C(`Supabase.redeemCode('SOUL-TEST-01')`);
A(r.ok&&r.gained===66,'卡密兑换到账 60+6=66 魔石（实得 '+r.gained+'）');
await C('UI.refreshShop()');await S(120);
A(C('UI.getGems()')===66,'余额已刷新为 66');
r=await C(`Supabase.redeemCode('SOUL-TEST-01')`);
A(!r.ok&&r.code==='used','同一张卡密第二次兑换 → used（防重复到账）');
A(C('UI.getGems()')===66,'重复兑换不重复加币（仍 66）');
r=await C(`Supabase.redeemCode('NOT-EXIST')`);
A(!r.ok&&r.code==='notfound','无效卡密 → notfound');

/* ---- 魔石购买（perks 类：权益不进战斗数值） ---- */
r=await C(`Supabase.spendGems('perk_listing_5','ref-1')`);
A(r.ok,'魔石购买成功');
await C('UI.refreshShop()');await S(120);
A(C('UI.getGems()')===46,'购买后余额 66-20=46（实 '+C('UI.getGems()')+'）');
r=await C(`Supabase.spendGems('perk_listing_5','ref-1')`);
A(r.ok&&C('UI.getGems()')===46,'幂等键相同重复提交不再扣币（仍 46）');

/* ---- 限购必须「点之前就可见」 ----
 * 2026-09-12 事故：fetchProducts 的 select 漏了 limit_per_user，前端对限购一无所知，
 * 玩家只能点了才被服务端弹「已达购买上限」。这里守住「卡片上要显示还能买几次」。 */
let g=C(`els['shop-root'].innerHTML`);
A(g.indexOf('限购 2 次')>=0,'卡片显示限购次数（限购 2 次）');
A(g.indexOf('已买 1')>=0,'卡片显示已买 1 次');
A(g.indexOf('已达上限')<0,'未买满时不显示「已达上限」，按钮可点');

r=await C(`Supabase.spendGems('perk_listing_5','ref-2')`);
A(r.ok,'限购品第二次购买成功（限购 2）');
await C('UI.refreshShop()');await S(120);
g=C(`els['shop-root'].innerHTML`);
A(g.indexOf('已买 2')>=0,'买满后显示已买 2 次');
A(g.indexOf('已达上限')>=0,'买满后按钮显示「已达上限」并置灰');
r=await C(`Supabase.spendGems('perk_listing_5','ref-9')`);
A(!r.ok&&r.code==='limit','超出限购 → limit');

/* ---- 余额不足 ---- */
A(C('UI.getGems()')===26,'买两次后余额 66-40=26（实 '+C('UI.getGems()')+'）');
r=await C(`Supabase.spendGems('perk_pricey','ref-5')`);
A(!r.ok&&r.code==='insufficient','余额不足 → insufficient（26 < 50）');
A(C('UI.getGems()')===26,'扣款失败的订单不扣币（仍 26）');

/* ---- 三排货架 + 名牌三态（2026-09-20）----
 * 用户拍板：商店分三排（扩容 / 礼包 / 名牌）；名牌买下永久解锁、可自由切换。
 * 这一排也是"商店太空"的正解 —— 牌子是唯一能一直补货的品类。 */
g=C(`els['shop-root'].innerHTML`);
A(g.indexOf('shop-shelf-head')>=0,'商店按排渲染（有货架标题，不再是一片平铺）');
A(g.indexOf('扩容')>=0&&g.indexOf('礼包')>=0&&g.indexOf('名牌')>=0,'三排标题齐全：扩容 / 礼包 / 名牌');
A(g.indexOf('背包扩建 +50 格')>=0&&g.indexOf('育兽栏扩建 +5 位')>=0,
  '扩容商品在架（补上断链：游戏里「去商店扩建」的指引终于有货）');
A(g.indexOf('旅者行囊')>=0&&g.indexOf('拓荒者行囊')>=0,'礼包商品在架');
A(g.indexOf('青玉名牌')>=0&&g.indexOf('血月名牌')>=0,'名牌商品在架');
A(g.indexOf('背包装备位永久 +50')>=0,'权益文案读得到（PERK_LABEL 有对应键，不是显示 undefined）');

// 名牌三态①：未解锁 → 购买
A(g.indexOf('使用中')<0,'未解锁时不显示「使用中」');

// 名牌三态②：已解锁但没戴 → 使用
// ⚠️ 桩要打在 getPerksCache 上，不能打在 Supabase.getMyPerks 上：
//    refreshPerks 调的是它闭包里的 getMyPerks，替换导出的引用对它无效（改了也静默不生效）。
//    商店卡片读的正是 getPerksCache()，所以这个桩才是"真实数据来源"的替身。
C(`Supabase.getPerksCache=()=>({listing_slots:0,inventory_slots:0,pet_slots:0,name_tag:null,name_tags:['jade']})`);
await C('UI.refreshShop()');await S(120);
g=C(`els['shop-root'].innerHTML`);
A(g.indexOf('shop-use')>=0,'已解锁未佩戴 → 显示「使用」按钮');

// 名牌三态③：正在戴 → 使用中
C(`Supabase.getPerksCache=()=>({listing_slots:0,inventory_slots:0,pet_slots:0,name_tag:'jade',name_tags:['jade']})`);
await C('UI.refreshShop()');await S(120);
g=C(`els['shop-root'].innerHTML`);
A(g.indexOf('使用中')>=0,'当前佩戴 → 显示「使用中」');
A(g.indexOf('shop-tag-on')>=0,'「使用中」有专门样式类（灰掉的普通按钮会让人以为坏了）');

/* 🔴 名牌接口必须真的导出到 window.Supabase（2026-09-20 事故）：
 * 函数写在模块里、但忘了加进导出对象 ⇒ 两个都是 undefined，而且**失败是静默的**：
 *   · fetchPerksOf 被 `if (...)` 挡住 → 名字永远没颜色；
 *   · setMyNameTag 在 async 里抛 TypeError 被吞 → 点「使用」毫无反应。
 * 用户当时报的正是这两条。 */
A(typeof C('Supabase.fetchPerksOf')==='function','Supabase.fetchPerksOf 已导出（漏了=名牌静默失效）');
A(typeof C('Supabase.setMyNameTag')==='function','Supabase.setMyNameTag 已导出（漏了=点「使用」没反应）');
/* 换档后必须重绘聊天：名字颜色是渲染那一刻写死的，不重绘就变成「选了血月、名字还是金色」
 * （2026-09-20 用户报的「货不对板」—— 服务端其实早就切好了，是显示没跟上）。 */
/* ⚠️ 这两条只能静态查：ui-console.js 一加载就订阅 Realtime，而测试桩没有 client.channel
 * （会抛 TypeError: client.channel is not a function），所以**不能**把它加进上面的加载列表。 */
A(/UI\.repaintConsole\s*=/.test(fs.readFileSync('../js/ui/ui-console.js','utf8')),
  'ui-console 导出了 repaintConsole（换档后重绘聊天里的老消息）');
/* 🔴 聊天列表的名字必须走 UI.nameTag —— 2026-09-20 连踩两次：
 * 社交消息的名字是在 `chatMsgHtml()` 里拼的（不是 renderChatMessage 那份 html），
 * 只改 renderChatMessage 等于白改，用户在聊天里永远看不到名牌。 */
const consSrc = fs.readFileSync('../js/ui/ui-console.js','utf8');
A(/UI\.nameTag\(m\.name/.test(consSrc), 'chatMsgHtml 里聊天名字走 UI.nameTag（名牌要在这一层接）');
A(/uid: uid/.test(consSrc), 'structured 里存了 uid（名牌按 uid 查，不存就永远拿不到）');
A(/UI\.repaintConsole/.test(fs.readFileSync('../js/ui/ui-shop.js','utf8')),
  'ui-shop 换名牌后会调用 repaintConsole（否则老消息一直是旧颜色）');

/* 名牌渲染工具：未知 key 必须退回普通名字（脏数据 / 以后下架某档时，不能让整屏渲染崩掉） */
A(C(`UI.nameTag('老王','jade')`).indexOf('name-tag--jade')>=0,'UI.nameTag 给已知名牌挂类名');
A(C(`UI.nameTag('老王','nope')`)==='老王','UI.nameTag 对未知 key 退回纯名字');
A(C(`UI.nameTag('a<b','jade')`).indexOf('&lt;b')>=0,'UI.nameTag 负责转义（名字是玩家可控文本）');

/* ---- 表/函数缺失时不崩，给「未开通」提示 ---- */
C('Supabase.getMyWallet=async()=>({gems:0,totalRecharged:0,missing:true})');
await C('UI.refreshShop()');await S(120);
A(C(`els['shop-root'].innerHTML`).indexOf('魔石商店尚未开通')>=0,'表缺失时显示「未开通」提示而不是白屏/报错');
A(C(`els['gem-balance'].style.display`)==='none','未开通时顶栏余额芯片隐藏');
/* ============================================================
 * 静态守值：防止「前端显示」与「后端下发」再次脱节
 * ============================================================ */

/* 1. products 的 select 不得漏列 —— 漏列不报错，读回来是 undefined，静默失效 */
const supaSrc=fs.readFileSync('../js/core/supabase.js','utf8');
const selM=supaSrc.match(/from\('products'\)\s*\.\s*select\('([^']+)'\)/);
A(!!selM,'能在 supabase.js 定位 products 的 select（改了写法请同步本断言）');
if(selM){
  const cols=selM[1].split(',').map(s=>s.trim());
  // 前端渲染 / 限购判断要用的列，缺一个就是显示缺失
  for(const need of ['sku','title','kind','price_gems','payload','icon','limit_per_user'])
    A(cols.indexOf(need)>=0,'products select 含 '+need+'（缺了前端读不到，且不会报错）');
}

/* 2. 不许再新增「卖数值」的商品：convenience + payload.materials */
const supaDir='../../supabase'; // 迁移脚本在仓库根，不在 docs 下
const shopSqls=fs.readdirSync(supaDir).filter(f=>/^migrate_shop.*\.sql$/i.test(f));
A(shopSqls.length>0,'找得到商店迁移脚本：'+shopSqls.join(','));
const bad=[];
for(const f of shopSqls){
  fs.readFileSync(supaDir+'/'+f,'utf8').split(/\r?\n/).forEach(line=>{
    if(/'convenience'/.test(line)&&/"materials"\s*:/.test(line)) bad.push(f+' → '+line.trim().slice(0,70));
  });
}
A(bad.length===0,'SQL 中没有新增卖数值商品（convenience+materials）。有则说明违反「不卖数值」定调：'+(bad.join(' | ')||'无'));

console.log(failures?'SHOP TESTS FAILED: '+failures:'ALL SHOP TESTS PASSED');process.exit(failures?1:0)
})().catch(e=>{console.error('EXC',e&&(e.stack||e.message));process.exit(1)});
