// ==UserScript==
// @name         DLS — 默认锁设置
// @name:zh-CN   DLS — 默认锁设置
// @namespace    dls
// @version      0.1.0
// @description  Bondage Club (R132) default lock settings: timer-lock default duration (owner/lovers separately) / password-lock default password & hint / combination lock / precise hh:mm:ss box inside the original lock UI
// @description:zh-CN  Bondage Club（R132）默认锁设置：计时锁默认时长（主人锁/恋人锁分开）、密码锁默认密码与提示语、组合锁、原版锁界面里的精确时长输入框
// @author       Asresia(Dr)23575
// @license      MIT
// @match        *://*/BondageClub/*
// @match        *://*/*/BondageClub/*
// @match        *://*/*/*/BondageClub/*
// @include      *BondageClub*
// @run-at       document-start
// @grant        none
// @noframes
// @updateURL    https://raw.githubusercontent.com/Asresia/Default-Lock-Setting/main/DLS.user.js
// @downloadURL  https://raw.githubusercontent.com/Asresia/Default-Lock-Setting/main/DLS.user.js
// ==/UserScript==

/* ============================================================================
 * 用户脚本环境适配说明（Tampermonkey / Violentmonkey）
 * ----------------------------------------------------------------------------
 * · @grant none 是**必须**的：只有 none 才在**页面上下文**运行、能直接摸到游戏全局
 *   （bcModSdk / ChatRoom / Player / 那些 const 词法全局…）。设了任何 GM_* 权限，
 *   脚本会被管理器的沙箱隔离、这些全局全都看不到，功能等于全废。
 *   ⇒ 所以本脚本**刻意不使用** GM_setValue / GM_registerMenuCommand 等；
 *     配置走 localStorage（与页面同源，控制台粘贴方式也通用）。
 * · @run-at document-start 也是必须的：钩子要在游戏初始化前就位。
 *   但那时游戏符号**都还不存在** ⇒ 一切靠"轮询补挂"（tick() 每 1.5 秒试一次）。
 * · @noframes：游戏在顶层窗口运行，避免在别处的 iframe 里被误注入。
 * · @include *BondageClub* 是 @match 的兜底：带非标准端口或更深层路径的部署也能匹配。
 * · 同一个脚本可能被**注入两次**（既装了脚本、又在控制台粘贴过一次；或更新后重新注入）
 *   ⇒ 启动时会**先卸载旧实例**（killPreviousInstance()），避免两份实例各自挂钩子、
 *     各自建悬浮条。诊断接口：`__DLS.replacedPrevious`（本次启动是否卸载了旧实例）。
 * ========================================================================== */

/* ============================================================================
 * M1 骨架 + A1（锁的默认值）
 * ----------------------------------------------------------------------------
 * 设计依据（全部来自 R132 的真实源码，见 refs/bc/）：
 *
 * 1) 计时锁的"时长"是**单位 + 数值**选择器，不是文本框：
 *      OwnerTimerChooseOptions    = [{unit:{label:'Minutes',seconds:60}, values:[5,10,...]}, ...]
 *      OwnerTimerChooseOptionsIndex = 1        // 当前单位（默认 Hours）
 *      OwnerTimerChooseIndexes      = [0,0,0]  // 各单位下选中的数值下标
 *    这些是模块级 `let`，游戏**从不重置**（只有玩家点击才改）。
 *    → 所以"默认时长"= 写一次这两个变量；**绝不能每帧强设**，否则玩家点不动。
 *    → 而且它们是 `const`/`let` 声明的全局，**不在 window 上**，读写必须走全局 eval。
 *
 * 2) 密码锁才有真实输入框，且只在第一次设置时创建：
 *      InventoryItemMiscPasswordPadlockLoadHook 里 ElementCreateInput("SetPassword","text","","8")
 *      另外还有 SetHint（提示语）、Password（解锁时输入的框）
 *    输入框内容用游戏自己的 ElementValue(id, value) 设置（它还会派发 input 事件）。
 *    密码规则（源码里的一手证据）：/^[A-Z]+$/ 且最长为 8。
 *
 * 3) ★ 挂钩必须挂**不带 Hook 后缀**的名字：
 *      ExtendedItemCreateCallback 把 `globalThis[prefix+'Load'] = (...a) => scriptHook(...)`，
 *      其中 scriptHook 是对 `…LoadHook` 的**直接引用**（闭包捕获）。
 *      游戏调用时走 CommonCallFunctionByNameWarn → 调用瞬间才查 globalThis。
 *      ⇒ 挂 `…Load` 能拦住；挂 `…LoadHook` 会漏。
 *
 * 4) 锁的界面脚本是**按需加载**的 → 必须轮询等待，出现后再挂钩/应用。
 *
 * 安全：只读游戏状态 + 改两个选择器变量 + 预填输入框。不发任何网络请求。
 * ==========================================================================*/
