/* ============================================================
 * core/server-config.js —— 服务端全局配置同步（第一个开关：市场机器人总开关）
 * 职责：
 *  1. 登录时读一次服务端配置（game_config_overrides 单例表），之后每 60 秒跟一次
 *  2. 服务端说「机器人关」→ 停补货、停收购、清掉市场上所有流浪商人的假货
 *  3. 管理员写的开关落在服务器上：全员生效、刷新不丢（旧开关只改本机内存，刷新就复原）
 *
 * 设计取舍（别改坏）：
 *  · 读不到配置 → **不动本地**。网络抖一下就把机器人停了，比"晚 60 秒生效"严重得多。
 *  · 服务端没设过 bot.enabled → 沿用 config.js 的默认值，不越权替策划做决定。
 *  · 关 = stop + 清假单；开 = start。真实玩家的挂单全程不碰（它们落在库里）。
 *
 * 依赖：config.js / supabase.js / market.js / market_bot.js（都必须在它之前加载）
 * ============================================================ */
(function () {
  'use strict';

  const POLL_MS = 60000;   // 60 秒跟一次：管理员改完，在线玩家 1 分钟内生效
  let cfg = null;          // 服务端配置快照
  let applied = null;      // 已应用到本地的机器人开关（null = 还没应用过）
  let timer = null;
  let running = false;

  // 服务端有没有明确设置过机器人开关（没设过 = null，本地说了算）
  function serverBotEnabled() {
    if (!cfg || !cfg.bot) return null;
    return typeof cfg.bot.enabled === 'boolean' ? cfg.bot.enabled : null;
  }

  function applyBotSwitch(on) {
    const Config = window.Config;
    if (Config && Config.marketBot) Config.marketBot.enabled = !!on;
    const MB = window.MarketBot;
    if (on) {
      if (MB && MB.start) MB.start();
    } else {
      if (MB && MB.stop) MB.stop();
      // 机器人下了班，摊位上的假货也得撤 —— 不然市场看着还有货，点下去走的还是机器人
      if (window.Market && window.Market.clearBotListings) window.Market.clearBotListings();
      if (window.UI && window.UI.renderAll) window.UI.renderAll();
    }
  }

  async function sync() {
    const S = window.Supabase;
    if (!S || !S.loadServerConfig) return cfg;
    const remote = await S.loadServerConfig();
    if (remote) cfg = remote;                 // 读失败保持旧快照，不擅自改状态
    const want = serverBotEnabled();
    if (want !== null && want !== applied) {
      applied = want;
      applyBotSwitch(want);
    }
    return cfg;
  }

  function start() {
    if (running) return;
    running = true;
    // 先拉一次再启动机器人：否则会先按本地默认值跑起来，60 秒后才被服务端按停，多出一轮假收购
    sync();
    if (timer) clearInterval(timer);
    timer = setInterval(sync, POLL_MS);
  }

  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
  }

  /* ---------- 管理员：把开关写到服务器 ---------- */
  async function setBotEnabled(on) {
    const S = window.Supabase;
    if (!S || !S.saveServerConfig) return { ok: false, error: '未登录或数据层未就绪' };
    const next = Object.assign({}, cfg || {}, {
      bot: Object.assign({}, (cfg && cfg.bot) || {}, { enabled: !!on })
    });
    const res = await S.saveServerConfig(next);
    if (!res || res.ok === false) return res || { ok: false, error: '写入失败' };
    cfg = next;
    applied = !!on;
    applyBotSwitch(!!on);
    return { ok: true };
  }

  window.ServerConfig = {
    start, stop, sync, setBotEnabled,
    get: () => cfg,
    // 当前机器人到底开没开：服务端设过就听服务端的，没设过听本地配置
    isBotEnabled: () => {
      const s = serverBotEnabled();
      if (s !== null) return s;
      return !!(window.Config && window.Config.marketBot && window.Config.marketBot.enabled);
    },
    // 是不是被服务器接管了（开发者面板用来提示"这项由服务器控制"）
    isServerControlled: () => serverBotEnabled() !== null
  };
})();