(function () {
  'use strict';

  const VERSION = '0.1.0';
  /* ★ 每次改动都递增这个标记：用来确认你贴进游戏的到底是哪一版
     （日志第一行会带它，控制台也能 __DLS.build 查）。
     "改了但没生效"最常见的原因就是贴了旧版。 */
  const BUILD = 'b51';
  const TAG = '[DLS]';
  const MOD_NAME = 'DLS';
  const MOD_FULLNAME = 'DLS — Default Lock Settings';
  const STORE_KEY = 'dls:settings:v1';
  /* 改名（BCA → DLS）前的旧存储键。读不到新键时回退到它 ——
     否则改名会让用户已经配好的默认密码/时长"凭空变空"。 */
  const LEGACY_STORE_KEY = 'bcaddons:settings:v1';

  /* ========================== 设置 ========================== */

  const DEFAULT_SETTINGS = {
    enabled: true,
    timerDefaults: {
      // 单位只能是 Minutes / Hours / Days；数值必须落在该单位提供的 values 里
      owner: { unit: 'Days', value: 1 },          // OwnerTimerChooseOptions
      mistress: { unit: 'Hours', value: 2 },      // MistressTimerChooseOptions
      passwordTimer: { unit: 'Hours', value: 1 }, // PasswordTimerChooseOptions
      /* ★ 恋人锁的"选择器增量"单独一份。游戏里它与主人锁**共用**同一组全局变量
         （OwnerTimerChooseOptions / …Index / …Indexes），所以用户要的"两套默认"
         只能靠**打开或上锁那一刻按锁型分别写入**来实现（见 applyChooserForLock）。 */
      lovers: { unit: 'Hours', value: 2 },
      /* ★ 主人锁 / 恋人锁各自的**初始时长**（其余计时锁用 initial 那套全局值）。
         这个是普通属性、不共用变量，天生可以分开。 */
      initialByLock: {
        OwnerTimerPadlock: { unit: 'Days', value: 1 },
        LoversTimerPadlock: { unit: 'Hours', value: 2 },
      },
      /* ★ 这一项才是"计时锁的默认时长"：
         游戏施加计时锁时会把剩余时间设成**锁资产自己的 RemoveTimer 秒数**
         （Inventory.js:1485 → Timer.js:166 TimerInventoryRemoveSet），
         Mistress 那个正好是 300 秒 = 5 分钟。下面这项会把它改成你要的值。 */
      initial: {
        enabled: true,
        /* 用户要求："改别人的别用默认，用手动输的" ——
           true = 只有"上锁对象是**你自己**"时才自动套默认值；
                  改别人身上的锁请用原版锁界面里的 DLS 输入框手动填。 */
        onlySelf: false,        // 同 password.onlySelf：默认对所有人都套默认值
        unit: 'Hours',
        value: 1,
        /* ★ 原版功能：计时锁界面上那个「计时结束时移除物品」勾选框。
           对应 `Property.RemoveItem`（TimerPadlock.js:25 画、:46 切换；
           实际移除在 Timer.js:106/117-119）。上锁时直接写成这个布尔值。 */
        removeItem: false,
      },
    },
    /* 嵌在**原版锁界面**里的 hh:mm:ss 输入框与「DLS 应用」按钮的位置。
       坐标是游戏画布坐标（2000×1000）：
         · ElementPosition 以 (cx, cy) 为**中心**（Element.js:914-915）
         · DrawButton / MouseIn 以 (bx, by) 为**左上角**
       计时锁界面既有控件占据 y=425..980，所以默认放在上方空档 cy=330。
       如果和别的界面元素重叠，改这几个数即可（或告诉我调）。 */
    lockBox: { enabled: true, cx: 1260, cy: 330, w: 320, bw: 180, bh: 56 },
    ui: true,                       // 是否显示右下角的悬浮控件
    /* ★ 用户要求：悬浮条可拖动（避免遮挡）。null = 默认停靠右下角；
       拖动后记这里（画布/DOM 像素坐标，左上角），刷新后仍在。 */
    uiPos: null,
    /* 右上角"返回/退出"图标按钮的边长（px）。游戏用 CSS 决定真实尺寸，我抓不到它的 CSS
       （站点 429），所以做成可调：在「界面」页用 - / + 调到和原版一致。 */
    iconSize: 80,
    /* ★ 用户要求：加语言选项。
       'auto' = 跟随游戏里的 TranslationLanguage（推荐）；
       'zh' / 'en' = 强制 DLS 自己的界面文案用中文/英文。
       注意：**锁的名字**不在这里选 —— 它直接读游戏资产的官方译名（见 lockDisplayName），
       所以永远和游戏语言一致。R132 支持 EN/DE/FR/RU/CN/TW/UA 七种，
       其中 DLS 自带文案只做了中英两种，其余语言按其官方英文兜底。 */
    language: 'auto',
    /* T1-A：按**锁型**改"锁资产自己的 RemoveTimer"（秒）。
       这是运行时改动（刷新即失效），所以记在这里、加载后自动重放。
       优先级高于下面 timerDefaults.initial 那个"单一初始时长"。 */
    assetTimers: {},
    password: {
      enabled: true,
      value: 'ASRESIA',        // 用户指定的默认密码（会被规范化为 A-Z、最多 8 位 = 游戏的 /^[A-Z]{1,8}$/）
      hint: '23575',           // 用户指定的默认提示语（**自由文本**，中文/emoji 都行，最多 140 字符）
      fillUnlockField: false,  // 是否也预填"解锁用"的输入框（默认否，避免手滑解锁）
      /* 上锁时**直接**把密码/提示语写进锁（不用你再点原版的「设置密码」）。
         onlySelf=true 时只对"上在你身上的、你上的"锁生效（与计时锁默认值同一策略）。 */
      applyOnLock: true,
      /* false（默认）= 上锁时无论对象是谁都套默认值；
         true = 只在上锁对象是**你自己**时才套（改别人请用手动输入）。
         ★ 用户实测：设成 true 会导致"给别人上锁仍是 5 分钟/没密码"，所以默认 false。 */
      onlySelf: false,
      /* ★ 原版功能：锁界面上那个「解锁时移除物品」勾选框。
         对应 `Property.RemoveOnUnlock`（PasswordPadlock.js:87 画、:120 切换、:134 使用）。
         上锁时直接把它写成这个布尔值（勾上 = true）。 */
      removeOnUnlock: false,
    },
    /* 组合密码锁（CombinationPadlock）：字段是 CombinationNumber，**只有 4 位数字**
       （Validation.js:4 `/^\d{4}$/`，非法值会被服务端重置成 0000）。
       留空 = 不主动套默认（要改就在「设置 → 拓展组件 → DLS → 组合锁」里改）。 */
    combination: {
      enabled: true,
      value: '',
      applyOnLock: true,
      onlySelf: false,
    },
    /* 「关于」页要显示的 GitHub 仓库地址（填在设置页里即可，不用改代码）。
       留空 → 关于页只显示全称与版本。填了 → 多出「详情页」与「最近更新」两个按钮。 */
    about: { repoUrl: 'https://github.com/Asresia/Default-Lock-Setting' },
  };

  const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const clone = (v) => JSON.parse(JSON.stringify(v));

  function merge(base, over) {
    if (!isPlainObject(over)) return base;
    for (const k of Object.keys(over)) {
      const v = over[k];
      if (isPlainObject(v) && isPlainObject(base[k])) merge(base[k], v);
      else if (v !== undefined) base[k] = v;
    }
    return base;
  }

  function loadSettings() {
    const base = clone(DEFAULT_SETTINGS);
    try {
      // 新键优先；没有就读改名前的旧键（BCA 时代存下的配置）
      const raw = localStorage.getItem(STORE_KEY) || localStorage.getItem(LEGACY_STORE_KEY);
      if (raw) merge(base, JSON.parse(raw));
    } catch (e) {
      console.warn(TAG, '读取设置失败，使用默认值', e);
    }
    return base;
  }

  let settings = loadSettings();

  /* 一次性迁移（b13 → b14）：b13 里我把 onlySelf 的默认值设成了 true
     （因为我误解了"改别人的别用默认"这句话）。实际上用户要的是：
       · **上锁时**的默认值对**所有人**都生效（= 旧版行为，给 sub 上锁也自动套默认时长）
       · 想**改一把已有的锁**时才用手动输入（原版锁界面里的 DLS 输入框 / 格式刷）
     所以这里把已经存过 true 的设置改回 false，只改一次，之后尊重玩家手改的值。 */
  (function migrateOnlySelf() {
    if (settings.migratedOnlySelf) return;
    settings.migratedOnlySelf = true;
    let changed = false;
    const t = settings.timerDefaults && settings.timerDefaults.initial;
    if (t && t.onlySelf === true) { t.onlySelf = false; changed = true; }
    if (settings.password && settings.password.onlySelf === true) { settings.password.onlySelf = false; changed = true; }
    if (settings.combination && settings.combination.onlySelf === true) { settings.combination.onlySelf = false; changed = true; }
    saveSettings();
    if (changed) {
      log('已把「默认值只对自己生效」改回关闭：现在给**别人**上锁也会自动套默认值；' +
        '只想对自己生效就把 settings.password/timerDefaults.initial/combination 的 onlySelf 设为 true。');
    }
  })();

  function saveSettings() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(settings));
      return true;
    } catch (e) {
      console.warn(TAG, '保存设置失败', e);
      return false;
    }
  }

  /* ========================== 日志 ========================== */

  function log(...a) { if (settings.debug) console.log(TAG, ...a); }
  function warn(...a) { console.warn(TAG, ...a); }

  /* ====================== 全局读写（含词法全局） ====================== */
  /* const/let 声明的全局（OwnerTimerChooseOptions 等）不在 window 上，只能走全局 eval。
     沙箱/页面若有 CSP 禁止 eval，这里会退化为安全失败，并在 report() 里体现出来。 */

  function evalWorks() {
    if (evalWorks._ok !== undefined) return evalWorks._ok;
    try {
      (0, eval)('1');
      evalWorks._ok = true;
    } catch (e) {
      evalWorks._ok = false;
      warn('全局 eval 被 CSP 禁止 → 词法作用域全局（计时锁选择器）将无法读写');
    }
    return evalWorks._ok;
  }

  /* 只从全局作用域读（**不给 window 属性优先**）。
     ★ 为什么必须有这个：计时锁的选择器是 `const`/`let` 声明，不在 window 上。
       如果读取时先看 window[name]，一旦哪里在 window 上造了个同名属性，
       就会读到那个"影子值"，而游戏读的是真正的词法绑定 ——
       表现就是「自检说写进去了、界面却没变」。 */
  function gGetLexical(name) {
    if (!evalWorks()) return undefined;
    try {
      return (0, eval)('typeof ' + name + ' === "undefined" ? undefined : ' + name);
    } catch (e) {
      return undefined;
    }
  }

  function gGet(name) {
    // 先看 window（绝大多数 BC 函数都挂在 window 上）
    try {
      if (window[name] !== undefined) return window[name];
    } catch (e) { /* 忽略 */ }
    return gGetLexical(name);
  }

  /**
   * 写全局，并**核对确实写进了词法绑定**。只有核对通过才返回 true。
   * 守卫：绝不像以前那样"失败就退化成 window 属性" —— 那会让本方读到影子值、
   * 与游戏读到的值不一致，而且不会报错。
   */
  function gSet(name, value) {
    if (!evalWorks()) return false;
    try {
      window.__dlsTmp = value;
      try {
        (0, eval)(name + ' = window.__dlsTmp');
      } finally {
        try { delete window.__dlsTmp; } catch (e) { /* 忽略 */ }
      }
      // 用**裸标识符**回读：它只会命中词法绑定
      //（若上一步只是"创建了一个 window 属性"，这里会读到旧值，从而暴露问题）
      if (gGetLexical(name) === value) return true;
      warn('写入 ' + name + ' 后回读不一致：期望 ' + JSON.stringify(value) +
        '，词法读到 ' + JSON.stringify(gGetLexical(name)));
    } catch (e) {
      warn('写入全局失败', name, e && e.message);
    }
    return false;
  }

  const isFn = (name) => typeof gGet(name) === 'function';

  /* ========================== SDK 与 hook 层 ========================== */

  const state = {
    mod: null,
    offs: [],           // 已挂钩子 / 监听器的移除函数
    hooked: new Set(),  // 已挂的名字，避免重复
    timers: [],
    sdkVersion: null,
    hotkeyHandler: null,
    alive: true,        // unload() 置 false：让正在跑的异步任务立刻停手
    ui: null,           // 悬浮控件的根元素
    assetApplied: {},   // 已成功改过默认时长的锁资产（避免重复日志）
    assetWarned: {},    // 已警告过的失败项（避免刷屏）
    prefRegistered: false,   // 「设置 → 拓展组件」里的设置页是否已注册
  };

  function getSdk() {
    try {
      if (typeof bcModSdk !== 'undefined' && bcModSdk) return bcModSdk;
    } catch (e) { /* 词法绑定可能不存在 */ }
    try {
      return window.bcModSdk || null;
    } catch (e) {
      return null;
    }
  }

  function waitForSdk(timeoutMs) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      (function tick() {
        const sdk = getSdk();
        if (sdk) return resolve(sdk);
        if (Date.now() - t0 > timeoutMs) return reject(new Error('等待 bcModSdk 超时'));
        setTimeout(tick, 200);
      })();
    });
  }

  /**
   * 挂一个 hook。priority 越小越晚被调用（SDK 规则：数字大的先调用），
   * 我们用很小的负数 + 先调 next()，保证自己的逻辑跑在游戏本体之后。
   */
  function hookIfExists(name, fn, priority) {
    if (state.hooked.has(name)) return false;
    if (!isFn(name)) return false;
    if (!state.mod) return false;
    try {
      const off = state.mod.hookFunction(name, priority === undefined ? -1000 : priority, (args, next) => fn(args, next));
      state.offs.push(off);
      state.hooked.add(name);
      log('已挂钩', name);
      return true;
    } catch (e) {
      warn('挂钩失败', name, e && e.message);
      return false;
    }
  }

  /* ========================== A1b：密码锁默认密码 ========================== */

  const PASSWORD_TARGETS = [
    // 不带 Hook 的是真正被调用的入口（见文件头第 3 条）
    'InventoryItemMiscPasswordPadlockLoad',
    'InventoryItemMiscTimerPasswordPadlockLoad',
    'InventoryItemMiscSafewordPadlockLoad',
    // 再挂一份带 Hook 的，以防某些路径直接调它；重复预填是幂等的
    'InventoryItemMiscPasswordPadlockLoadHook',
    'InventoryItemMiscTimerPasswordPadlockLoadHook',
    'InventoryItemMiscSafewordPadlockLoadHook',
  ];

  /** 密码规则来自源码：/^[A-Z]+$/，输入框 MaxLength = 8 */
  function normalizePassword(v) {
    return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
  }

  function setInputIfEmpty(id, value) {
    const el = document.getElementById(id);
    if (!el || el.value) return false;   // 已经有内容就不覆盖（尊重你手动输入）
    if (typeof window.ElementValue === 'function') window.ElementValue(id, value);
    else el.value = value;
    return true;
  }

  /* ---------- A1b-2：上锁时**直接写密码/提示语**（用户要求："不要只在输入框里预填"） ----------
     原版流程是：挂上锁 → 再打开锁界面 → 手打密码 → 点「设置密码」。
     本函数在**你刚把锁挂上自己身上**的那一刻就把 Password / Hint / LockSet 写好并同步，
     省掉那一轮点击。边界和计时锁默认值（A1a-2）完全一致：
     只对"**你自己上的、且上在你身上**"的锁生效（onlySelf）。
     ⚠ 注意 `LockSet` 必须一起置真：游戏的 `…IsSet()` 是
       `LockSet || (LockMemberNumber 是数字且不是你)`，不置的话界面仍会当"未设置"。 */
  /** onlySelf **只在显式设为 true** 时才限制（false / undefined / 缺键都视为不限制）。
     反过来写（默认限制）曾经造成很隐蔽的 bug：某个命令把 onlySelf 抹成 undefined 后，
     "给别人上锁"就悄悄不再套默认值了。 */
  function onlySelfOk(C, cfg) {
    if (!cfg || cfg.onlySelf !== true) return true;
    try { return typeof C.IsPlayer === 'function' ? C.IsPlayer() : true; } catch (e) { return true; }
  }

  /** 勾选框状态的文字 */
  function yesNo(v) {
    return v ? '勾上' : '不勾';
  }

  /** 直接写密码的**判据**。执行与诊断（__DLS.applyNow）共用这一份，避免两处逻辑漂移 */
  function passwordGate(C, item) {
    const cfg = settings.password;
    if (!settings.enabled) return { ok: false, reason: '锁工具总开关关着（settings.enabled=false）' };
    if (!cfg || cfg.enabled === false) return { ok: false, reason: 'settings.password.enabled=false' };
    if (cfg.applyOnLock === false) return { ok: false, reason: 'settings.password.applyOnLock=false（那就只预填输入框）' };
    const pw = normalizePassword(cfg.value);
    const hint = normalizeHint(cfg.hint);
    if (!pw && !hint) return { ok: false, reason: '密码和提示语都没配（两个都是空）' };   // ★ 只配提示语也要生效
    const player = gGet('Player');
    if (!player) return { ok: false, reason: '拿不到 Player' };
    if (item.Property.LockMemberNumber !== player.MemberNumber) {
      return {
        ok: false,
        reason: '这把锁不是你上的（LockMemberNumber=' + item.Property.LockMemberNumber +
          '，你的会员号 ' + player.MemberNumber + '）',
      };
    }
    if (!onlySelfOk(C, cfg)) return { ok: false, reason: '上锁对象不是你，而 onlySelf=true（改别人请用手动输入）' };
    if (!PASSWORD_LOCKS.has(item.Property.LockedBy)) {
      return { ok: false, reason: '不是三种字母密码锁（LockedBy=' + item.Property.LockedBy + '）' };
    }
    // 已经设过的锁一律保持原样（不覆盖密码/提示语/勾选框）。
    // ⚠ 这里刻意不做"密码不同就覆盖"——那是超出用户要求的破坏性行为；
    //   要改已有的锁，请用原版界面里的勾选框，或 __DLS.brush.applyPassword()。
    if (item.Property.LockSet) {
      return { ok: false, reason: '这把锁已经设过了（LockSet=true），保持原样不覆盖' };
    }
    const wantRm = !!cfg.removeOnUnlock;
    return {
      ok: true,
      reason: '会直接写：' + (pw ? '密码 ' + pw : '（无密码 —— 等于谁都能开）') +
        (hint ? '，提示语 "' + hint + '"' : '') +
        '，解锁时移除物品=' + wantRm,
    };
  }

  function applyInitialPassword(C, item) {
    const g = passwordGate(C, item);
    if (!g.ok) return false;
    const cfg = settings.password;
    const pw = normalizePassword(cfg.value);
    const hint = normalizeHint(cfg.hint);

    // ★ 顺序按用户要求：**先勾勾选框，再设密码**
    //   （等价于你在原版界面上先勾一下、再填密码；也避免"先置 LockSet 再想勾"那种别扭）
    item.Property.RemoveOnUnlock = !!cfg.removeOnUnlock;
    item.Property.LockSet = true;
    if (pw) item.Property.Password = pw;
    if (hint) item.Property.Hint = hint;

    const parts = [];
    if (pw) parts.push('密码 ' + pw);
    if (hint) parts.push('提示语 "' + hint + '"');
    if (typeof cfg.removeOnUnlock === 'boolean') parts.push('解锁后解除拘束=' + cfg.removeOnUnlock);
    log('已直接设置密码 [' + ((item.Asset && item.Asset.Group) ? item.Asset.Group.Name : '?') + '] ' +
      item.Property.LockedBy + '：' + parts.join('，'));
    return true;
  }

  /** 直接写组合的判据（执行与诊断共用） */
  function combinationGate(C, item) {
    const cfg = settings.combination;
    if (!settings.enabled) return { ok: false, reason: '锁工具总开关关着（settings.enabled=false）' };
    if (!cfg || cfg.enabled === false) return { ok: false, reason: 'settings.combination.enabled=false' };
    if (cfg.applyOnLock === false) return { ok: false, reason: 'settings.combination.applyOnLock=false' };
    const code = normalizeCombination(cfg.value);
    if (!code) return { ok: false, reason: '没配组合默认值（留空 = 不主动套）' };
    const player = gGet('Player');
    if (!player) return { ok: false, reason: '拿不到 Player' };
    if (item.Property.LockMemberNumber !== player.MemberNumber) {
      return { ok: false, reason: '这把锁不是你上的（LockMemberNumber=' + item.Property.LockMemberNumber + '）' };
    }
    if (!onlySelfOk(C, cfg)) return { ok: false, reason: 'onlySelf=true 且上锁对象不是你' };
    if (!COMBINATION_LOCKS.has(item.Property.LockedBy)) {
      return { ok: false, reason: '不是组合密码锁（LockedBy=' + item.Property.LockedBy + '）' };
    }
    if (item.Property.CombinationNumber === code) return { ok: false, reason: '组合已经就是这个了' };
    // 刚挂上的组合锁通常还没有组合；若已有就当作"已设置"（与原版"要先输对旧组合才能改"一致）
    if (item.Property.CombinationNumber) {
      return { ok: false, reason: '已有组合且 brush.overwriteSetCombination=false，不覆盖' };
    }
    return { ok: true, reason: '会直接写组合 ' + code, code: code };
  }

  function applyInitialCombination(C, item) {
    const g = combinationGate(C, item);
    if (!g.ok) return false;
    item.Property.CombinationNumber = g.code;
    log('已直接设置组合密码 [' + ((item.Asset && item.Asset.Group) ? item.Asset.Group.Name : '?') + '] → ' + g.code);
    return true;
  }

  function prefillPasswordInputs(reason) {
    const cfg = settings.password;
    if (!settings.enabled || !cfg.enabled) return 0;
    const pw = normalizePassword(cfg.value);
    const hint = normalizeHint(cfg.hint);
    if (!pw && !hint) return 0;

    // ★ 用户约束：默认密码只用于"**自己第一次挂上的锁**"。
    //   别人上的锁 / NPC 上的锁 / 没有上锁者的旧锁，都不该被我们填密码
    //   （打开旧锁不重置任何东西）。
    const player = gGet('Player');
    const focus = gGet('DialogFocusSourceItem');
    if (player && focus && focus.Property) {
      if (focus.Property.LockMemberNumber !== player.MemberNumber) return 0;
    }

    let n = 0;
    if (pw) {
      if (setInputIfEmpty('SetPassword', pw)) n++;
      if (cfg.fillUnlockField && setInputIfEmpty('Password', pw)) n++;
    }
    // 提示语是**自由文本**（中文/emoji 都行），只限 140 字符、不做大小写转换
    if (hint && setInputIfEmpty('SetHint', hint)) n++;

    if (n) log('已预填 ' + n + ' 个输入框（' + reason + '）');
    return n;
  }

  /** 组合密码锁：把默认组合预填进「新组合」输入框
      （原版仍需你先**输对旧组合**才能提交修改，见 CombinationPadlock.js:184） */
  function prefillCombinationInput(reason) {
    if (!settings.enabled) return 0;
    const cfg = settings.combination;
    if (!cfg || cfg.enabled === false) return 0;
    const code = normalizeCombination(cfg.value);
    if (!code) return 0;
    let n = 0;
    if (setInputIfEmpty('NewCombinationNumber', code)) n++;
    if (n) log('已预填组合密码输入框（' + reason + '）');
    return n;
  }

  function installPasswordHooks() {
    let n = 0;
    for (const name of PASSWORD_TARGETS) {
      const ok = hookIfExists(name, (args, next) => {
        const r = next(args);            // 先让游戏把输入框建出来
        try { prefillPasswordInputs(name); } catch (e) { warn('预填异常', e && e.message); }
        return r;
      });
      if (ok) n++;
    }
    // 组合密码锁的 Load 钩子（它建的是 CombinationNumber / NewCombinationNumber）
    if (hookIfExists('InventoryItemMiscCombinationPadlockLoad', (args, next) => {
      const r = next(args);
      try { prefillCombinationInput('CombinationPadlockLoad'); } catch (e) { warn('组合预填异常', e && e.message); }
      return r;
    })) n++;
    return n;
  }

  /* ========================== A1a：计时锁默认时长 ========================== */

  const CHOOSERS = [
    { key: 'owner', options: 'OwnerTimerChooseOptions', index: 'OwnerTimerChooseOptionsIndex', indexes: 'OwnerTimerChooseIndexes' },
    /* 恋人锁与主人锁共用上面那三个全局变量（LoversTimerPadlock.js 全文 9 行，完全复用 Owner 脚本），
       所以它**不参与**启动时的预写：只能在该锁界面打开或上锁时按锁型写（见 applyChooserForLock）。 */
    { key: 'lovers', options: 'OwnerTimerChooseOptions', index: 'OwnerTimerChooseOptionsIndex', indexes: 'OwnerTimerChooseIndexes', perLock: true },
    { key: 'mistress', options: 'MistressTimerChooseOptions', index: 'MistressTimerChooseOptionsIndex', indexes: 'MistressTimerChooseIndexes' },
    { key: 'passwordTimer', options: 'PasswordTimerChooseOptions', index: 'PasswordTimerChooseOptionsIndex', indexes: 'PasswordTimerChooseIndexes' },
  ];

  /** 启动时可以预写一次的选择器（lovers 与 owner 共用变量，必须按锁型分别写） */
  const EAGER_CHOOSERS = ['owner', 'mistress', 'passwordTimer'];

  const chooserDone = new Set();
  const chooserAttempts = {};   // key -> 写入失败的重试次数

  function applyChooser(c) {
    const want = settings.timerDefaults[c.key];
    if (!want) return 'no-config';
    const options = gGet(c.options);
    if (!Array.isArray(options)) return 'not-loaded';

    const unitIdx = options.findIndex((o) => o && o.unit && o.unit.label === want.unit);
    if (unitIdx < 0) {
      return 'unit-not-found: ' + options.map((o) => o.unit && o.unit.label).join('/');
    }
    const values = options[unitIdx].values || [];
    const valueIdx = values.indexOf(want.value);
    if (valueIdx < 0) {
      return 'value-not-found: ' + values.join('/');
    }

    gSet(c.index, unitIdx) || null;
    const arr = gGetLexical(c.indexes);            // ★ 词法读，避免读到影子数组
    if (Array.isArray(arr)) arr[unitIdx] = valueIdx;
    else warn('找不到选择器下标数组', c.indexes);

    // 核对：两个值都必须能用「裸标识符」读回来，才能确认游戏读到的就是这份
    const backIdx = gGetLexical(c.index);
    const backArr = gGetLexical(c.indexes);
    const okIdx = backIdx === unitIdx;
    const okArr = Array.isArray(backArr) && backArr[unitIdx] === valueIdx;
    if (okIdx && okArr) return 'ok';
    return 'write-failed: 单位下标 ' + (okIdx ? 'ok' : '期望 ' + unitIdx + ' 读到 ' + JSON.stringify(backIdx)) +
      '；数值下标 ' + (okArr ? 'ok' : '期望 [' + unitIdx + ']=' + valueIdx + ' 读到 ' + JSON.stringify(backArr));
  }

  function applyAllTimerDefaults(reason) {
    if (!settings.enabled) return;
    for (const c of CHOOSERS) {
      if (c.perLock) continue;                       // 与别的锁共用全局变量的项，只能按锁型写
      const r = applyChooser(c);
      if (r === 'ok') {
        log('计时锁默认已应用 [' + c.key + '] ' + settings.timerDefaults[c.key].unit + ' ' +
          settings.timerDefaults[c.key].value + '（' + reason + '）');
      } else if (r !== 'not-loaded') {
        warn('计时锁默认未应用 [' + c.key + '] ' + r);
      }
    }
  }

  /** 锁资产 → 用哪一套选择器配置 */
  const CHOOSER_BY_LOCK = {
    OwnerTimerPadlock: 'owner',
    LoversTimerPadlock: 'lovers',
    MistressTimerPadlock: 'mistress',
    TimerPasswordPadlock: 'passwordTimer',
  };
  let chooserLockDone = null;      // 已按哪种锁写过（同一界面不重复写，否则玩家点不动 ◀/▶）

  /** 某种计时锁的界面打开（或正要上这种锁）时，把那套默认值写进去 */
  function applyChooserForLock(lockName) {
    const key = CHOOSER_BY_LOCK[lockName];
    if (!key) return null;
    if (chooserLockDone === lockName) return null;
    const c = CHOOSERS.filter((x) => x.key === key)[0];
    if (!c || !settings.timerDefaults[key]) return null;
    const r = applyChooser(c);
    if (r === 'ok') {
      chooserLockDone = lockName;
      log('计时锁默认已应用 [' + key + '] ' + settings.timerDefaults[key].unit + ' ' +
        settings.timerDefaults[key].value + '（锁=' + lockDisplayName(lockName) + '）');
    } else if (r !== 'not-loaded') {
      warn('计时锁默认未应用 [' + key + '] ' + r);
    }
    return r;
  }

  /* ---------- A1a-2：施加计时锁时的**初始剩余时间** ----------
     这才是玩家说的"计时锁默认时长"。游戏自己的做法（refs/bc/）：
       Inventory.js:1485  if (Lock.Asset.RemoveTimer > 0) TimerInventoryRemoveSet(C, group, Lock.Asset.RemoveTimer)
       Timer.js:166       item.Property.RemoveTimer = Math.round(CurrentTime + Timer * 1000)
     即"初始剩余时间 = 锁资产自己的 RemoveTimer 秒数"。Mistress 那个正好是 300 秒 = 5 分钟。
     ⇒ 只改选择器（一次「添加」加多少）是不够的，必须在上锁之后把 RemoveTimer 改成我们要的值。

     安全边界：只动**锁是玩家自己上的**那些（`DialogLockingClick` 传的上锁者是 Player，
     见 Dialog.js:2042），免得别的插件/NPC 上锁时被我们改掉时长。
     ★ 注意：**不是**"只对上在自己身上的锁生效" —— 给别人上的锁一样套默认值
     （用户实测要求："给别人上锁也要用我的默认时长"）。只有 onlySelf=true 才会限制。 */
  /** 初始时长的判据（执行与诊断共用，避免两处逻辑漂移） */
  function timerGate(C, item, lock) {
    if (!settings.enabled) return { ok: false, reason: '锁工具总开关关着（settings.enabled=false）' };
    if (!C || !item || !item.Property || !item.Asset) return { ok: false, reason: '参数不完整' };
    if (!lock || !lock.Asset) return { ok: false, reason: '拿不到锁资产' };
    if (!(Number(lock.Asset.RemoveTimer) > 0)) return { ok: false, reason: '不是计时锁' };
    const player = gGet('Player');
    if (!player) return { ok: false, reason: '拿不到 Player' };
    if (item.Property.LockMemberNumber !== player.MemberNumber) {
      return {
        ok: false,
        reason: '这把锁不是你上的（LockMemberNumber=' + item.Property.LockMemberNumber +
          '，你的会员号 ' + player.MemberNumber + '）',
      };
    }
    // ★ 只在该锁**确实已经有计时器**时才动它。
    //   `InventoryLock(..., Update = false)` 的调用确实存在（Validation.js:409、
    //   Inventory.js:729/1546），那种情况下游戏根本不会调 TimerInventoryRemoveSet，
    //   RemoveTimer 不是数字 —— 我们不该硬塞一个进去，否则等于凭空造出一段锁定时长。
    if (typeof item.Property.RemoveTimer !== 'number') {
      return { ok: false, reason: '这把锁当前没有计时器（InventoryLock 的 Update=false 调用）' };
    }
    // ★ 时长来源的优先级：T1-A「按锁型的资产默认值」 > 全局 timerDefaults.initial
    const perAsset = (settings.assetTimers || {})[lock.Asset.Name];
    if (typeof perAsset === 'number' && perAsset > 0) {
      return { ok: true, reason: '用锁型默认值 ' + fmtDuration(perAsset * 1000), seconds: perAsset };
    }
    /* ★ 主人锁 / 恋人锁各有自己的初始时长（initialByLock），其余计时锁用全局 initial。
       策略开关（enabled / onlySelf）仍以全局那份为准。 */
    const perLock = (settings.timerDefaults.initialByLock || {})[lock.Asset.Name];
    const want = perLock || settings.timerDefaults.initial;
    if (!want || settings.timerDefaults.initial.enabled === false) return { ok: false, reason: 'timerDefaults.initial.enabled=false' };
    if (!onlySelfOk(C, settings.timerDefaults.initial)) {
      return { ok: false, reason: 'onlySelf=true 且上锁对象不是你（改别人请用手动输入）' };
    }
    const secPer = unitSeconds(want.unit);
    if (!secPer) return { ok: false, reason: '未知单位 ' + want.unit + '（游戏当前单位：' + unitLabels().join('/') + '）' };
    const seconds = Number(want.value) * secPer;
    if (!isFinite(seconds) || seconds <= 0) return { ok: false, reason: '配置的时长不合法' };
    return { ok: true, reason: '会写 ' + fmtDuration(seconds * 1000), seconds: seconds };
  }

  function applyInitialTimerDuration(C, item) {
    if (!settings.enabled) return false;
    if (!C || !item || !item.Property || !item.Asset) return false;

    const getLock = gGet('InventoryGetLock');
    let lock = null;
    try { lock = (typeof getLock === 'function') ? getLock(item) : null; } catch (e) { lock = null; }
    const g = timerGate(C, item, lock);
    if (!g.ok) return false;
    const seconds = g.seconds;

    const now = Number(gGet('CurrentTime')) || Date.now();
    const maxTimer = Number(lock.Asset.MaxTimer) || 0;
    const cap = maxTimer > 0 ? now + maxTimer * 1000 : Infinity;
    const target = Math.round(Math.min(now + seconds * 1000, cap));

    const before = item.Property.RemoveTimer;
    const group = item.Asset.Group ? item.Asset.Group.Name : '?';
    let changed = false;

    if (before !== target) {
      item.Property.RemoveTimer = target;
      changed = true;
      // 记录 before → after：InventoryLock 也被 BCC / DOGS 挂过，
      // 我们的优先级 -1000（最后执行）会让我们的值胜出 —— 所以必须留下痕迹，不能悄悄覆盖。
      log('初始时长 [' + group + '] ' + lock.Asset.Name + '：游戏给的 ' + fmtDuration(before - now) +
        ' → 改为 ' + fmtDuration(target - now) +
        (cap !== Infinity && now + seconds * 1000 > cap ? '（被该锁上限截断）' : ''));
    }

    // ★ 原版功能：计时锁界面上那个「计时结束时移除物品」勾选框。
    //   Timer.js:106 读 `Property.RemoveItem`，:117-119 真的会移除物品。
    //   直接写状态，和你在界面上勾选等价。
    const rmItem = !!settings.timerDefaults.initial.removeItem;
    if (item.Property.RemoveItem !== rmItem) {
      item.Property.RemoveItem = rmItem;
      changed = true;
      log('计时结束时移除物品 [' + group + '] = ' + rmItem + '（原版勾选框 RemoveItem）');
    }
    return changed;
  }

  /* ====================== 后加载脚本的轮询等待 ====================== */

  function tick(reason) {
    if (!settings.enabled) return;

    // ★ 每次都试着补挂游戏钩子。
    // 原因：DialogLockingClick 是随 BC 主 bundle 按需加载的，而 bcModSdk 从登录页就存在
    // → waitForSdk 立刻 resolve → 在 @run-at document-start 下 DialogLockingClick 还不是
    // 全局函数，hookIfExists 只尝试一次就会**永久放弃**，于是"点锁时重设默认值"和
    // "不依赖 hook 的延时预填密码"两条路径全部失效。
    // 已挂过的名字被 state.hooked 直接跳过，重复调用几乎零成本。
    try { installGameHooks(); } catch (e) { warn('补挂游戏钩子失败', e && e.message); }
    try { syncUi(); } catch (e) { warn('悬浮条同步失败', e && e.message); }
    // T1-A：锁资产是随游戏加载的，所以每次 tick 都试着把配置的锁型默认时长写回去
    try { applyAllAssetTimerOverrides(); } catch (e) { warn('应用锁型默认时长失败', e && e.message); }
    // 「设置 → 拓展组件」的设置页：Preference.js 也是随游戏加载的，同样反复尝试
    try { installPreferencePage(); } catch (e) { warn('注册设置页失败', e && e.message); }

    // 计时锁：哪个脚本加载好了就应用哪个
    for (const c of CHOOSERS) {
      if (c.perLock) continue;                       // ★ 与主人锁共用全局变量，不能在这里写
      if (chooserDone.has(c.key)) continue;
      const r = applyChooser(c);
      if (r === 'ok') {
        chooserDone.add(c.key);
        delete chooserAttempts[c.key];
        log('计时锁默认已应用 [' + c.key + '] ' + settings.timerDefaults[c.key].unit + ' ' +
          settings.timerDefaults[c.key].value + '（' + reason + '）');
      } else if (r.startsWith('unit-not-found') || r.startsWith('value-not-found')) {
        chooserDone.add(c.key);   // 配置与源码不一致，重试无意义
        warn('计时锁默认未应用 [' + c.key + '] ' + r);
      } else if (r.startsWith('write-failed')) {
        // 写不进去要重试（可能脚本刚加载、绑定还没就绪），但别无限刷日志
        const n = (chooserAttempts[c.key] = (chooserAttempts[c.key] || 0) + 1);
        if (n >= 5) {
          chooserDone.add(c.key);
          warn('计时锁默认写入失败（已重试 ' + n + ' 次，放弃）[' + c.key + '] ' + r);
        } else if (n === 1) {
          warn('计时锁默认写入失败，将重试 [' + c.key + '] ' + r);
        }
      }
    }

    // 密码锁：界面脚本出现后再挂钩
    installPasswordHooks();
  }

  function startPolling() {
    tick('初始化');
    const t = setInterval(() => {
      try { tick('轮询'); } catch (e) { warn('轮询异常', e && e.message); }
    }, 1500);
    state.timers.push(t);
    // 一直轮询，不设超时：锁界面脚本是"按需加载"的，可能在任何时刻才出现。
    // 已经挂过的名字被 state.hooked 直接跳过（一次 Set 查询），所以重复调用几乎零成本。
  }

  /* ====================== 挂游戏钩子 ====================== */

  function installGameHooks() {
    // 每次在锁菜单里点一个锁（= "要把某个锁装上去"）时做三件事：
    //   1) 把计时锁选择器重置回默认值
    //   2) 顺手补挂可能刚刚才加载出来的密码锁钩子
    //   3) **延时几次尝试预填密码** —— 这是不依赖任何 hook 的兜底路径。
    //      原因：扩展物品的 `…Load` 名字是游戏运行时动态赋值的
    //      （ExtendedItem.js:142 `globalThis[funcName] = (...args) => scriptHook(...)`），
    //      一旦游戏重新赋值，我们挂的 hook 就会被覆盖，
    //      而 state.hooked 会以为"已挂好"从而永不重挂。延时预填不受这个问题影响。
    // DialogLockingClick 只在鼠标点击时触发（冷路径），不是每帧。
    hookIfExists('DialogLockingClick', (args, next) => {
      const r = next(args);
      try {
        chooserDone.clear();
        for (const k of Object.keys(chooserAttempts)) delete chooserAttempts[k];
        tick('DialogLockingClick');
        if (settings.enabled && settings.password.enabled) {
          for (const delay of [0, 60, 150, 300]) {
            const id = setTimeout(() => {
              if (!state.alive) return;                 // ★ unload 之后不再动
              try { prefillPasswordInputs('DialogLockingClick+' + delay + 'ms'); } catch (e) { /* 忽略 */ }
            }, delay);
            state.timers.push(id);                      // ★ 记账
          }
        }
      } catch (e) { warn('DialogLockingClick 处理异常', e && e.message); }
      return r;
    }, -1000);

    // A1a-2：上锁之后把初始剩余时间改成配置的默认时长，然后同步出去
    hookIfExists('InventoryLock', (args, next) => {
      const r = next(args);
      try {
        const C = args[0];
        const it = args[1];
        let item = null;
        if (typeof it === 'string') {
          const get = gGet('InventoryGet');
          item = (typeof get === 'function') ? get(C, it) : null;
        } else if (it && it.Asset) {
          item = it;
        }
        if (item) {
          // ★ 三个默认值**互相隔离**：任何一个抛异常都不该连累另外两个
          //   （曾经把三者放在同一个 try 里，结果一个出错就整块跳过）
          let changed = false;
          const jobs = [
            ['计时默认', applyInitialTimerDuration],
            ['密码默认', applyInitialPassword],
            ['组合默认', applyInitialCombination],
          ];
          for (const [label, fn] of jobs) {
            try { if (fn(C, item)) changed = true; } catch (e) { warn(label + ' 应用异常：' + (e && e.message)); }
          }
          // 没写成时把**原因**打出来（只针对对应类型的锁，避免刷屏）—— 这样"为什么没生效"一眼可见
          try {
            if (PASSWORD_LOCKS.has(item.Property.LockedBy) && settings.password.applyOnLock !== false) {
              const g = passwordGate(C, item);
              if (!g.ok) log('密码默认未应用 [' + item.Property.LockedBy + ']：' + g.reason);
            } else if (COMBINATION_LOCKS.has(item.Property.LockedBy) && settings.combination.applyOnLock !== false) {
              const g = combinationGate(C, item);
              if (!g.ok) log('组合默认未应用 [' + item.Property.LockedBy + ']：' + g.reason);
            } else if (Number(lock.RemoveTimer) > 0) {
              const g = timerGate(C, item, lock);
              if (!g.ok) log('初始时长未应用 [' + item.Property.LockedBy + ']：' + g.reason);
            }
          } catch (e) { /* 诊断失败无所谓 */ }
          if (changed) {
            const upd = gGet('ChatRoomCharacterItemUpdate');
            if (typeof upd === 'function') upd(C, item.Asset.Group.Name);
            const rf = gGet('CharacterRefresh');
            if (typeof rf === 'function') rf(C);
          }
        }
      } catch (e) { warn('初始时长处理异常', e && e.message); }
      return r;
    }, -1000);

    // ★ 在**原版锁界面**里嵌 hh:mm:ss 输入框（用户要求）：挂各计时锁的 Draw / Click / Exit
    const TIMER_LOCK_PREFIXES = [
      'InventoryItemMiscTimerPadlock',
      'InventoryItemMiscOwnerTimerPadlock',
      'InventoryItemMiscLoversTimerPadlock',
      'InventoryItemMiscMistressTimerPadlock',
      'InventoryItemMiscTimerPasswordPadlock',
    ];
    for (const prefix of TIMER_LOCK_PREFIXES) {
      // Draw：先让游戏画完，再摆上我的输入框与按钮
      hookIfExists(prefix + 'Draw', (args, next) => {
        const r = next(args);
        try {
          const item = gGet('DialogFocusSourceItem');
          const getLock = gGet('InventoryGetLock');
          let lock = null;
          try {
            lock = (item && item.Property && item.Property.LockedBy && typeof getLock === 'function')
              ? getLock(item) : null;
          } catch (e) { lock = null; }
          if (item && lock && lock.Asset && Number(lock.Asset.RemoveTimer) > 0 &&
              typeof item.Property.RemoveTimer === 'number') {
            lockBoxDraw();
            try { applyChooserForLock(item.Property.LockedBy); } catch (e) { /* 忽略 */ }
          } else if (lockBoxState.created) {
            lockBoxRemove();                 // 切到非计时锁界面就把我的输入框收掉
          }
        } catch (e) { /* 忽略 */ }
        return r;
      }, -1000);

      // Click：优先级高（先跑）—— 点我的按钮**并且真的应用成功**才吞掉；否则交给游戏
      hookIfExists(prefix + 'Click', (args, next) => {
        try {
          const c = lockBoxCfg();
          const mouseIn = gGet('MouseIn');
          if (lockBoxState.visible && typeof mouseIn === 'function' &&
              mouseIn(c.cx + c.w / 2 + 12, c.cy - c.bh / 2, c.bw, c.bh)) {
            if (lockBoxApply()) return undefined;      // 成功 → 吞掉
            // 输入框空 / 格式错 / 没权限 → 不吞，让游戏照常处理（你还能用「添加」）
          }
        } catch (e) { warn('锁界面精确时长处理异常：' + (e && e.message)); }
        return next(args);
      }, 100);

      // Exit：离开这把锁的界面就收掉（有些计时锁没有 Exit 钩子，见下面的兜底）
      hookIfExists(prefix + 'Exit', (args, next) => {
        const r = next(args);
        try { lockBoxRemove(); } catch (e) { /* 忽略 */ }
        chooserLockDone = null;      // 下次再进这个界面时重新按锁型写一遍
        return r;
      }, -1000);
    }

    // 兜底：离开物品对话框时也收掉输入框（普通 TimerPadlock 就没有 Exit 钩子）
    hookIfExists('DialogLeaveFocusItem', (args, next) => {
      const r = next(args);
      try { lockBoxRemove(); } catch (e) { /* 忽略 */ }
      return r;
    }, -1000);
  }

  /* ========================== A2：格式刷（批量应用） ==========================
     全部依据来自 refs/bc/ 的真实源码：
     · InventoryGetLock(item) → 锁物品（带 .Asset）；没有锁返回 null
     · 计时锁的判据是 **asset.RemoveTimer > 0**（不是靠锁名列表）
     · Asset.MaxTimer 单位是**秒**；Property.RemoveTimer 是**毫秒绝对时间戳**
       （见 InventoryItemMiscTimerPadlockAdd：
         Math.min(prop.RemoveTimer + add*1000, CurrentTime + lockItem.Asset.MaxTimer*1000)）
     · 同步：改完每个物品调 ChatRoomCharacterItemUpdate(C, Group) 推给房间；
       最后 CharacterRefresh(C) —— 当 C 是玩家自己时，它内部会调 ServerPlayerAppearanceSync() 写库
       （Character.js:1627-1630）
     · 权限是数据驱动的：Asset 上的 OwnerOnly / LoverOnly / FamilyOnly 分别对应
       DialogCanUseOwnerLockOn / LoverLockOn / FamilyLockOn；通用门槛是
       ServerChatRoomGetAllowItem(Player, C) 与 InventoryDoesItemAllowLock(item)
     · 密码：原版只允许给"尚未设置密码"的锁设密码
       （HandleFirstSet 只在 !IsSet(item) 分支被调用），所以默认不覆盖已设密码的锁
     ======================================================================== */

  /* 单位换算：**优先读游戏自己的 `TimeUnits`**（Common.js:53，lexical 全局），
     拿不到才退回内置表。用户的指令是"按它原有的单位来" ——
     硬编码 Minutes/Hours/Days 是错的：Owner 锁的选择器用到了 Days，
     将来游戏加单位（或其它锁用别的单位）也不该需要改这里。 */
  const FALLBACK_UNIT_SECONDS = { Minutes: 60, Hours: 3600, Days: 86400 };

  function gameTimeUnits() {
    const t = gGetLexical('TimeUnits');
    return (t && typeof t === 'object') ? t : null;
  }

  /** 游戏当前认识的所有单位名（用于报错提示与下拉框） */
  function unitLabels() {
    const t = gameTimeUnits();
    const out = [];
    if (t) {
      for (const k of Object.keys(t)) {
        const u = t[k];
        if (u && typeof u.label === 'string' && out.indexOf(u.label) < 0) out.push(u.label);
      }
    }
    if (!out.length) {
      // 退化：用已加载的锁选择器里出现过的单位
      for (const c of CHOOSERS) {
        const options = gGet(c.options);
        if (!Array.isArray(options)) continue;
        for (const o of options) {
          const l = o && o.unit && o.unit.label;
          if (l && out.indexOf(l) < 0) out.push(l);
        }
      }
    }
    return out.length ? out : Object.keys(FALLBACK_UNIT_SECONDS);
  }

  /** 单位 → 秒。三级来源：TimeUnits → 已加载的锁选择器 → 内置表 */
  function unitSeconds(unit) {
    const t = gameTimeUnits();
    if (t) {
      for (const k of Object.keys(t)) {
        const u = t[k];
        if (u && u.label === unit && typeof u.seconds === 'number') return u.seconds;
      }
    }
    for (const c of CHOOSERS) {
      const options = gGet(c.options);
      if (!Array.isArray(options)) continue;
      for (const o of options) {
        if (o && o.unit && o.unit.label === unit && typeof o.unit.seconds === 'number') return o.unit.seconds;
      }
    }
    return FALLBACK_UNIT_SECONDS[unit];
  }

  /* 名单来自游戏自身类型文档里 Password 字段的注释：
     "Used by PasswordPadlock, SafewordPadlock and TimerPasswordPadlock lock" */
  const PASSWORD_LOCKS = new Set(['PasswordPadlock', 'SafewordPadlock', 'TimerPasswordPadlock']);

  /* 组合密码锁：字段是 CombinationNumber，**只有 4 位数字**（Validation.js:4 `/^\d{4}$/`）。
     它和"字母密码"是两套完全不同的东西（字段不同、字符集不同、长度不同），所以单独一个名单。 */
  const COMBINATION_LOCKS = new Set(['CombinationPadlock']);

  /* 提示语（Hint）是**自由文本**：中文 / emoji 都能存，游戏不做大小写转换。
     游戏的限制只有输入框的 maxLength=140（PasswordPadlock.js:31），
     服务端也只在白名单里保留这个键、不校验不截断（Validation.js:11）
     ⇒ 长度只能由我们自己守。 */
  const HINT_MAX = 140;
  function normalizeHint(s) {
    return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, HINT_MAX);
  }

  /** 组合密码：必须**正好 4 位数字**；不合法返回 null */
  function normalizeCombination(s) {
    const v = String(s == null ? '' : s).trim();
    return /^\d{4}$/.test(v) ? v : null;
  }

  /* ---------- T1-A：按锁型改"锁资产自己的 RemoveTimer" ----------
     直接改 `Asset.RemoveTimer` 是最干净的做法，因为**游戏自己就用它当初始值**：
       Inventory.js:1485  TimerInventoryRemoveSet(C, group, Lock.Asset.RemoveTimer)
       Timer.js:166       item.Property.RemoveTimer = CurrentTime + Timer * 1000
     而且这两个地方也读它，改了会一并生效：
       TimerPadlock.js:63           "Restart Timer" 按钮恢复到的时长
       Mistress/OwnerTimerPadlock   "随机 ±" 按钮的步长（asset.RemoveTimer * 3 / 60 分钟）
     注意这是**运行时**改动（刷新即失效），所以 Settings 里记一份、加载后重放。 */

  function findLockAsset(name) {
    const list = gGet('Asset');
    if (!Array.isArray(list)) return null;
    try { return list.find((a) => a && a.IsLock && a.Name === name) || null; } catch (e) { return null; }
  }

  /** 把某锁型的资产 RemoveTimer 同步成配置值。返回状态字符串（便于诊断） */
  function applyAssetTimerOverride(name) {
    const want = (settings.assetTimers || {})[name];
    if (typeof want !== 'number' || want <= 0) return 'no-override';
    const asset = findLockAsset(name);
    if (!asset) return 'asset-not-loaded';
    const max = Number(asset.MaxTimer) || 0;
    if (max > 0 && want > max) return 'over-max:' + formatHms(max);
    if (asset.RemoveTimer === want) return 'ok';
    const before = Number(asset.RemoveTimer) || 0;
    try { asset.RemoveTimer = want; } catch (e) { return 'write-failed'; }
    log('锁资产默认时长 ' + name + '：' + formatHms(before) + ' → ' + formatHms(want));
    return 'ok';
  }

  function applyAllAssetTimerOverrides() {
    const names = Object.keys(settings.assetTimers || {});
    for (const name of names) {
      const r = applyAssetTimerOverride(name);
      if (r === 'ok' || r === 'asset-not-loaded') {
        if (!state.assetApplied[name] && r === 'ok') state.assetApplied[name] = true;
        continue;
      }
      if (!state.assetWarned[name]) {
        state.assetWarned[name] = true;
        warn('锁资产默认时长未能应用 [' + name + ']：' + r);
      }
    }
  }

  /** 游戏里所有锁资产的概况（用户用它挑选要改哪个锁型） */
  function listLockAssets() {
    const list = gGet('Asset');
    if (!Array.isArray(list)) return [];
    const out = [];
    try {
      for (const a of list) {
        if (!a || !a.IsLock) continue;
        out.push({
          name: a.Name,
          removeTimer: Number(a.RemoveTimer) || 0,
          maxTimer: Number(a.MaxTimer) || 0,
          timerLock: (Number(a.RemoveTimer) || 0) > 0,
        });
      }
    } catch (e) { /* 忽略 */ }
    return out;
  }

  function assetTimerList() {
    const all = listLockAssets().filter((a) => a.timerLock);
    const ov = settings.assetTimers || {};
    if (!all.length) return '（拿不到锁资产列表：Asset 还没加载？）';
    return all.map((a) => {
      const set = (typeof ov[a.name] === 'number') ? formatHms(ov[a.name]) : '—';
      return '  ' + a.name.padEnd(24) +
        ' 当前=' + formatHms(a.removeTimer) +
        ' 上限=' + formatHms(a.maxTimer) +
        ' 我的设置=' + set;
    }).join('\n');
  }

  function assetTimerSet(lockName, hms) {
    const asset = findLockAsset(lockName);
    if (!asset) {
      return '⚠ 找不到锁资产 "' + lockName + '"（可能这个锁的界面脚本还没加载过；' +
        '先用 __DLS.assetTimers.available() 看清单）';
    }
    const max = Number(asset.MaxTimer) || 0;
    const r = resolveHmsDuration(hms, max);
    if (!r.ok) return '⚠ ' + r.reason;
    settings.assetTimers[lockName] = r.seconds;
    saveSettings();
    const applied = applyAssetTimerOverride(lockName);
    log('（T1-A）锁型默认时长 ' + lockName + ' 设为 ' + r.hms + '，应用结果=' + applied);
    return '已设置 ' + lockName + ' = ' + r.hms + '（该锁上限 ' + formatHms(max) + '）应用=' + applied +
      '\n注意：这是运行时改动，之后你自己上这种锁时初始时长就是它；刷新页面后由本脚本自动重放。';
  }

  function assetTimerSetFocused(hms) {
    const item = gGet('DialogFocusSourceItem');
    const lockName = item && item.Property && item.Property.LockedBy;
    if (!lockName) return '⚠ 现在没有聚焦的带锁物品 —— 先在物品栏里打开一个上了锁的物品';
    return assetTimerSet(lockName, hms);
  }


  /* ====================== 共用小工具（误删后按原文补回） ====================== */

  /** 毫秒 → "X 天 Y 小时 Z 分"（负数带 − 号） */
  function fmtDuration(ms) {
    const s = Math.max(0, Math.round(Math.abs(Number(ms) || 0) / 1000));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts = [];
    if (d) parts.push(d + ' 天');
    if (h) parts.push(h + ' 小时');
    if (m && !d) parts.push(m + ' 分');
    if (!parts.length) parts.push(s + ' 秒');
    return (ms < 0 ? '−' : '') + parts.join(' ');
  }

  function safeCall(obj, name) {
    try { return typeof obj[name] === 'function' ? !!obj[name]() : false; } catch (e) { return false; }
  }

  /** 调用游戏自己的某个全局判定函数；不存在或抛错时返回 null（表示问不到，交给调用方兜底） */
  function callGlobalBool(name) {
    const f = gGet(name);
    if (typeof f !== 'function') return null;
    try { return !!f.apply(null, Array.prototype.slice.call(arguments, 1)); } catch (e) { return null; }
  }

  /* ---------- 每种锁**自己的**权限条件 ----------
     逐条抄自该锁 ClickHook 源码（refs/bc/Screens/Inventory/ItemMisc/*）：
       TimerPadlock.js:43          if (!Player.CanInteract()) return;
       OwnerTimerPadlock.js:46/56  Player.CanInteract() && validator(C)
       LoversTimerPadlock.js:7     validator = IsLoverOfPlayer() || IsOwnedByPlayer()
       MistressTimerPadlock.js:52  Player.CanInteract() && (LogQuery("ClubMistress","Management") || MemberNumber == LockMemberNumber)
       TimerPasswordPadlock.js:104 Player.CanInteract() && (MemberNumber == LockMemberNumber)
       PasswordPadlock / SafewordPadlock：ClickHook 里没有额外条件（界面本身就限定了）
     ⇒ 名单外的锁（Exclusive / Family / HighSecurity / Combination …）退回通用判定。 */
  const LOCK_RULES = {
    TimerPadlock: {
      timer: (i, C, h) => h.canInteract || '你处于 Block 状态（Player.CanInteract 为假）',
    },
    OwnerTimerPadlock: {
      timer: (i, C, h) => (h.canInteract && h.ownerValidator) ||
        '需要你先拥有该角色（Player.CanInteract + IsOwnedByPlayer）',
    },
    LoversTimerPadlock: {
      timer: (i, C, h) => (h.canInteract && h.loverValidator) ||
        '需要你是该角色的恋人（或主人），且不在 Block 状态',
    },
    MistressTimerPadlock: {
      timer: (i, C, h) => (h.canInteract && (h.isClubMistress || h.lockedByMe)) ||
        '需要这把锁是你上的，或者你是俱乐部女主人（ClubMistress）',
    },
    TimerPasswordPadlock: {
      timer: (i, C, h) => (h.canInteract && h.lockedByMe) || '需要这把锁是你上的',
      password: (i, C, h) => (h.canInteract && h.lockedByMe) || '需要这把锁是你上的',
    },
  };

  /** 锁的权限判据。用途：
      ① 锁界面里那个"精确时长输入框"；
      ② 通过 __DLS.api.gateForLock 暴露给**将来独立的格式刷插件** ——
         免得两边各写一套权限判定，日后漂移。
      mode: 'timer' | 'password' | 'combination'；通过返回 null，被拒返回原因字符串 */
  function lockGate(item, lock, C, mode) {
    const player = gGet('Player');
    if (!player) return '拿不到 Player';

    // 通用 1：目标物品的可操作权限（= 游戏自己的 C.AllowItem，ChatRoom.js:1759）
    if (typeof C.IsPlayer === 'function' ? !C.IsPlayer() : true) {
      const allowItem = gGet('ServerChatRoomGetAllowItem');
      if (typeof allowItem === 'function') {
        try {
          if (!allowItem(player, C)) return '房间物品权限不允许你操作该角色（= 游戏的 C.AllowItem 为假）';
        } catch (e) { /* 忽略，继续 */ }
      }
    }
    // 通用 2：部位被封锁 → 原版连输入框都不创建（PasswordPadlock.js:16）
    const blockedFn = gGet('InventoryGroupIsBlocked');
    if (typeof blockedFn === 'function') {
      try {
        const group = item.Asset && item.Asset.Group ? item.Asset.Group.Name : null;
        if (group && blockedFn(C, group)) return '该部位被封锁（InventoryGroupIsBlocked）';
      } catch (e) { /* 忽略 */ }
    }
    // 通用 3：物品本身是否允许上锁（Inventory.js:1412）
    const allowLock = gGet('InventoryDoesItemAllowLock');
    if (typeof allowLock === 'function') {
      try { if (!allowLock(item)) return '该物品本身不允许上锁（InventoryDoesItemAllowLock）'; } catch (e) { /* 忽略 */ }
    }
    // 通用 4：几种锁共用的前置条件
    const h = {
      canInteract: typeof player.CanInteract === 'function' ? !!player.CanInteract() : true,
      lockedByMe: item.Property.LockMemberNumber === player.MemberNumber,
      isClubMistress: callGlobalBool('LogQuery', 'ClubMistress', 'Management') === true,
      ownerValidator: (function () {
        const r = callGlobalBool('InventoryItemMiscOwnerTimerPadlockValidator', C);
        return r === null ? safeCall(C, 'IsOwnedByPlayer') : r;
      })(),
      loverValidator: (function () {
        const r = callGlobalBool('InventoryItemMiscLoversTimerPadlockValidator', C);
        return r === null ? (safeCall(C, 'IsLoverOfPlayer') || safeCall(C, 'IsOwnedByPlayer')) : r;
      })(),
    };
    // 该锁自己的条件
    const rule = LOCK_RULES[lock.Asset.Name];
    if (rule && typeof rule[mode] === 'function') {
      const r = rule[mode](item, C, h);
      if (r !== true) return r;
      return null;
    }
    // 名单外的锁：退回通用判定
    if (!mode || mode === 'timer') {
      if (!h.canInteract) return '你处于 Block 状态（Player.CanInteract 为假）';
    }
    return null;
  }

  /* ====================== T1 的准备：严格的 hh:mm:ss 解析（误删后按原文补回） ======================
     用户要求"按 hh:mm:ss 输入…并写死格式"，也就是**只认这一种写法**：
       · 小时至少两位（所以 72:00:00 / 100:00:00 这类长时长可以写）
       · 分、秒必须两位且 ≤ 59
       · 不接受 "1h" / "90" / "1:30" 这类简写
     换算后要跟该锁自己的 `Asset.MaxTimer` 比。 */
  const HMS_RE = /^(\d{2,4}):([0-5]\d):([0-5]\d)$/;

  /** '01:30:00' → 5400；格式不合法返回 null */
  function parseHms(text) {
    const m = HMS_RE.exec(String(text == null ? '' : text).trim());
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }

  /** 5401 → '01:30:01'（补零；负数按绝对值处理） */
  function formatHms(totalSeconds) {
    const s = Math.max(0, Math.floor(Math.abs(Number(totalSeconds) || 0)));
    const p = (n) => String(n).padStart(2, '0');
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
  }

  /** 解析 + 对照该锁的上限。返回 {ok, seconds, hms} 或 {ok:false, reason, capped} */
  function resolveHmsDuration(text, maxTimerSeconds) {
    const seconds = parseHms(text);
    if (seconds === null) {
      return { ok: false, reason: '格式必须是 hh:mm:ss（例如 01:30:00、72:00:00）；不接受 "1h" / "90" / "1:30" 这类写法' };
    }
    if (seconds <= 0) return { ok: false, reason: '时长必须大于 0' };
    const max = Number(maxTimerSeconds) || 0;
    if (max > 0 && seconds > max) {
      return { ok: false, reason: '超出该锁允许的上限 ' + formatHms(max), capped: formatHms(max) };
    }
    return { ok: true, seconds: seconds, hms: formatHms(seconds) };
  }

  /** 游戏内提示：走游戏的 ToastManager。
      ⚠️ 第二个参数是**选项对象**（不是标题字符串）—— 这个坑踩过一次：
         ToastManager.info(text, { title, duration, category, clampMessage }) */
  function inGameNotice(text, opts) {
    const o = opts || {};
    const tm = gGet('ToastManager');
    if (tm && typeof tm.info === 'function') {
      try {
        tm.info(String(text), {
          title: o.title || 'DLS',
          duration: o.duration || 8000,
          category: 'dls',
          clampMessage: true,
        });
        return true;
      } catch (e) { /* 落到下面的兜底 */ }
    }
    try { console.log(TAG, text); } catch (e) { /* 忽略 */ }
    return false;
  }

  /** 对话框当前聚焦的角色（= 你在物品栏里打开的那个人；没有就返回 null） */
  function currentTarget() {
    const fn = gGet('CharacterGetCurrent');
    if (typeof fn === 'function') {
      try { const c = fn(); if (c) return c; } catch (e) { /* 忽略 */ }
    }
    return null;
  }

  /* ====================== 调试 / 报告接口 ====================== */

  function report() {
    const lines = [];
    const P = (s) => lines.push(s);
    P('DLS v' + VERSION + '  ——  ' + new Date().toString());
    P('URL: ' + location.href);
    P('SDK: ' + (state.sdkVersion ? ('已注册，sdk.version=' + state.sdkVersion) : '未注册'));
    P('enabled: ' + settings.enabled + ' | eval 可用: ' + evalWorks());
    P('');
    P('已挂钩 (' + state.hooked.size + '): ' + Array.from(state.hooked).join(', '));
    P('');
    P('--- 计时锁选择器 ---');
    for (const c of CHOOSERS) {
      const options = gGet(c.options);
      const loaded = Array.isArray(options);
      P('[' + c.key + '] 配置 = ' + JSON.stringify(settings.timerDefaults[c.key]) +
        ' | 已加载 = ' + loaded + ' | 已应用 = ' + chooserDone.has(c.key));
      if (loaded) {
        P('    单位: ' + options.map((o) => (o.unit && o.unit.label) + '=' + (o.values || []).join('/')).join('  |  '));
        P('    当前 index = ' + gGet(c.index) + ' , indexes = ' + JSON.stringify(gGet(c.indexes)));
      }
    }
    P('');
    P('--- 密码锁 ---');
    P('配置 = ' + JSON.stringify(settings.password) + ' → 规范化后 = "' + normalizePassword(settings.password.value) + '"');
    for (const id of ['SetPassword', 'SetHint', 'Password']) {
      const el = document.getElementById(id);
      P('  输入框 #' + id + ' : ' + (el ? ('存在，当前值="' + el.value + '"') : '不存在'));
    }
    P('');
    P('--- 设置原文（localStorage） ---');
    try { P(localStorage.getItem(STORE_KEY) || '(空)'); } catch (e) { P('(读不到)'); }
    return lines.join('\n');
  }

  /* ========================== A2 的快捷键入口 ==========================
     为什么不用 GameKeyDown：它的签名不在我已核对的源码里，而且已有 3 个插件挂了它。
     自己装一个 window 监听器更省事，也不和别人的 hook 抢。
     修饰键判定沿用游戏自己的 CommonKey（CTRL=2 / SHIFT=8，且要求**完全匹配**）；
     "没有输入框聚焦才处理"这个守卫也照搬 BC 自己的写法（Common.js:1982-1986）。 */

  const hotkeyPending = { mode: null, at: 0, plan: null };

  /* Firefox 页面**拦不住**的 Ctrl+Shift+<字母>：P=隐私窗口、R=硬刷新、T=恢复标签、
     W=关窗口、N=新窗口、Q=退出、I/J/K/C/S/E/M=开发者工具、Y=下载、Z=重做、
     V=纯文本粘贴、A=附加组件、B=书签工具栏、D=收藏所有标签。
     默认选 L / X —— 它们不在 Firefox 的快捷键表里。 */

  /* ============ 嵌在**原版锁界面**里的 hh:mm:ss 输入框（用户要求） ============
     为什么用游戏自己的 Element* API 而不是自造 DOM：密码锁的输入框就是这么做的
     （ElementCreateInput + ElementPosition + ElementValue + ElementRemove），
     坐标走 canvas 坐标系、会自动映射到屏幕并处理缩放，也不用猜 DOM 层级。
     两个坐标系约定（读了 Element.js:888-924 才知道，容易搞错）：
       · ElementPosition(ID, X, Y, W) —— (X, Y) 是元素的**中心**（left = X - W/2）
       · DrawButton(x,y,w,h) / MouseIn(x,y,w,h) —— (x, y) 是**左上角**
     用法：填 hh:mm:ss → 点「DLS 应用」→ 把**当前聚焦物品上那把锁**的剩余时间设成它。
     留空则什么都不做（你照样可以用游戏的「添加」按钮）。 */
  const BOX_ID = 'DLS_TimerHms';
  const lockBoxState = { created: false, visible: false };

  function lockBoxCfg() {
    const c = (settings.lockBox && typeof settings.lockBox === 'object') ? settings.lockBox : {};
    return {
      cx: Number(c.cx) || 1260,
      cy: Number(c.cy) || 330,
      w: Number(c.w) || 320,
      bw: Number(c.bw) || 180,
      bh: Number(c.bh) || 56,
    };
  }

  /** 挂在各计时锁的 …Draw 上，每帧调用：创建并摆好输入框、画出按钮 */
  function lockBoxDraw() {
    if (!settings.enabled) return;
    if (settings.lockBox && settings.lockBox.enabled === false) return;
    const c = lockBoxCfg();
    try {
      if (!lockBoxState.created) {
        const create = gGet('ElementCreateInput');
        if (typeof create !== 'function') return;
        create(BOX_ID, 'text', '', '8');                 // hh:mm:ss 正好 8 位
        try {
          const el = document.getElementById(BOX_ID);
          if (el && el.setAttribute) {
            el.setAttribute('placeholder', 'hh:mm:ss');
            el.style.background = 'rgba(32,24,44,.95)';
            el.style.border = '1px solid #8a7aa0';
            el.style.color = '#f0e8ff';
          }
        } catch (e) { /* 样式失败不影响功能 */ }
        lockBoxState.created = true;
        log('已在原版锁界面加入 DLS 精确时长输入框（填 hh:mm:ss 后点「DLS 应用」）');
      }
      const pos = gGet('ElementPosition');
      if (typeof pos === 'function') pos(BOX_ID, c.cx, c.cy, c.w);
      const db = gGet('DrawButton');
      if (typeof db === 'function') db(c.cx + c.w / 2 + 12, c.cy - c.bh / 2, c.bw, c.bh, 'DLS 应用', 'White');
      lockBoxState.visible = true;
    } catch (e) { /* 忽略 */ }
  }

  function lockBoxRemove() {
    lockBoxState.visible = false;
    if (!lockBoxState.created) return;
    lockBoxState.created = false;
    try {
      const rm = gGet('ElementRemove');
      if (typeof rm === 'function') rm(BOX_ID);
    } catch (e) { /* 忽略 */ }
  }

  /** 点「DLS 应用」时：把当前聚焦锁的剩余时间设成输入框里的 hh:mm:ss */
  function lockBoxApply() {
    const read = gGet('ElementValue');
    const txt = (typeof read === 'function') ? String(read(BOX_ID) || '') : '';
    if (!txt) { inGameNotice('DLS：输入框是空的 —— 填 hh:mm:ss，或用游戏的「添加」按钮'); return false; }

    const C = currentTarget();
    const item = gGet('DialogFocusSourceItem');
    if (!C || !item || !item.Property) { inGameNotice('DLS：现在没有聚焦的锁'); return false; }

    const getLock = gGet('InventoryGetLock');
    let lock = null;
    try { lock = (typeof getLock === 'function') ? getLock(item) : null; } catch (e) { lock = null; }
    if (!lock || !lock.Asset) { inGameNotice('DLS：这把锁不是计时锁'); return false; }
    if (!(Number(lock.Asset.RemoveTimer) > 0)) { inGameNotice('DLS：这把锁不支持计时'); return false; }

    const max = Number(lock.Asset.MaxTimer) || 0;
    const r = resolveHmsDuration(txt, max);
    if (!r.ok) { inGameNotice('DLS：' + r.reason); return false; }

    // 权限：用和格式刷**同一套**闸门 —— 对应"只要是玩家有权限的锁都允许修改"
    const deny = lockGate(item, lock, C, 'timer');
    if (deny) { inGameNotice('DLS 被拒绝：' + deny); return false; }

    const now = Number(gGet('CurrentTime')) || Date.now();
    const cap = max > 0 ? now + max * 1000 : Infinity;
    const want = now + r.seconds * 1000;
    const target = Math.round(Math.min(want, cap));
    const truncated = cap !== Infinity && want > cap;

    item.Property.RemoveTimer = target;
    try {
      const upd = gGet('ChatRoomCharacterItemUpdate');
      if (typeof upd === 'function') upd(C, item.Asset.Group.Name);
      const rf = gGet('CharacterRefresh');
      if (typeof rf === 'function') rf(C);
    } catch (e) { warn('精确时长同步失败', e && e.message); }

    const msg = 'DLS：[' + ((item.Asset.Group && item.Asset.Group.Name) || '?') + '] 的 ' + lock.Asset.Name +
      ' 已设为 ' + r.hms + (truncated ? '（被该锁上限 ' + formatHms(max) + ' 截断）' : '');
    inGameNotice(msg);
    log(msg);
    return true;
  }

  /* ========================== 前端悬浮控件（DOM） ==========================
     为什么自己做 DOM 而不是画布按钮：BC 的对话框是 canvas 自绘的，按钮位置只能靠试坐标；
     DOM 浮层不受画布坐标影响、样式随时可改、也方便做开关。
     所有指针事件都 stopPropagation，避免点到游戏画布的鼠标处理上。 */
  function installUi() {
    if (state.ui) return true;
    if (settings.ui === false) return false;
    let body = null;
    try { body = document.body; } catch (e) { body = null; }
    if (!body || typeof document.createElement !== 'function') return false;   // 文档还没就绪，下次 tick 再试

    try {
      const mk = (tag, css, text) => {
        const el = document.createElement(tag);
        if (css) { try { el.style.cssText = css; } catch (e) { /* 忽略 */ } }
        if (text != null) el.textContent = text;
        return el;
      };
      const swallow = (el) => {
        for (const ev of ['mousedown', 'mouseup', 'click', 'dblclick', 'wheel']) {
          try { el.addEventListener(ev, (e) => { try { e.stopPropagation(); } catch (e2) { /* 忽略 */ } }); } catch (e) { /* 忽略 */ }
        }
      };
      const BTN = 'cursor:pointer;border:1px solid #5a6070;border-radius:6px;background:#2b3040;'
        + 'color:#e8e8e8;padding:3px 9px;font:inherit;';
      const INP = 'background:#12141a;color:#e8e8e8;border:1px solid #5a6070;border-radius:6px;'
        + 'padding:2px 5px;font:inherit;';

      const wrap = mk('div', 'position:fixed;right:14px;bottom:14px;z-index:99999;'
        + 'font:12px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#e8e8e8;text-align:right;');
      wrap.id = 'dls-ui';

      const bar = mk('div', 'display:inline-flex;gap:6px;align-items:center;'
        + 'background:rgba(18,20,26,.92);border:1px solid #4a4f5c;border-radius:10px;padding:6px 8px;'
        + 'box-shadow:0 2px 12px rgba(0,0,0,.55);');
      const fab = mk('button', BTN);
      fab.id = 'dls-fab';
      const gear = mk('button', BTN, '设置');
      gear.id = 'dls-gear';
      bar.appendChild(fab); bar.appendChild(gear);

      const panel = mk('div', 'display:none;margin-top:8px;text-align:left;'
        + 'background:rgba(18,20,26,.96);border:1px solid #4a4f5c;border-radius:10px;padding:10px 12px;'
        + 'width:292px;box-shadow:0 2px 12px rgba(0,0,0,.55);');
      panel.id = 'dls-panel';

      const row = (label, node) => {
        label = L(label);
        const r = mk('div', 'display:flex;justify-content:space-between;align-items:center;gap:8px;margin:6px 0;');
        r.appendChild(mk('span', 'opacity:.85;flex:1;', label));
        r.appendChild(node);
        return r;
      };
      const numIn = (val) => {
        const el = mk('input', INP + 'width:58px;');
        el.type = 'number'; el.min = '1'; el.max = '9999'; el.value = String(val);
        return el;
      };
      /* 下拉框里的单位**从游戏里取**（unitLabels()），不是写死的三个。
         面板展开时会重填一次 —— 那时按需加载的锁界面脚本通常已经到位。 */
      const clearNode = (el) => {
        try { if (typeof el.replaceChildren === 'function') { el.replaceChildren(); return; } } catch (e) { /* 忽略 */ }
        try { el.innerHTML = ''; } catch (e) { /* 忽略 */ }
        try { if (Array.isArray(el.children)) el.children.length = 0; } catch (e) { /* 忽略 */ }
      };
      const fillUnitSelect = (el, want) => {
        const target = want || el.__dlsUnit || el.value || 'Hours';
        clearNode(el);
        const labels = unitLabels();
        let matched = false;
        for (const u of labels) {
          const o = mk('option', null, u);
          o.value = u;
          if (u === target) { o.selected = true; matched = true; }
          el.appendChild(o);
        }
        if (!matched && labels.length) el.value = labels[0];   // 配置的单位此刻还不可用（脚本没加载）
        el.__dlsUnit = target;                                  // 记住配置值，别被下拉框的显示值覆盖
        return el;
      };
      const selUnit = (val) => fillUnitSelect(mk('select', INP), val);
      const pair = (a, b) => {
        const w = mk('span', 'display:flex;gap:4px;align-items:center;');
        w.appendChild(a); w.appendChild(b);
        return w;
      };

      const iniNum = numIn(settings.timerDefaults.initial.value);
      const iniUnit = selUnit(settings.timerDefaults.initial.unit);
      panel.appendChild(row('初始时长（其它计时锁）', pair(iniNum, iniUnit)));   // ★ 与设置页同一叫法（设置页里主人锁/恋人锁各有单独行）

      /* ★ 用户要求"检查悬浮框与详情页是否一致" —— 查出的问题：
         这一行原来叫「选择器默认（Owner/恋人）」，但它实际只改 settings.timerDefaults.owner，
         恋人锁那套（settings.timerDefaults.lovers）根本没被改到，标签是误导。现在拆成两行。 */
      const chNum = numIn(settings.timerDefaults.owner.value);
      const chUnit = selUnit(settings.timerDefaults.owner.unit);
      panel.appendChild(row('选择器增量（主人锁）', pair(chNum, chUnit)));

      const lvNum = numIn(settings.timerDefaults.lovers.value);
      const lvUnit = selUnit(settings.timerDefaults.lovers.unit);
      panel.appendChild(row('选择器增量（恋人锁）', pair(lvNum, lvUnit)));

      const pwIn = mk('input', INP + 'width:112px;');
      pwIn.type = 'text'; pwIn.maxLength = 8; pwIn.value = settings.password.value || '';
      panel.appendChild(row('密码锁默认密码', pwIn));

      const hintIn = mk('input', INP + 'width:150px;');
      hintIn.type = 'text'; hintIn.maxLength = HINT_MAX;
      hintIn.placeholder = '自由文本 ≤140'; hintIn.value = settings.password.hint || '';
      panel.appendChild(row('默认提示语 Hint', hintIn));

      const combIn = mk('input', INP + 'width:70px;');
      combIn.type = 'text'; combIn.maxLength = 4;
      combIn.placeholder = '4 位数字'; combIn.value = settings.combination.value || '';
      panel.appendChild(row('组合锁默认组合', combIn));

      /* ---- T1 ---- */


      const assetIn = mk('input', INP + 'width:88px;');
      assetIn.type = 'text'; assetIn.placeholder = 'hh:mm:ss'; assetIn.value = '01:00:00';
      const assetBtn = mk('button', BTN + 'background:#4a4a3a;', '设为该锁型默认');
      panel.appendChild(row('锁型默认（T1-A）', pair(assetIn, assetBtn)));

      const status = mk('div', 'margin:8px 0 4px;padding:6px;background:#12141a;border:1px solid #3a3f4c;'
        + 'border-radius:6px;white-space:pre-wrap;max-height:130px;overflow:auto;font-size:11px;', '（还没有输出）');
      panel.appendChild(status);

      wrap.appendChild(bar); wrap.appendChild(panel);
      swallow(wrap);
      body.appendChild(wrap);
      state.ui = wrap;

      const save = () => { saveSettings(); refreshUi(); };
      const on = (el, ev, fn) => { try { el.addEventListener(ev, fn); } catch (e) { /* 忽略 */ } };

      /* ★ 原版锁界面上那两个勾选框（上锁时直接写状态，和你在界面上勾选等价）
         · 解锁时移除物品 → Property.RemoveOnUnlock（PasswordPadlock.js:87 画 / :120 切换 / :134 用）
         · 计时结束时移除物品 → Property.RemoveItem（Timer.js:106 读 / :117-119 真的移除） */
      const mkCheck = (cur, apply) => {
        const el = mk('input', 'width:auto;accent-color:#6a8;');
        el.type = 'checkbox';
        el.checked = !!cur;
        on(el, 'change', () => {
          apply(!!el.checked);
          save();
          status.textContent = '已设为「' + (el.checked ? '勾上' : '不勾') + '」（只影响之后新上的锁）';
        });
        return el;
      };
      panel.appendChild(row('解锁时移除物品', mkCheck(settings.password.removeOnUnlock, (v) => {
        settings.password.removeOnUnlock = v;
      })));
      panel.appendChild(row('计时结束时移除物品', mkCheck(settings.timerDefaults.initial.removeItem, (v) => {
        settings.timerDefaults.initial.removeItem = v;
      })));

      on(fab, 'click', (e) => {
        try { e.stopPropagation(); } catch (e2) { /* 忽略 */ }
        settings.enabled = !settings.enabled;
        save();
        tick('界面开关');
      });
      on(gear, 'click', (e) => {
        try { e.stopPropagation(); } catch (e2) { /* 忽略 */ }
        panel.style.display = (panel.style.display === 'block') ? 'none' : 'block';
        // 展开时重填单位下拉：这时按需加载的锁界面脚本通常已到位，单位表才是完整的
        fillUnitSelect(iniUnit, settings.timerDefaults.initial.unit);
        fillUnitSelect(chUnit, settings.timerDefaults.owner.unit);
        fillUnitSelect(lvUnit, settings.timerDefaults.lovers.unit);
      });
      on(iniNum, 'change', () => {
        settings.timerDefaults.initial.enabled = true;
        settings.timerDefaults.initial.value = Math.max(1, Number(iniNum.value) || 1);
        save();
        status.textContent = '初始时长已改为 ' + settings.timerDefaults.initial.value + ' ' +
          settings.timerDefaults.initial.unit + '（下次上锁生效）';
      });
      on(iniUnit, 'change', () => { settings.timerDefaults.initial.unit = iniUnit.value; save(); });
      on(chNum, 'change', () => {
        settings.timerDefaults.owner.value = Math.max(1, Number(chNum.value) || 1);
        save();
      });
      on(chUnit, 'change', () => { settings.timerDefaults.owner.unit = chUnit.value; save(); });
      on(lvNum, 'change', () => {
        settings.timerDefaults.lovers.value = Math.max(1, Number(lvNum.value) || 1);
        save();
      });
      on(lvUnit, 'change', () => { settings.timerDefaults.lovers.unit = lvUnit.value; save(); });
      on(pwIn, 'change', () => { settings.password.value = pwIn.value; save(); });
      on(hintIn, 'change', () => {
        settings.password.hint = normalizeHint(hintIn.value);   // 自由文本，只限 140
        hintIn.value = settings.password.hint;
        save();
      });
      on(combIn, 'change', () => {
        const raw = String(combIn.value == null ? '' : combIn.value).trim();
        const code = normalizeCombination(raw);
        if (!code && raw !== '') {
          status.textContent = '⚠ 组合必须是正好 4 位数字（已忽略这次输入）';
          combIn.value = settings.combination.value || '';
          return;
        }
        settings.combination.value = code || '';                // 留空 = 取消默认
        combIn.value = settings.combination.value;
        save();
        status.textContent = code ? ('组合锁默认值 = ' + code) : '已取消组合锁默认值';
      });

      on(assetBtn, 'click', (e) => {
        try { e.stopPropagation(); } catch (e2) { /* 忽略 */ }
        status.textContent = String(assetTimerSetFocused(assetIn.value));
      });



      /* ★ 用户要求：悬浮条可拖动，避免挡住游戏内容。
         位置存 settings.uiPos（null = 默认右下角）；拖动 >4px 才算拖，纯点击不受影响。 */
      const applyUiPos = () => {
        try {
          const p = settings.uiPos;
          if (p && typeof p.left === 'number' && typeof p.top === 'number') {
            wrap.style.right = 'auto'; wrap.style.bottom = 'auto';
            wrap.style.left = Math.max(0, p.left) + 'px';
            wrap.style.top = Math.max(0, p.top) + 'px';
          } else {
            wrap.style.left = 'auto'; wrap.style.top = 'auto';
            wrap.style.right = '14px'; wrap.style.bottom = '14px';
          }
        } catch (e) { /* 忽略 */ }
      };
      applyUiPos();
      state.applyUiPos = applyUiPos;      // ★ 复位时要用它（syncUi 不会重建已存在的 UI）
      {
        let dragging = false, moved = false, suppressClick = false, sx = 0, sy = 0, ox = 0, oy = 0;
        const onMove = (ev) => {
          if (!dragging) return;
          const dx = ev.clientX - sx, dy = ev.clientY - sy;
          /* ★ 阈值改成"单轴 > 5px"：原来用 |dx|+|dy| < 4，鼠标手抖几个像素就判定成拖动，
             于是紧跟的 click 被吞掉 —— 用户实测"点设置收不起面板"。 */
          if (!moved && Math.abs(dx) <= 5 && Math.abs(dy) <= 5) return;
          moved = true;
          settings.uiPos = { left: Math.max(0, ox + dx), top: Math.max(0, oy + dy) };
          applyUiPos();
        };
        const onUp = () => {
          if (dragging && moved) {
            saveSettings();
            status.textContent = '悬浮条位置已记住（复位：设置 → 界面 →「悬浮条位置复位」）';
          }
          dragging = false;
          /* ★ 用户要求："拖拽按钮时只视为拖拽，不打开"。
             注意：mouseup 早于 click，而这里就把 moved 复位了 —— 所以不能靠 moved 判断，
             必须用一个独立的锁存标志，等那次 click 来了再清掉。 */
          if (moved) suppressClick = true;
          moved = false;
        };
        /* ★ 用户反馈：面板展开后也应该能拖（原来只有那根小条能拖）。
           所以监听挂在 wrap 上，但**输入框 / 按钮 / 下拉框**上按下时不启动拖拽，
           否则会给打字和点击添麻烦。 */
        const isInteractive = (el) => {
          try {
            const tag = String((el && el.tagName) || '').toUpperCase();
            // ★ 按钮**不**排除：用户要求"抓住按钮也能拖"。排除的只是需要焦点的输入类控件。
            return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'OPTION';
          } catch (e) { return false; }
        };
        on(wrap, 'mousedown', (ev) => {
          if (ev.button !== 0) return;
          if (isInteractive(ev.target)) return;      // 控件上按下 → 交给控件自己处理
          let box = { left: 0, top: 0 };
          try { if (typeof wrap.getBoundingClientRect === 'function') box = wrap.getBoundingClientRect(); } catch (e) { /* 忽略 */ }
          dragging = true; moved = false; suppressClick = false;
          sx = ev.clientX; sy = ev.clientY; ox = box.left; oy = box.top;
        });
        /* ★ 必须用**捕获阶段**监听：悬浮条自己挂了 swallow()，它会把 mouseup 的**冒泡**拦下，
           于是 document 上的普通监听永远收不到 → 松开左键也停不下来（用户实测的严重 bug）。 */
        try {
          document.addEventListener('mousemove', onMove, true);
          document.addEventListener('mouseup', onUp, true);
        } catch (e) {
          on(document, 'mousemove', onMove);
          on(document, 'mouseup', onUp);
        }
        /* 拖过之后紧跟的那次 click 不要触发按钮（capture 阶段拦掉） */
        try {
          wrap.addEventListener('click', (ev) => {
            if (!suppressClick) return;
            suppressClick = false;
            try { ev.stopPropagation(); ev.preventDefault(); } catch (e2) { /* 忽略 */ }
          }, true);
        } catch (e) { /* 忽略 */ }
        state.offs.push(function () {
          try { document.removeEventListener('mousemove', onMove, true); } catch (e) { /* 忽略 */ }
          try { document.removeEventListener('mouseup', onUp, true); } catch (e) { /* 忽略 */ }
          try { document.removeEventListener('mousemove', onMove); } catch (e) { /* 忽略 */ }
          try { document.removeEventListener('mouseup', onUp); } catch (e) { /* 忽略 */ }
        });
      }

      refreshUi();
      log('悬浮控件已创建（右下角；可拖动）');
      return true;
    } catch (e) {
      warn('创建界面失败（不影响其余功能）', e && e.message);
      return false;
    }
  }

  function refreshUi() {
    if (!state.ui) return;
    try {
      const fab = document.getElementById('dls-fab');
      if (fab) {
        fab.textContent = L(settings.enabled ? '锁工具：开' : '锁工具：关');
        fab.style.background = settings.enabled ? '#2f5a37' : '#5a2f2f';
      }

    } catch (e) { /* 忽略 */ }
  }

  function removeUi() {
    try { if (state.ui && typeof state.ui.remove === 'function') state.ui.remove(); } catch (e) { /* 忽略 */ }
    state.ui = null;
  }

  /** 按设置同步右下角悬浮条：开着就建、关掉就**立刻移除**（设置页里那个勾选即时生效） */
  function syncUi() {
    if (settings.ui === false) { removeUi(); return false; }
    return installUi();
  }

  /* ==================== 「设置 → 拓展组件」里的 DLS 设置页 ====================
     关键事实（本地类型镜像 Preference.d.ts:85 / :118 / :125-202）：
       · 那个菜单列的是注册表 `PreferenceExtensionsSettings`，条目靠
         `PreferenceRegisterExtensionSetting({Identifier, ButtonText, load, click, run, unload, exit, resize})` 注册
       · **只调 bcModSdk.registerMod 不会出现在那里** —— 那是"挂钩子"的另一套体系
       · 官方注释明确写了：可以在 `load` 里创建自己的 HTML 元素、在 `unload` 里删掉
         ⇒ 所以这一页用 **DOM 控件**做，完全不用猜 canvas 坐标
       · 退出必须由页面自己处理并调 `PreferenceSubscreenExit()`；ESC 也能退出（`exit` 返回 true 即放行）
     `Preference.js` 是随游戏加载的，所以注册动作放在 tick 里反复尝试，直到它出现。 */
  const PREF_ID = 'DLS';
  const prefState = { box: null, summary: null };

  /* ---- 控件工厂（给设置页用；悬浮面板有自己的一份，互不影响） ---- */
  const UI_BTN = 'cursor:pointer;border:1px solid #5a6070;border-radius:6px;background:#2b3040;'
    + 'color:#e8e8e8;padding:3px 9px;font:inherit;';
  const UI_INP = 'background:#12141a;color:#e8e8e8;border:1px solid #5a6070;border-radius:6px;'
    + 'padding:2px 5px;font:inherit;';
  const UI_BOX = 'background:rgba(18,20,26,.96);border:1px solid #4a4f5c;border-radius:10px;'
    + 'box-shadow:0 2px 14px rgba(0,0,0,.6);color:#e8e8e8;'
    + 'font:12px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;';

  /** 单位下拉框内容从游戏的 TimeUnits 取（和悬浮面板同一策略） */
  function uiFillUnits(sel, want) {
    const target = want || sel.__dlsUnit || 'Hours';
    try {
      if (typeof sel.replaceChildren === 'function') sel.replaceChildren();
      else {
        sel.innerHTML = '';
        if (Array.isArray(sel.children)) sel.children.length = 0;
      }
    } catch (e) {
      try { sel.innerHTML = ''; } catch (e2) { /* 忽略 */ }
    }
    const labels = unitLabels();
    let matched = false;
    for (const u of labels) {
      const o = document.createElement('option');
      o.value = u; o.textContent = u;
      if (u === target) { o.selected = true; matched = true; }
      sel.appendChild(o);
    }
    if (!matched && labels.length) sel.value = labels[0];
    sel.__dlsUnit = target;
    return sel;
  }

  /* ---- 分类（首页网格）----
     ★ 只放"已经过真机验证"的功能入口。格式刷 / 好友盯梢的代码都写好了、
     离线测试也过，但还没在游戏里实测 —— 按用户要求先把入口藏起来
     （命令仍然可用：__DLS.brush.* / __DLS.friend.*；想放出来把 hidden 去掉即可）。 */
  const PREF_CATS = [
    { key: 'ui', icon: '◉', label: '界面' },
    { key: 'timer', icon: '⏱', label: '计时锁' },
    { key: 'password', icon: '⚿', label: '密码锁' },
    { key: 'combination', icon: '⚏', label: '组合锁' },
    { key: 'about', icon: 'ℹ', label: '关于' },
    { key: 'brush', icon: '✎', label: '格式刷', hidden: true },
    { key: 'friend', icon: '☺', label: '好友盯梢', hidden: true },
  ];

  /* 画布布局（2000×1000）：**整体居中**（用户反馈原来太靠右）。
     内容总宽 880，左右各留出对称空间；行内标签在左、控件在右。 */
  const PREF_L = {
    cx: 1000, contentW: 880,
    titleY: 176,
    gridY: 224, bw: 420, bh: 74, gx: 40, gy: 16,
    rowY0: 208, rowH: 58,
    labelX: 560, ctrlX: 980, numW: 150,
    actY: 706, actW: 216, actH: 52, actGap: 16,
    msgY: 812,
    /* ★ 游戏子界面菜单栏的锚点：ElementSetPosition(`${subscreen}-menu`, 1905, 75, "top-right")
       （wip/i18n/Preference.js:346），按钮图标 Icons/Exit.png、direction rtl（:331）。 */
    mbRight: 1905, mbTop: 75, mbSize: 56, mbGap: 8,
  };
  /** 内容区左边界 */
  const PREF_X0 = () => PREF_L.cx - PREF_L.contentW / 2;

  /* ---------- 「关于」页的 GitHub 链接 ---------- */

  /** 画"跟游戏子界面菜单栏同款"的图标按钮。
      ★ 依据 wip/i18n/Preference.js:331：游戏那个退出键就是一张 `Icons/Exit.png`，
        **没有底板** —— 之前我多画了个深色方块，结果"框内底色是黑的、跟图标同色"（用户反馈）。
      right/top = 菜单栏锚点（1905,75，top-right 对齐）；size = 图标边长。 */
  function prefIconButton(right, top, size, onClick) {
    const x = right - size;
    const pad = 8;      // 命中区比图标略大，好点
    prefState.hits.push({ x: x - pad, y: top - pad, w: size + pad * 2, h: size + pad * 2, fn: onClick });
    /* 黑框（用户要求）。优选游戏的空心矩形，取不到就手工画 4 条细边（别用实心，会盖住图标）。 */
    const emptyRect = gGet('DrawEmptyRect');
    const rect = gGet('DrawRect');
    try {
      if (typeof emptyRect === 'function') emptyRect(x, top, size, size, 'Black');
      else if (typeof rect === 'function') {
        const tk = 2;
        rect(x, top, size, tk, 'Black');
        rect(x, top + size - tk, size, tk, 'Black');
        rect(x, top, tk, size, 'Black');
        rect(x + size - tk, top, tk, size, 'Black');
      }
    } catch (e) { /* 忽略 */ }

    /* 图标：★ 游戏用的是 DrawImageResize("路径", x, y, w, h) —— 本地 refs/bc 里全是这种用法，
       我之前写的 DrawImage **函数名是错的**（所以只看到黑底板）。
       水平翻转：游戏没有现成的翻转版，只能借 canvas 变换（translate 到右边界 + scale(-1,1)）。 */
    const resize = gGet('DrawImageResize');
    const cvs = gGet('MainCanvas');
    try {
      if (typeof resize === 'function' && cvs && typeof cvs.save === 'function') {
        cvs.save();
        cvs.translate(x + size, top);
        cvs.scale(-1, 1);
        resize('Icons/Exit.png', 0, 0, size, size);
        cvs.restore();
        return;
      }
    } catch (e) { try { cvs.restore(); } catch (e2) { /* 忽略 */ } }
    try { if (typeof resize === 'function') { resize('Icons/Exit.png', x, top, size, size); return; } } catch (e) { /* 忽略 */ }
    const btn = gGet('DrawButton');
    if (typeof btn === 'function') { try { btn(x, top, size, size, '✕', 'White'); } catch (e) { /* 忽略 */ } }
  }

  /** 右上角图标边长（用户可在「界面」页用 - / + 调；默认 80 = 用户指定） */
  function iconSize() {
    const v = Number(settings.iconSize);
    if (!isFinite(v) || v < 16) return 80;
    return Math.min(128, Math.round(v));
  }

  /** 规范化仓库地址：允许只写 github.com/你/仓库；去掉末尾斜杠 */
  function normalizeRepoUrl(v) {
    let s = String(v == null ? '' : v).trim().replace(/\s+/g, '');
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
    return s.replace(/\/+$/, '');
  }

  /** 当前配置的仓库地址（空字符串 = 没填） */
  function aboutRepo() {
    return normalizeRepoUrl(settings.about && settings.about.repoUrl);
  }

  /** 在浏览器新标签页打开链接。用户脚本是页面上下文，window.open 可用；
      被弹窗拦截时把地址打到控制台，方便手动打开。 */
  function openUrl(url) {
    try { log('打开：' + url); } catch (e) { /* 忽略 */ }
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      warn('打开链接失败：' + (e && e.message) + ' —— 请手动访问 ' + url);
    }
    return true;
  }

  /* ========================== 语言 / 官方译名 ==========================
     依据 research/i18n-languages.md（子 agent 的调查报告，逐条带源码证据）：
       · R132 支持 7 种语言：EN DE FR RU CN TW UA（TranslationDictionary）
       · 界面字符串 → InterfaceTextGet(key)（源 Screens/Interface.csv）
       · 资产专用文本 → AssetTextGet(key)（源 AssetStrings.csv）
       · **锁的显示名 → Asset.Description**（源 Female3DCG.csv），AssetTextGet 取不到锁名
       · Asset.Name 是内部 ID，永不翻译；TranslationLanguage 是全局当前语言；
         localStorage 键 BondageClubLanguage
       · 覆盖度极不均衡（德语文件只译到一部分锁名，FR/TW 连 Interface 文件都没有）
         ⇒ 取不到时游戏会返回 "MISSING …" 哨兵串或空串，**必须判空**。
       · AssetLoadDescription 不被 await（Asset.js:1003）⇒ 早期读可能是英文占位，
         所以**只在用的时候读**（渲染/点击时），不要启动时缓存。
     ==================================================================== */

  /** 语言按钮表：**每个都用它自己的语言写**（用户明确要求：中文 / English，不要"中文/英文"） */
  const LANGS = [
    { code: 'auto', label: 'Auto' },
    { code: 'en', label: 'English' },
    { code: 'cn', label: '中文' },
    { code: 'tw', label: '繁體中文' },
    { code: 'de', label: 'Deutsch' },
    { code: 'fr', label: 'Français' },
    { code: 'ru', label: 'Русский' },
    { code: 'ua', label: 'Українська' },
  ];

  /** 当前语言代码：cn / tw / en / de / fr / ru / ua（'auto' 时读游戏；问不到就中文兜底；
      旧存的 'zh' 视作 'cn'）。 */
  function currentLang() {
    let code = settings.language;
    if (code === 'zh') code = 'cn';
    if (code && code !== 'auto' && LANGS.some((x) => x.code === code)) return code;
    let g = null;
    try { g = gGet('TranslationLanguage'); } catch (e) { /* 忽略 */ }
    if (typeof g !== 'string' || !g) {
      try { g = localStorage.getItem('BondageClubLanguage'); } catch (e) { /* 忽略 */ }
    }
    const s = String(g || '').toUpperCase();
    if (s === 'CN') return 'cn';
    if (s === 'TW') return 'tw';
    if (s === 'DE') return 'de';
    if (s === 'FR') return 'fr';
    if (s === 'RU') return 'ru';
    if (s === 'UA') return 'ua';
    if (!s) return 'cn';   // 问不到（测试/异常环境）→ 中文兜底，别突然变英文
    return 'en';
  }

  /** DLS 自己的文案表。键就是中文原文（zh 是恒等映射），查不到就原样返回 —— 所以漏译不会坏。 */
  const STRINGS = {
    en: {
      '界面': 'Interface', '计时锁': 'Timer locks', '密码锁': 'Password locks',
      '组合锁': 'Combination locks', '关于': 'About',
      '✕ 关闭': '✕ Close', '⟳ 重置': '⟳ Reset', '← 返回': '← Back',
      'GitHub 详情页': 'GitHub repo', '最近更新': 'Latest release',
      '复位到右下角': 'Reset to bottom-right',
      '锁工具：开': 'Locks: ON', '锁工具：关': 'Locks: OFF', '设置': 'Settings',
      '应用': 'Apply',
      '启用锁工具（总开关）': 'Enable locks (master switch)',
      '右下角悬浮条': 'Floating bar (bottom-right)',
      '锁界面里的精确时长输入框': 'Precise-duration box inside the lock UI',
      '悬浮条位置': 'Floating bar position',
      'GitHub 仓库地址（右下角两个按钮用）': 'GitHub repo URL (for the two buttons)',
      '初始时长（主人锁）': 'Initial duration (owner lock)',
      '初始时长（恋人锁）': 'Initial duration (lovers lock)',
      '初始时长（其它计时锁）': 'Initial duration (other timer locks)',
      '选择器增量（主人锁）': 'Chooser step (owner lock)',
      '选择器增量（恋人锁）': 'Chooser step (lovers lock)',
      '选择器增量（Mistress）': 'Chooser step (Mistress)',
      '选择器增量（密码计时）': 'Chooser step (timer+password)',
      '计时结束时移除物品': 'Remove item when the timer ends',
      '解锁时移除物品': 'Remove item on unlock',
      '默认密码（A-Z ≤8）': 'Default password (A-Z, ≤8)',
      '默认提示语（≤140）': 'Default hint (≤140)',
      '上锁时直接写入': 'Write directly when locking',
      '只对自己生效': 'Only for myself',
      '默认组合（4 位数字）': 'Default combination (4 digits)',
      '密码锁默认密码': 'Default password',
      '默认提示语 Hint': 'Default hint',
      '组合锁默认组合': 'Default combination',
      '锁型默认（T1-A）': "Per-lock-type default (T1-A)",
      '设为该锁型默认': "Set as this lock type's default",
      '其余语言尚未完成（暂按英文显示；锁名始终跟随游戏官方译名）': 'Other languages are not finished yet and fall back to English (lock names always follow the game’s official translation).',
    },
  };

  /** 翻译 DLS 自己的文案（参数是中文原文；zh 直接返回原文；查不到就原样返回）。
      ★ 支持"图标 + 文字"的标签（分类按钮就是 `⊙ 界面` 这种）：整体查不到时，
        把开头的非字母数字字符（图标与空格）剥掉再查一次，然后拼回去。 */
  function L(text) {
    const code = currentLang();
    if (code === 'cn' || code === 'tw') return text;          // 原文本来就是中文
    const s = String(text == null ? '' : text);
    /* de/fr/ru/ua 目前只有英文兜底 —— 游戏自己的覆盖率也不均（见 research/i18n-languages.md），
       但绝不会出现空白：查不到就原样返回。 */
    const table = STRINGS[code] || STRINGS.en || {};
    if (table[s]) return table[s];
    const m = /^([^\u4e00-\u9fff]*)([\u4e00-\u9fff].*)$/.exec(s);
    if (m && table[m[2]]) return m[1] + table[m[2]];
    return s;
  }

  /** 锁资产的**官方显示名**（跟随游戏语言；读不到就回落内部名）。
      依据：Asset.Description 由 Female3DCG.csv 提供并被 TranslationAsset 按语言改写；
      AssetTextGet **取不到锁名**。 */
  function lockDisplayName(name) {
    const internal = String(name || '');
    try {
      const arr = gGet('Asset');
      if (!Array.isArray(arr)) return internal;
      for (const a of arr) {
        if (!a || a.Name !== internal) continue;
        const d = a.Description;
        const s = (typeof d === 'function') ? String(d() || '') : String(d || '');
        if (!s || s.indexOf('MISSING') === 0 || s.indexOf('MISSING') >= 0) return internal;
        return s;
      }
    } catch (e) { /* 忽略 */ }
    return internal;
  }

  function prefHitsReset() { prefState.hits = []; }
  function prefMsg(m) { prefState.msg = m || ''; }

  /** 画一个按钮并**同时登记它的点击区** —— 绘制与命中判定用同一份数据，永远不会错位 */
  function prefBtn(label, x, y, w, h, fn, color) {
    label = L(label);          // 画布按钮标签：自动按语言翻译（查不到就原样）
    prefState.hits.push({ x: x, y: y, w: w, h: h, fn: fn });
    const db = gGet('DrawButton');
    if (typeof db === 'function') { try { db(x, y, w, h, label, color || 'White'); } catch (e) { /* 忽略 */ } }
  }

  function prefTxt(text, x, y, align, color) {
    text = L(text);            // 画布文字：同上（动态拼接的字符串查不到就原样）

    const mc = gGet('MainCanvas');
    if (mc) { try { mc.textAlign = align || 'left'; } catch (e) { /* 忽略 */ } }
    const dt = gGet('DrawText');
    if (typeof dt === 'function') { try { dt(String(text), x, y, color || 'Black', 'Gray'); } catch (e) { /* 忽略 */ } }
  }

  /** 单位候选：选择器类设置只列**它自己的**单位（Mistress 就没有 Days） */
  function prefUnitList(chooserKey) {
    if (chooserKey) {
      for (const c of CHOOSERS) {
        if (c.key !== chooserKey) continue;
        const o = gGet(c.options);
        if (Array.isArray(o)) {
          const ls = [];
          for (const x of o) { const l = x && x.unit && x.unit.label; if (l && ls.indexOf(l) < 0) ls.push(l); }
          if (ls.length) return ls;
        }
      }
    }
    return unitLabels();
  }

  /** 一行：数字步进器（值本身也是可点的加减） */
  function prefRowNum(y, label, val, min, max, set) {
    prefTxt(label, PREF_L.labelX, y + 32, 'left');
    const n = Number(val) || min;
    const pick = (v) => { const nv = Math.min(max, Math.max(min, v)); set(nv); saveSettings(); prefMsg(label + ' = ' + nv); };
    prefBtn('<', PREF_L.ctrlX, y + 8, 44, 44, () => pick(n - 1));
    prefTxt(String(n), PREF_L.ctrlX + 75, y + 38, 'center');
    prefBtn('>', PREF_L.ctrlX + 106, y + 8, 44, 44, () => pick(n + 1));
  }

  /** 一行：数字 + 单位（用于计时锁各档） */
  function prefRowNumUnit(y, label, cfg, chooserKey) {
    prefTxt(label, PREF_L.labelX, y + 32, 'left');
    const n = Math.max(1, Number(cfg.value) || 1);
    prefBtn('<', PREF_L.ctrlX, y + 8, 44, 44, () => { cfg.value = Math.max(1, n - 1); saveSettings(); prefMsg(label + ' = ' + cfg.value + ' ' + cfg.unit); });
    prefTxt(String(n), PREF_L.ctrlX + 75, y + 38, 'center');
    prefBtn('>', PREF_L.ctrlX + 106, y + 8, 44, 44, () => { cfg.value = n + 1; saveSettings(); prefMsg(label + ' = ' + cfg.value + ' ' + cfg.unit); });
    const units = prefUnitList(chooserKey);
    const ui = Math.max(0, units.indexOf(cfg.unit));
    const ux = PREF_L.ctrlX + PREF_L.numW + 24;
    prefBtn('<', ux, y + 8, 44, 44, () => { cfg.unit = units[(ui - 1 + units.length) % units.length]; saveSettings(); prefMsg(label + ' 单位 = ' + cfg.unit); });
    prefTxt(String(cfg.unit), ux + 110, y + 38, 'center');
    prefBtn('>', ux + 176, y + 8, 44, 44, () => { cfg.unit = units[(ui + 1) % units.length]; saveSettings(); prefMsg(label + ' 单位 = ' + cfg.unit); });
  }

  /** 一行：开关（原版那种勾选框的等价物） */
  function prefRowBool(y, label, get, set) {
    prefTxt(label, PREF_L.labelX, y + 32, 'left');
    const on = !!get();
    prefBtn(on ? '开' : '关', PREF_L.ctrlX, y + 8, 120, 44, () => {
      set(!on); saveSettings(); prefMsg(label + ' = ' + (on ? '关' : '开'));
    }, 'White');
  }

  /** 一行：文本（用游戏自己的 Element* 输入框 + 一个「应用」按钮） */
  function prefRowText(y, label, id, value, commit, opts) {
    prefTxt(label, PREF_L.labelX, y + 32, 'left');
    const o = opts || {};
    if (!prefState.inputs[id]) {
      const create = gGet('ElementCreateInput');
      if (typeof create === 'function') {
        try {
          create(id, 'text', '', String(o.maxLength || 8));
          prefState.inputs[id] = true;
          const el = document.getElementById(id);
          if (el) {
            if (el.setAttribute) el.setAttribute('placeholder', String(value == null ? '' : value));
            el.style.background = 'rgba(30,24,40,.95)';
            el.style.border = '1px solid #8a7aa0';
            el.style.color = '#f0e8ff';
          }
        } catch (e) { /* 忽略 */ }
      }
    }
    const pos = gGet('ElementPosition');
    if (typeof pos === 'function') { try { pos(id, PREF_L.ctrlX + 150, y + 30, 300); } catch (e) { /* 忽略 */ } }
    prefBtn('应用', PREF_L.ctrlX + 320, y + 8, 110, 44, () => {
      const read = gGet('ElementValue');
      const v = (typeof read === 'function') ? String(read(id) || '') : '';
      commit(v);
      prefMsg(label + ' 已应用');
    });
  }

  function prefRemoveInputs() {
    const rm = gGet('ElementRemove');
    const ids = Object.keys(prefState.inputs || {});
    for (const id of ids) { if (typeof rm === 'function') { try { rm(id); } catch (e) { /* 忽略 */ } } }
    prefState.inputs = {};
  }

  /** 侧栏动作（首页与子页都画） */
  function prefDrawActions() {
    const y = PREF_L.actY, w = PREF_L.actW, g = PREF_L.actGap;
    const x0 = PREF_L.cx - w / 2;                // ★ 「关闭」已移到右上角图标（游戏同款），这里只剩「重置」→ 单个居中
    /* 用户要求：GitHub 的「详情页 / 最近更新」两个链接画在**画布**上、放这一行的右下角。
       地址在「界面」页里填（或 __DLS.setRepo(...)）；没填时按钮是灰的，点了会提示。
       ★ 位置：与「关闭/重置」同一行、贴画布最右边（用户反馈：放下面会和提示文字挤在一起）。 */
    const gw = 150, gg = 10, gh = 44;
    const ghY = y;                                 // 与「关闭/重置」同一行
    const gx = PREF_L.cx * 2 - 40 - (2 * gw + gg);  // ★ 用户要求：贴到画布最右边（右边留 40，避免压到边框装饰）
    const repoUrl = aboutRepo();
    const repoHint = () => prefMsg('请先在「界面」页填 GitHub 仓库地址（或用 __DLS.setRepo(...)）');
    prefBtn('GitHub 详情页', gx, ghY, gw, gh, () => {
      if (!repoUrl) { repoHint(); return; }
      openUrl(repoUrl);
    }, repoUrl ? 'White' : 'Silver');
    prefBtn('最近更新', gx + gw + gg, ghY, gw, gh, () => {
      if (!repoUrl) { repoHint(); return; }
      openUrl(repoUrl + '/releases');
    }, repoUrl ? 'White' : 'Silver');
    prefBtn('⟳ 重置', x0, y, w, PREF_L.actH, () => {
      let ok = true;
      try { ok = window.confirm('把 DLS 的全部设置恢复为默认值？'); } catch (e) { ok = true; }
      if (!ok) return;
      settings = clone(DEFAULT_SETTINGS);
      saveSettings(); refreshUi(); syncUi(); prefRemoveInputs();
      prefMsg('已恢复默认设置');
    });

    /* ★ 用户要求：右上角**只放一个**图标按钮，位置/图标与游戏菜单栏一致，
       行为＝"返回上一层"：子页 → 本插件首页；首页 → 退出设置页。
       ⚠️ 必须在这里画（每页都画）—— 之前画在"子页分支"里，结果首页没有按钮（用户实测）。
       依据：wip/i18n/Preference.js:331（image: "Icons/Exit.png"）与 :346（1905,75 top-right）。 */
    {
      const S = iconSize();
      prefIconButton(PREF_L.mbRight, PREF_L.mbTop, S, () => {
        if (prefState.page !== 'home') { prefState.page = 'home'; prefMsg(''); return; }
        const exit = gGet('PreferenceSubscreenExit');
        if (typeof exit === 'function') { try { exit(); return; } catch (e) { /* 忽略 */ } }
        prefMsg('找不到 PreferenceSubscreenExit —— 请按 ESC');
      });
    }
  }

  /** 每帧绘制（run）：先清空点击区，再画当前页 */
  function prefDraw() {
    prefHitsReset();
    prefState.inputs = prefState.inputs || {};
    prefTxt('DLS', PREF_L.cx, PREF_L.titleY, 'center');

    if (prefState.page === 'home') {
      prefRemoveInputs();
      let k = 0;
      for (const c of PREF_CATS) {
        if (c.hidden) continue;
        const x = PREF_X0() + (k % 2) * (PREF_L.bw + PREF_L.gx);
        const y = PREF_L.gridY + Math.floor(k / 2) * (PREF_L.bh + PREF_L.gy);
        const key = c.key;
        prefBtn(c.icon + '  ' + c.label, x, y, PREF_L.bw, PREF_L.bh, () => {
          prefState.page = key; prefMsg(''); prefRemoveInputs();
        });
        k++;
      }
    } else {
      /* ★ 用户要求：返回按钮放到**右上角**（原位置在左上、内容区左边界）。
         用的是游戏自己的 DrawButton，所以外观就是 BC 原生按钮的样子。 */

      prefDrawPage();
    }
    prefDrawActions();
    if (prefState.msg) prefTxt(prefState.msg, PREF_L.cx, PREF_L.msgY, 'center', 'Black');
  }

  function prefDrawPage() {
    const P = prefState.page;
    let i = 0;
    const Y = () => PREF_L.rowY0 + (i++) * PREF_L.rowH;
    if (P === 'ui') {
      prefRowBool(Y(), '启用锁工具（总开关）', () => settings.enabled, (v) => { settings.enabled = v; });
      prefRowBool(Y(), '右下角悬浮条', () => settings.ui !== false, (v) => { settings.ui = v; syncUi(); });
      prefRowBool(Y(), '锁界面里的精确时长输入框', () => settings.lockBox.enabled !== false, (v) => { settings.lockBox.enabled = v; });
      /* 存下来给右下角那两个按钮用（留空 → 按钮变暗并提示怎么填） */

      {
        const yPos = Y();
        prefTxt('悬浮条位置', PREF_L.labelX, yPos + 32, 'left');
        prefBtn('复位到右下角', PREF_L.ctrlX, yPos + 8, 220, 44, () => {
          settings.uiPos = null;
          saveSettings();
          if (state.applyUiPos) state.applyUiPos();     // ★ 真的移回去
          prefMsg('悬浮条位置已复位到右下角');
        });
      }
      {
        /* ★ 用户要求：列出**所有**支持的语言，而且**每个按钮用它自己的语言写**
           （正确：中文 / English；错误：中文 / 英文）。R132 支持 EN/DE/FR/RU/CN/TW/UA。 */
        prefTxt('语言 / Language', PREF_L.labelX, Y() + 32, 'left');
        const per = 4, bw2 = 200, bh2 = 44, gap2 = 10;
        for (let r = 0; r < 2; r++) {
          const yL = Y();
          for (let c2 = 0; c2 < per; c2++) {
            const item = LANGS[r * per + c2];
            if (!item) continue;
            const active = (settings.language === item.code);
            prefBtn((active ? '● ' : '') + item.label, PREF_L.labelX + c2 * (bw2 + gap2), yL, bw2, bh2, () => {
              settings.language = item.code;
              saveSettings();
              prefMsg('Language = ' + item.label + '（当前生效：' + currentLang() + '）');
            }, active ? 'Silver' : 'White');
          }
        }
        /* ★ 用户要求：留一行字说明这些语言还没做完（DLS 自己的文案目前只有中文与英文，
           其余语言按官方英文兜底；锁名不受影响，始终跟游戏官方译名）。 */
        /* ★ 改成**居中**：左对齐时整句会向右伸得很远；居中后两边对称，不会再跑出可见区。 */
        prefTxt('其余语言尚未完成（暂按英文显示；锁名始终跟随游戏官方译名）',
          PREF_L.cx, Y() + 30, 'center');
      }
      /* ★ 用户要求：**去掉这里的 GitHub 填写** —— 设置页是给别的用户看的，不该出现作者私人仓库地址。
         右下角那两个按钮仍然可用，地址请用控制台命令设置：__DLS.setRepo('github.com/你/仓库')。 */
    } else if (P === 'timer') {
      prefRowNumUnit(Y(), '初始时长（主人锁）', settings.timerDefaults.initialByLock.OwnerTimerPadlock, null);
      prefRowNumUnit(Y(), '初始时长（恋人锁）', settings.timerDefaults.initialByLock.LoversTimerPadlock, null);
      prefRowNumUnit(Y(), '初始时长（其它计时锁）', settings.timerDefaults.initial, null);
      prefRowNumUnit(Y(), '选择器增量（主人锁）', settings.timerDefaults.owner, 'owner');
      prefRowNumUnit(Y(), '选择器增量（恋人锁）', settings.timerDefaults.lovers, 'lovers');
      prefRowNumUnit(Y(), '选择器增量（Mistress）', settings.timerDefaults.mistress, 'mistress');
      prefRowNumUnit(Y(), '选择器增量（密码计时）', settings.timerDefaults.passwordTimer, 'passwordTimer');
      prefRowBool(Y(), '计时结束时移除物品', () => settings.timerDefaults.initial.removeItem, (v) => { settings.timerDefaults.initial.removeItem = v; });
    } else if (P === 'password') {
      prefRowText(Y(), '默认密码（A-Z ≤8）', 'DLS_PW', normalizePassword(settings.password.value), (v) => { settings.password.value = v; }, { maxLength: 8 });
      prefRowText(Y(), '默认提示语（≤140）', 'DLS_HINT', normalizeHint(settings.password.hint), (v) => { settings.password.hint = normalizeHint(v); }, { maxLength: HINT_MAX });
      prefRowBool(Y(), '解锁时移除物品', () => settings.password.removeOnUnlock, (v) => { settings.password.removeOnUnlock = v; });
      prefRowBool(Y(), '上锁时直接写入', () => settings.password.applyOnLock, (v) => { settings.password.applyOnLock = v; });
      prefRowBool(Y(), '只对自己生效', () => settings.password.onlySelf, (v) => { settings.password.onlySelf = v; });
    } else if (P === 'combination') {
      prefRowText(Y(), '默认组合（4 位数字）', 'DLS_COMB', settings.combination.value, (v) => { settings.combination.value = normalizeCombination(v) || ''; }, { maxLength: 4 });
      prefRowBool(Y(), '上锁时直接写入', () => settings.combination.applyOnLock, (v) => { settings.combination.applyOnLock = v; });
      prefRowBool(Y(), '只对自己生效', () => settings.combination.onlySelf, (v) => { settings.combination.onlySelf = v; });
    } else if (P === 'about') {
      /* 用户要求：这一页写 DLS 全称 + 版本/build。
         （GitHub 的「详情页 / 最近更新」两个链接按用户后来的要求移到了**右下角悬浮栏**上，
           仓库地址在「界面」页里填。） */
      prefTxt('DLS — Default locks setting', PREF_L.labelX, Y() + 32, 'left');
      prefTxt('v' + VERSION + '   build ' + BUILD, PREF_L.labelX, Y() + 32, 'left');
      prefTxt('作者 / Author：Asresia(Dr)23575', PREF_L.labelX, Y() + 32, 'left');
    }
  }

  /** 点击（click）：按每帧登记的点击区判定，绘制与判定永远一致 */
  function prefClick() {
    const mouseIn = gGet('MouseIn');
    if (typeof mouseIn !== 'function') return;
    for (const h of (prefState.hits || [])) {
      try { if (mouseIn(h.x, h.y, h.w, h.h)) { h.fn(); return; } } catch (e) { /* 忽略 */ }
    }
  }

  function prefLoad() {
    prefState.page = 'home';
    prefState.msg = '';
    prefState.inputs = {};
    prefState.hits = [];
  }

  function prefTeardown() {
    prefRemoveInputs();
    prefState.hits = [];
    prefState.msg = '';
  }

  /* ★ 插件图标（用户指定：照着手绘杨柳参考图描的）。内联成 data URI，
     别的用户装上也能看到图标，不依赖任何外链/托管。
     游戏把扩展设置项的 Image（类型 string | () => string）渲染成按钮左边的图标。 */
  const LOGO_DATA_URI = 'data:image/png;base64,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';
  /* ★ 插件图标：照用户给的手绘杨柳参考图描线 + 自适应阈值做成"纯黑细线 + 透明底"。
     内联成 data URI → 别的用户装上也能看到，不依赖外链/托管。
     游戏会把扩展设置项的 Image（类型 string | () => string）渲染在按钮左边。 */
  /** 把这一页注册进「设置 → 拓展组件」。Preference.js 随游戏加载，所以要反复尝试 */
  function installPreferencePage() {
    if (state.prefRegistered) return true;
    const reg = gGet('PreferenceRegisterExtensionSetting');
    if (typeof reg !== 'function') return false;
    try {
      reg({
        Identifier: PREF_ID,
        ButtonText: 'DLS',
        Image: LOGO_DATA_URI,      // 按钮左边的图标（位置/大小由游戏排版）
        load: () => { try { prefLoad(); } catch (e) { warn('设置页初始化失败', e && e.message); } },
        unload: () => { try { prefTeardown(); } catch (e) { /* 忽略 */ } },
        run: () => { try { prefDraw(); } catch (e) { /* 忽略 */ } },
        click: () => { try { prefClick(); } catch (e) { /* 忽略 */ } },
        exit: () => true,
        resize: () => { /* 布局全部用画布坐标，无需跟随 DOM 尺寸 */ },
      });
      state.prefRegistered = true;
      log('已注册「设置 → 拓展组件」设置页：DLS');
      return true;
    } catch (e) {
      warn('注册设置页失败：' + (e && e.message));
      return false;
    }
  }

  /* ========================== 验收助手 ==========================
     把"手动验收"变成机械判定：arm() 之后你去游戏里点几下，report() 逐条告诉你
     哪几项通过、哪几项没观察到。特别是第 3 项 —— 它能证明"◀/▶ 点得动"，
     也就是"我们没有每帧强设选择器"。 */
  const verify = {
    armed: false,
    armedAt: 0,
    until: 0,
    sampleTimer: null,
    appliedTuple: {},   // key -> 挂载时的 (index|indexes) 快照
    userTouched: {},    // key -> true（观察到与快照不同 = 玩家手动改过）
    pwSeen: {},         // id -> 观测到的值
    notes: [],
  };

  function chooserTuple(c) {
    return String(gGet(c.index)) + '|' + JSON.stringify(gGet(c.indexes));
  }

  function verifySample() {
    for (const c of CHOOSERS) {
      if (!Array.isArray(gGet(c.options))) continue;      // 没加载就算不出基准
      const t = chooserTuple(c);
      if (verify.appliedTuple[c.key] === undefined) continue;
      if (t !== verify.appliedTuple[c.key] && !verify.userTouched[c.key]) {
        verify.userTouched[c.key] = true;
        verify.notes.push('[' + new Date().toLocaleTimeString() + '] ' + c.key +
          ' 选择器被手动改动：' + verify.appliedTuple[c.key] + ' → ' + t);
      }
    }
    for (const id of ['SetPassword', 'SetHint', 'Password']) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (!(id in verify.pwSeen)) {
        verify.pwSeen[id] = el.value;
        verify.notes.push('[' + new Date().toLocaleTimeString() + '] 输入框 #' + id + ' 出现，当前值="' + el.value + '"');
      } else if (verify.pwSeen[id] === '' && el.value) {
        verify.pwSeen[id] = el.value;
        verify.notes.push('[' + new Date().toLocaleTimeString() + '] 输入框 #' + id + ' 被填入 "' + el.value + '"');
      } else {
        verify.pwSeen[id] = el.value;
      }
    }
    if (verify.armed && Date.now() > verify.until) verifyStop('观测时间到');
  }

  function verifyArm(minutes) {
    const mins = Math.max(1, Number(minutes) || 5);
    verify.armed = true;
    verify.armedAt = Date.now();
    verify.until = verify.armedAt + mins * 60000;
    verify.userTouched = {};
    verify.pwSeen = {};
    verify.notes = [];
    verify.appliedTuple = {};
    for (const c of CHOOSERS) verify.appliedTuple[c.key] = chooserTuple(c);
    if (verify.sampleTimer) clearInterval(verify.sampleTimer);
    verify.sampleTimer = setInterval(() => {
      try { verifySample(); } catch (e) { warn('验收采样异常', e && e.message); }
    }, 1000);
    state.timers.push(verify.sampleTimer);
    return [
      '验收助手已启动（观测 ' + mins + ' 分钟，每秒采样一次）。请依次做：',
      '  1) 打开一个计时锁的设置界面，把 ◀ / ▶ 两边都点几下，顺手切一下单位',
      '  2) 打开一个还没设过密码的密码锁的「首次设置」界面',
      '  3) 回到控制台执行：__DLS.verify.report()',
      '（想提前结束采样：__DLS.verify.stop()）',
    ].join('\n');
  }

  function verifyStop(why) {
    verify.armed = false;
    if (verify.sampleTimer) { clearInterval(verify.sampleTimer); verify.sampleTimer = null; }
    log('验收助手已停止（' + (why || '手动') + '）');
    return '验收助手已停止';
  }

  function verifyReport() {
    const L = [];
    const P = (s) => L.push(s === undefined ? '' : String(s));
    const mark = (ok) => (ok ? '✅ 通过' : '❌ 没观察到');
    const wanted = normalizePassword(settings.password.value);

    P('===== 验收助手报告 =====');
    P('观测 ' + Math.round((Date.now() - verify.armedAt) / 1000) + ' 秒（' + verify.notes.length + ' 条采样笔记）');
    P('');
    P('[1] ' + mark(!!state.mod) + '  SDK 注册' + (state.sdkVersion ? '（sdk ' + state.sdkVersion + '）' : ''));
    P('[2] ' + mark(settings.timerDefaults && evalWorks()) +
      '  计时锁默认时长可写入（依赖全局 eval）');
    for (const c of CHOOSERS) {
      const loaded = Array.isArray(gGet(c.options));
      const want = settings.timerDefaults[c.key];
      P('       [' + c.key + '] ' + (loaded ? '已加载' : '未加载') +
        '  期望 ' + want.unit + ' ' + want.value +
        '  运行时 ' + (loaded ? chooserTuple(c) : '(n/a)') +
        '  挂载时 ' + (verify.appliedTuple[c.key] || '(n/a)'));
    }
    const touched = Object.keys(verify.userTouched).filter((k) => verify.userTouched[k]);
    P('[3] ' + mark(touched.length > 0) +
      '  ★ 手动点 ◀/▶ 确实改动了选择器' +
      (touched.length ? '（' + touched.join(', ') + '）'
        : '（请打开计时锁界面点几下 ◀/▶ 再报告 —— 这一项能证明默认值没有被每帧强设覆盖）'));
    P('[4] ' + mark('SetPassword' in verify.pwSeen) +
      '  密码锁的 #SetPassword 输入框出现过');
    P('[5] ' + mark(('SetPassword' in verify.pwSeen) && verify.pwSeen['SetPassword'] === wanted && !!wanted) +
      '  #SetPassword 被预填成配置的密码（期望 "' + wanted + '"' +
      (('SetPassword' in verify.pwSeen) ? '，观测到 "' + verify.pwSeen['SetPassword'] + '"' : '') + '）');
    P('');
    P('--- 采样笔记 ---');
    P(verify.notes.length ? verify.notes.join('\n') : '（无）');
    P('');
    P('把以上整段贴给我即可。');
    return L.join('\n');
  }

  /** 一条命令把「我需要的全部诊断」打出来 —— 你整段贴回来我就能定位问题 */
  function selftest() {
    const L = [];
    const P = (s) => L.push(s === undefined ? '' : String(s));
    P('===== DLS 自检 v' + VERSION + ' =====');
    P('时间 ' + new Date().toString());
    P('页面 ' + location.href);
    P('');

    P('[SDK]');
    const sdk = getSdk();
    P('  bcModSdk: ' + (sdk ? '存在 version=' + sdk.version + ' apiVersion=' + sdk.apiVersion : '❌ 不存在'));
    P('  本脚本已注册: ' + (state.mod ? '✓（sdkVersion=' + state.sdkVersion + '）' : '❌'));
    try {
      const info = (sdk && sdk.getModsInfo) ? sdk.getModsInfo() : [];
      P('  getModsInfo: 共 ' + info.length + ' 个 mod，本脚本' +
        (info.some((m) => m && m.name === MOD_NAME) ? '✓ 在其中' : '❌ 不在其中'));
      P('  其它 mod: ' + info.map((m) => m && m.name).filter((n) => n && n !== MOD_NAME).join(', '));
    } catch (e) { P('  getModsInfo 失败: ' + (e && e.message)); }
    P('  全局 eval 可用（计时锁默认值依赖它）: ' + evalWorks());
    P('  已挂钩 (' + state.hooked.size + '): ' + Array.from(state.hooked).join(', '));
    P('  ↑ 这里必须能看到 DialogLockingClick；看不到说明它是随游戏主 bundle 按需加载的，' +
      '轮询会继续尝试补挂（见 tick()）');
    P('');

    P('[A1a 计时锁默认时长]');
    const ini = settings.timerDefaults.initial;
    P('  ★ 上锁时的初始剩余时间 = ' + (ini && ini.enabled !== false
      ? (ini.value + ' ' + ini.unit) : '（已关闭，保持游戏默认）'));
    P('     这才决定"上锁后计时器显示多少"（游戏默认 = 锁资产自己的 RemoveTimer 秒数，Mistress 是 5 分钟）；');
    P('     下面三项只决定在选择器里点一次「添加」加多少。');
    for (const c of CHOOSERS) {
      const want = settings.timerDefaults[c.key];
      const options = gGet(c.options);
      const loaded = Array.isArray(options);
      P('  [' + c.key + '] 期望 ' + want.unit + ' ' + want.value);
      P('        脚本已加载: ' + (loaded ? '✓ 单位=' + options.map((o) => o.unit && o.unit.label).join('/')
        : '✗ 还没加载（该锁的界面没打开过）'));
      P('        已应用: ' + (chooserDone.has(c.key) ? '✓' : '✗') +
        '   失败重试次数=' + (chooserAttempts[c.key] || 0));
      P('        词法读 index=' + JSON.stringify(gGetLexical(c.index)) +
        '  indexes=' + JSON.stringify(gGetLexical(c.indexes)));
      // ★ 影子值检测：`let` 全局不在 window 上。如果 window 上出现了同名属性，
      //   说明有一份"影子值"，而我必须确认游戏读到的是词法绑定那一份。
      const shadowIdx = Object.prototype.hasOwnProperty.call(window, c.index);
      const shadowArr = Object.prototype.hasOwnProperty.call(window, c.indexes);
      if (shadowIdx || shadowArr) {
        P('        ⚠️ window 上存在同名属性（' +
          (shadowIdx ? c.index : '') + (shadowIdx && shadowArr ? ', ' : '') + (shadowArr ? c.indexes : '') +
          '）—— window 读=' + JSON.stringify(gGet(c.index)) +
          '；游戏读的是词法绑定，两者若不同就是"自检说写了、界面却没变"的原因');
      }
      if (loaded) {
        const ui = options.findIndex((o) => o && o.unit && o.unit.label === want.unit);
        if (ui >= 0) {
          const vi = (options[ui].values || []).indexOf(want.value);
          P('        换算: 单位下标 ' + ui + '，数值下标 ' + vi +
            (vi < 0 ? '  ❌ 该数值不在可选列表里！' : '') +
            '   可选值=' + (options[ui].values || []).join('/'));
        } else {
          P('        ❌ 找不到单位 "' + want.unit + '"');
        }
      }
    }
    P('');

    P('[A1b 密码锁默认密码]');
    const pw = normalizePassword(settings.password.value);
    P('  配置密码 → 规范化后 "' + pw + '"' + (pw ? '' : '  ❌ 为空，不会预填'));
    P('  ★ 上锁时直接应用 = ' + settings.password.applyOnLock + '（只对"你自己上的、上在你身上的"锁生效）');
    P('    onlySelf = ' + settings.password.onlySelf + '（true = 改别人身上的锁不用默认，用手动输入）');
    P('  提示语 Hint = "' + normalizeHint(settings.password.hint) + '"（' +
      normalizeHint(settings.password.hint).length + '/' + HINT_MAX + ' 字符，自由文本，不做大小写转换）');
    P('  组合密码 = ' + (normalizeCombination(settings.combination.value)
      ? '"' + normalizeCombination(settings.combination.value) + '"' : '（未设置，不会预填/应用）'));
    P('  ★ 原版勾选框：解锁时移除物品 = ' + yesNo(settings.password.removeOnUnlock) +
      '；计时结束时移除物品 = ' + yesNo(settings.timerDefaults.initial.removeItem));
    P('  build = ' + BUILD + '（不是这一版就说明贴的是旧代码）');
    P('  「设置 → 拓展组件」设置页：' + (state.prefRegistered
      ? '已注册 ✓（入口按钮：DLS — 默认锁设置）'
      : '尚未注册 —— Preference.js 可能还没加载'));
    P('  钩子状态:');
    for (const name of PASSWORD_TARGETS) {
      const exists = isFn(name);
      const hooked = state.hooked.has(name);
      if (exists || hooked) {
        P('    ' + name.padEnd(46) + ' 存在=' + (exists ? '✓' : '✗') + ' 已挂=' + (hooked ? '✓' : '✗'));
      }
    }
    P('  页面上现有输入框:');
    for (const id of ['SetPassword', 'SetHint', 'Password']) {
      const el = document.getElementById(id);
      P('    #' + id.padEnd(12) + (el ? '存在，值="' + el.value + '"' : '不存在'));
    }
    P('  ⚠️ 让这一节更有意义：先打开一个密码锁的设置界面，再执行自检。');
    P('  实际存在于 window 上的相关名字（★ 决定我挂的 hook 名字对不对）:');
    let nameHits = 0;
    try {
      for (const k of Object.getOwnPropertyNames(window)) {
        if (/^InventoryItemMisc.*(Password|Safeword)/.test(k)) {
          P('    ' + String(k).padEnd(54) + ' ' + typeof window[k]);
          nameHits++;
        }
      }
    } catch (e) { /* 忽略 */ }
    if (!nameHits) {
      P('    （一个都没有 —— 这些锁的界面脚本还没加载；先去打开一次密码锁的设置界面再自检）');
    }
    P('');

    P('[与其它插件的冲突面]');
    try {
      const pi = (sdk && sdk.getPatchingInfo) ? sdk.getPatchingInfo() : null;
      if (pi) {
        let hits = 0;
        for (const name of state.hooked) {
          const info = pi.get(name);
          if (!info) continue;
          const others = (info.hookedByMods || []).filter((m) => m !== MOD_NAME);
          const othersP = (info.patchedByMods || []).filter((m) => m !== MOD_NAME);
          if (others.length || othersP.length) {
            hits++;
            P('  ' + name + '：还被 [' + others.join(', ') + '] hook' +
              (othersP.length ? '，被 [' + othersP.join(', ') + '] patch' : ''));
          }
        }
        if (!hits) P('  本脚本挂的钩子没有与其它插件重叠 ✓');
      } else {
        P('  拿不到 getPatchingInfo()');
      }
    } catch (e) { P('  查冲突失败: ' + (e && e.message)); }
    P('');
    P('===== 自检结束，把以上整段贴给我 =====');
    return L.join('\n');
  }

  function unload() {
    state.alive = false;          // ★ 先停手：正在跑的格式刷 / 延时预填会立刻返回
    for (const off of state.offs.splice(0)) { try { off(); } catch (e) { /* 忽略 */ } }
    state.hooked.clear();
    chooserDone.clear();
    for (const k of Object.keys(chooserAttempts)) delete chooserAttempts[k];
    for (const t of state.timers.splice(0)) { try { clearInterval(t); clearTimeout(t); } catch (e) {} }
    verify.armed = false;
    if (verify.sampleTimer) { try { clearInterval(verify.sampleTimer); } catch (e) {} verify.sampleTimer = null; }
    verify.appliedTuple = {}; verify.userTouched = {}; verify.pwSeen = {}; verify.notes = [];
    if (state.mod) { try { state.mod.unload(); } catch (e) { /* 忽略 */ } }
    state.mod = null;             // ★ 置 null：否则 hookIfExists 会把新钩子挂到已卸载的 mod 上
    removeUi();
    prefTeardown();
    try { delete window.__DLS; } catch (e) {}
    log('已卸载');
  }

  /* ---------- 用户脚本（Tampermonkey / Violentmonkey）可能把同一个脚本注入两次 ----------
     场景：既装了脚本、又在控制台粘贴过一次；或脚本更新后管理器重新注入。
     两份实例会各自挂钩子、各自建悬浮条、各自跑定时器 —— 行为会变得难以预料。
     所以启动时先把旧实例卸载掉（它的 unload 是幂等的、只清自己的东西）。 */
  function killPreviousInstance() {
    const prev = window.__DLS;
    if (!prev) return false;
    try {
      if (typeof prev.unload === 'function') prev.unload();
      log('检测到已有一个 DLS 实例，已先卸载它（避免两份实例重复挂钩子 / 重复悬浮条）');
    } catch (e) { warn('卸载旧实例失败，继续启动', e && e.message); }
    try { delete window.__DLS; } catch (e) { /* 忽略 */ }
    return true;
  }

  /* ========================== 启动 ========================== */

  waitForSdk(30000).then((sdk) => {
    const replacedPrevious = killPreviousInstance();   // ★ 用户脚本环境可能被注入两次
    state.sdkVersion = sdk.version;
    state.mod = sdk.registerMod(
      { name: MOD_NAME, fullName: MOD_FULLNAME, version: VERSION },
      { allowReplace: true }
    );
    log('已注册 mod：' + MOD_NAME + ' v' + VERSION + ' build ' + BUILD +
      '（SDK ' + sdk.version + ' / apiVersion ' + sdk.apiVersion + '）');
    if (!evalWorks()) {
      warn('本页禁用 eval → 计时锁的默认时长功能不可用（密码锁默认密码仍然可用）');
    }

    // 每一步都单独保护：任何一步出错都不能阻止 window.__DLS 被创建，
    // 否则用户连 __DLS.selftest() 都跑不了，等于失去全部诊断能力。
    // installGameHooks() 不在这里做：DialogLockingClick 在 document-start 时还不存在，
    // 只试一次会永久漏掉。改由 startPolling() → tick() 每次尝试（已挂过的会跳过）。
    try { startPolling(); } catch (e) { warn('启动轮询失败', e && e.message); }

    window.__DLS = {
      version: VERSION,
      build: BUILD,
      replacedPrevious,     // 本次启动是否卸载了旧实例（用户脚本重复注入时会为 true）
      get settings() { return settings; },   // 用 getter：reset() 会替换 settings 对象，值拷贝会变陈旧
      report,
      selftest,
      units: () => unitLabels(),     // 游戏当前认识的时间单位（取自它的 TimeUnits）
      prefLayout: () => {                 // 设置页的画布布局 + 右上角图标的位置（诊断/微调用）
        const S = iconSize();
        return Object.assign({}, PREF_L, { iconSize: S, iconX: PREF_L.mbRight - S, iconY: PREF_L.mbTop });
      },
      prefPage: () => prefState.page,  // 设置页当前在哪一页（诊断用：home = 首页）
      /* ---- T1-A：按锁型改"锁资产自己的 RemoveTimer"（默认时长） ---- */
      assetTimers: {
        available: () => {
          const all = listLockAssets().filter((a) => a.timerLock);
          if (!all.length) return '（拿不到锁资产列表：Asset 还没加载）';
          return all.map((a) => '  ' + a.name.padEnd(24) + ' 当前=' + formatHms(a.removeTimer) +
            ' 上限=' + formatHms(a.maxTimer)).join('\n');
        },
        list: assetTimerList,
        set: assetTimerSet,
        setFocused: assetTimerSetFocused,
        clear: (lockName) => {
          if (!settings.assetTimers || !(lockName in settings.assetTimers)) return '没有这个设置：' + lockName;
          delete settings.assetTimers[lockName];
          saveSettings();
          return '已移除 ' + lockName + ' 的设置（资产当前值要刷新页面才会恢复成游戏原值）';
        },
        clearAll: () => {
          settings.assetTimers = {};
          saveSettings();
          return '已清空全部锁型默认时长设置（资产当前值要刷新页面才恢复）';
        },
      },
      hms: {                         // T1 的准备：严格 hh:mm:ss 解析/格式化/上限校验
        parse: parseHms,
        format: formatHms,
        resolve: resolveHmsDuration,
      },
      verify: {
        arm: verifyArm,
        stop: verifyStop,
        report: verifyReport,
      },
      save: () => { const ok = saveSettings(); log('设置已保存'); return ok; },
      reset: () => { settings = clone(DEFAULT_SETTINGS); saveSettings(); chooserDone.clear(); tick('reset'); return '已恢复默认设置'; },
      applyTimerDefaults: () => { chooserDone.clear(); applyAllTimerDefaults('手动'); return report(); },
      prefillPassword: () => prefillPasswordInputs('手动'),
      setTimerDefault: (key, unit, value) => {
        if (!settings.timerDefaults[key]) return '未知的锁类型：' + key + '（可用：' + Object.keys(settings.timerDefaults).join(', ') + '）';
        /* ★ 必须**就地改字段**，不能整体替换这个对象：
           替换会把同级的 onlySelf / enabled / removeItem 一起抹掉。
           （曾经的 bug：调用一次 setTimerDefault("initial", ...) 就把 onlySelf 抹成 undefined，
            于是"给别人上锁不再套默认时长"。） */
        const cur = settings.timerDefaults[key];
        cur.unit = String(unit);
        cur.value = Number(value);
        if (cur.enabled === undefined) cur.enabled = true;
        saveSettings(); chooserDone.delete(key); tick('setTimerDefault');
        return ' 已设置 ' + key + ' = ' + unit + ' ' + value +
          '（同级其它设置保留：' + Object.keys(cur).filter((k) => k !== 'unit' && k !== 'value').join('/') + '）';
      },
      setPassword: (value, hint) => {
        settings.password.value = String(value == null ? '' : value);
        // 自由文本，存的时候就限 140（未传 hint 时把当前值也规范化一遍）
        settings.password.hint = normalizeHint(hint === undefined ? settings.password.hint : hint);
        saveSettings();
        return '密码将规范化为 "' + normalizePassword(settings.password.value) + '"' +
          (settings.password.hint ? '，提示语 "' + settings.password.hint +
            '"（' + settings.password.hint.length + '/' + HINT_MAX + ' 字符）' : '');
      },
      /** 组合密码锁的默认组合（**正好 4 位数字**） */
      setCombination: (value) => {
        const code = normalizeCombination(value);
        if (!code) {
          return '⚠ 组合必须是正好 4 位数字（例如 0000 / 1234）；' +
            '传空字符串可以取消默认（' + JSON.stringify(String(value == null ? '' : value)) + ' 不合法）';
        }
        settings.combination.value = code;
        saveSettings();
        return '组合密码默认值 = ' + code + '（只对 CombinationPadlock 生效）';
      },

      /** 手动触发一次预填 + 一眼看清当前界面上的输入框状态（诊断用） */
      /** 手动弹一条游戏内提示（走游戏的 ToastManager；诊断/试用都方便） */
      notice: (text) => inGameNotice(text),

      /* ---- 悬浮条位置（可拖动；这两个命令方便复位/精确定位） ---- */
      uiPos: (p) => {
        settings.uiPos = (p && typeof p.left === 'number' && typeof p.top === 'number')
          ? { left: Math.max(0, p.left), top: Math.max(0, p.top) } : null;
        saveSettings();
        if (state.applyUiPos) state.applyUiPos();
        return '悬浮条位置 = ' + (settings.uiPos ? JSON.stringify(settings.uiPos) : '默认（右下角）');
      },

      /* ---- 「关于」页的 GitHub 链接（填一次即可） ---- */
      repo: () => aboutRepo(),
      setRepo: (url) => {
        settings.about.repoUrl = normalizeRepoUrl(url);
        saveSettings();
        return 'GitHub 仓库地址 = ' + (aboutRepo() || '(空)');
      },

      /* ---------- 接入点：给**将来独立的格式刷插件**用 ----------
         本插件不再自带格式刷（那会做成独立插件），但从这里把"写锁原语 + 权限闸门"公开出去，
         免得新插件再写一套权限判定、日后两边漂移。
         约定：window.__DLS.api.apiVersion 是接口版本，不兼容时递增。 */
      api: {
        apiVersion: 1,
        /** 权限闸门：通过返回 null，被拒返回原因字符串。mode: 'timer'|'password'|'combination' */
        gateForLock: (item, lock, C, mode) => lockGate(item, lock, C, mode),
        /** 认得的锁型（有自己权限条件的那几种） */
        knownLocks: () => Object.keys(LOCK_RULES),
        /** 当前设置（只读用途；要改请用上面的命令） */
        defaults: () => settings,
        /** 游戏内提示（走 ToastManager） */
        notify: (text) => inGameNotice(text),
      },

      prefill: () => {
        const ids = ['Password', 'SetPassword', 'SetHint', 'CombinationNumber', 'NewCombinationNumber'];
        const seen = {};
        for (const id of ids) {
          const el = document.getElementById(id);
          if (el) seen[id] = (el.value === '' || el.value == null) ? '(空)' : String(el.value);
        }
        const n = prefillPasswordInputs('manual') + prefillCombinationInput('manual');
        const after = {};
        for (const id of ids) {
          const el = document.getElementById(id);
          if (el) after[id] = (el.value === '' || el.value == null) ? '(空)' : String(el.value);
        }
        return [
          '界面上存在的输入框：' + (Object.keys(seen).length ? Object.keys(seen).join(', ') : '（一个都没有 —— 现在没打开锁界面？）'),
          '预填前：' + JSON.stringify(seen),
          '预填后：' + JSON.stringify(after),
          '本次预填了 ' + n + ' 个',
          '配置：密码=' + JSON.stringify(settings.password.value) +
            '（规范化 ' + JSON.stringify(normalizePassword(settings.password.value)) + '）' +
            '，提示语=' + JSON.stringify(settings.password.hint) +
            '（' + normalizeHint(settings.password.hint).length + '/' + HINT_MAX + ' 字符）' +
            '，组合=' + JSON.stringify(settings.combination.value),
          '开关：password.applyOnLock=' + settings.password.applyOnLock +
            ' onlySelf=' + settings.password.onlySelf +
            '；combination.applyOnLock=' + settings.combination.applyOnLock,
          '版本：build ' + BUILD + '（如果你贴的不是这一版，就会看到旧行为）',
        ].join('\n');
      },

      /** ★ 立刻对"当前聚焦的物品"执行一次直接应用，并**逐条打印判据**。
          这是用来终结"明明配了却没生效"这类猜谜的命令：
          `__DLS.applyNow()` 会告诉你到底哪一条判据没过，以及当前配置是什么。
          传 true 可无视判据强制写一次。 */
      applyNow: (force) => {
        const C = currentTarget();
        const item = gGet('DialogFocusSourceItem');
        if (!C || !item || !item.Property) {
          return '⚠ 现在没有聚焦的物品 —— 先在物品栏里打开一个带锁的物品（这样我才知道你要改哪个）';
        }
        const player = gGet('Player') || {};
        const getLock = gGet('InventoryGetLock');
        let lock = null;
        try { lock = (typeof getLock === 'function') ? getLock(item) : null; } catch (e) { lock = null; }
        let isSelf = null;
        try { isSelf = (typeof C.IsPlayer === 'function') ? C.IsPlayer() : null; } catch (e) { isSelf = null; }

        const L = [];
        L.push('版本：build ' + BUILD);
        L.push('聚焦部位=' + ((item.Asset && item.Asset.Group) ? item.Asset.Group.Name : '?') +
          '  锁=' + (item.Property.LockedBy || '（无锁）') +
          '  锁资产=' + (lock && lock.Asset ? lock.Asset.Name : '找不到'));
        L.push('LockMemberNumber=' + item.Property.LockMemberNumber + '  你的会员号=' + player.MemberNumber +
          '  LockSet=' + !!item.Property.LockSet);
        L.push('当前 Password=' + JSON.stringify(item.Property.Password) +
          '  Hint=' + JSON.stringify(item.Property.Hint) +
          '  RemoveOnUnlock=' + JSON.stringify(item.Property.RemoveOnUnlock) +
          '  RemoveItem=' + JSON.stringify(item.Property.RemoveItem));
        L.push('上锁对象是你自己？' + (isSelf === null ? '（判不出来）' : (isSelf ? '是' : '不是')) +
          '（目标角色 ' + (C.Name || '?') + '）');
        L.push('配置：密码=' + JSON.stringify(settings.password.value) +
          '（规范化 ' + JSON.stringify(normalizePassword(settings.password.value)) + '）' +
          ' 提示语=' + JSON.stringify(normalizeHint(settings.password.hint)) +
          ' applyOnLock=' + settings.password.applyOnLock +
          ' onlySelf=' + settings.password.onlySelf);
        const d = passwordGate(C, item);
        L.push('密码类判据：' + (d.ok ? '✅ ' : '❌ ') + d.reason);

        const upd = gGet('ChatRoomCharacterItemUpdate');
        const rf = gGet('CharacterRefresh');
        if (force && !d.ok) {
          const pw = normalizePassword(settings.password.value);
          const hint = normalizeHint(settings.password.hint);
          item.Property.LockSet = true;
          if (pw) item.Property.Password = pw;
          if (hint) item.Property.Hint = hint;
          if (typeof settings.password.removeOnUnlock === 'boolean') {
            item.Property.RemoveOnUnlock = settings.password.removeOnUnlock;
          }
          if (typeof upd === 'function') upd(C, item.Asset.Group.Name);
          if (typeof rf === 'function') rf(C);
          L.push('→ 已**强制**写入：' + (pw ? '密码 ' + pw : '（无密码）') + (hint ? '，提示语 "' + hint + '"' : ''));
          return L.join('\n');
        }
        if (!d.ok) {
          L.push('→ 没有写入（判据没过）。想无视判据强制写一次：__DLS.applyNow(true)');
          return L.join('\n');
        }
        let done = false;
        if (applyInitialPassword(C, item)) done = true;
        if (applyInitialCombination(C, item)) done = true;
        if (applyInitialTimerDuration(C, item)) done = true;
        if (done) {
          if (typeof upd === 'function') upd(C, item.Asset.Group.Name);
          if (typeof rf === 'function') rf(C);
        }
        L.push('→ ' + (done ? '已写入 ✓（并做了同步）' : '判据通过但没有可写的东西'));
        return L.join('\n');
      },

      /** ★ 原版锁界面上那两个勾选框：上锁时直接写状态
          which: 'password'（解锁时移除物品 = Property.RemoveOnUnlock）
                 | 'timer'（计时结束时移除物品 = Property.RemoveItem）
          value: true = 勾上，false = 不勾 */
      setRemoveBehavior: (which, value) => {
        const v = !!value;
        if (which === 'password') {
          settings.password.removeOnUnlock = v;
          saveSettings();
          return '解锁时移除物品 = ' + yesNo(v) + '（对应原版勾选框 Property.RemoveOnUnlock，只影响新上的锁）';
        }
        if (which === 'timer') {
          settings.timerDefaults.initial.removeItem = v;
          saveSettings();
          return '计时结束时移除物品 = ' + yesNo(v) + '（对应原版勾选框 Property.RemoveItem，只影响新上的锁）';
        }
        return '⚠ which 只能是 "password" 或 "timer"';
      },

      unload,
    };

    log('就绪。控制台可用：__DLS.report() / __DLS.setTimerDefault("owner","Days",1) / __DLS.setPassword("ABC") / __DLS.unload()');
  }).catch((e) => {
    warn(e.message + ' —— 没有等到游戏自带的 bcModSdk，脚本已退出。\n'
      + '  · 如果这里确实不是 Bondage Club 页面，忽略这条即可（或把 @match 收窄）。\n'
      + '  · 如果是用 Tampermonkey / Violentmonkey 装的，请检查三件事：\n'
      + '     ① 脚本头必须是 @grant none（写成 GM_* 会让脚本跑在沙箱里、看不到游戏全局）；\n'
      + '     ② 必须是 @run-at document-start；\n'
      + '     ③ 管理器的「沙箱 / 隔离上下文」选项要关掉。\n'
      + '  · 控制台粘贴的方式不受这些影响。');
  });
})();
