# DLS — Default locks setting

面向 `https://www.bondage-europe.com/R132/BondageClub/` 的单文件用户脚本。
通过游戏**自带的** `bcModSdk`（实测 1.2.0 / apiVersion 1）注册，不修改游戏文件。

- 源码：[src/dls.user.js](../src/dls.user.js)
- 仓库 / 更新：[github.com/Asresia/Default-Lock-Setting](https://github.com/Asresia/Default-Lock-Setting)
- 一键安装：<https://raw.githubusercontent.com/Asresia/Default-Lock-Setting/main/DLS.user.js>
- 当前版本：**v0.1.0 / build b23**（只含"默认锁设置"本身；格式刷与好友盯梢已移出，见 §9）
- **开发交接**：[docs/HANDOFF.md](HANDOFF.md) —— 接手「格式刷」「好友盯梢」两个插件的会话请先读它
  （环境/工具链/权限提权方式/最容易踩的 14 个坑）

---

## 1. 现在能做什么

| 功能 | 覆盖的锁 | 状态 |
|---|---|---|
| **A1a 计时锁默认时长** | Owner / Lovers / Mistress Timer Padlock、Timer + Password Padlock | ✅ |
| **A1b 密码锁默认密码** | Password Padlock、Timer + Password Padlock、Safeword Padlock | ✅ |
| ~~A2 格式刷~~ | — | ➡️ **已从 DLS 移出**，将做成独立插件（草稿 `wip/brush.draft.js`；DLS 通过 `__DLS.api` 提供权限闸门等接入点） |
| ~~B 好友盯梢~~ | — | ➡️ **已从 DLS 移出**，将做成独立插件（草稿 `wip/friend-watch.draft.js`） |

## 2. 默认值与可选值

可选值**不是我编的**，是从游戏源码里抄的（`refs/bc/Screens/Inventory/ItemMisc/*`）。
负数表示**减少**时间。

| 选择器 | 单位 | 可选数值 |
|---|---|---|
| Owner Timer（含 Lovers） | Minutes | 5, 10, 15, 30, 60, −30, −15, −10, −5 |
| | Hours | 1, 2, 3, 4, 8, 12, 16, 24, −12, −8, −4, −3, −2, −1 |
| | Days | 1, 2, 3, 7, 14, 28, −14, −7, −3, −2, −1 |
| Mistress Timer | Minutes | 5, 10, 15, 30, 60, −30, −15, −10, −5 |
| | Hours | 1, 2, 3, 4, −3, −2, −1 |
| Timer + Password | Minutes | 5, 10, 15, 30, 60, −30, −15, −10, −5 |
| | Hours | 1, 2, 3, 4, −3, −2, −1 |

脚本自带默认值：

```js
// ★ 决定「上锁后计时器显示多少」——这才是通常说的"计时锁默认时长"
initial:       Hours 1     // 游戏默认是锁资产自己的 RemoveTimer 秒数（Mistress 是 300 秒 = 5 分钟）
                           // 只对**你自己上的锁**生效，不会改动别人/NPC 上的锁

// 下面三项决定在锁界面里点一次「添加」加多少（是增量，不是初始值）
owner:         Days  1
mistress:      Hours 2
passwordTimer: Hours 1

password:      "ABC"       // 只允许 A-Z，最多 8 位（游戏 /^[A-Z]{1,8}$/）
hint:          ""          // 默认提示语：**自由文本**，中文/emoji 都行，最多 140 字符（不做大小写转换）
combination:   ""          // 组合密码锁的默认组合：**正好 4 位数字**（/^\d{4}$/）；留空 = 不用默认
```

> **`initial` 只影响新上的锁**（已经上好的锁要用「添加」、格式刷，或原版锁界面里的 DLS 输入框去改）。
> 而且默认 **`onlySelf: true`** —— 只有**上锁对象就是你自己**时才自动套默认值。
> **改别人身上的锁不会被自动改**（这就是"改别人的别用默认，用手动输的"），
> 请用原版锁界面里的 **DLS 精确时长输入框**（见 §13）。想连别人身上的也自动套：`__DLS.settings.timerDefaults.initial.onlySelf = false`。
> 它对**所有**你上的计时锁都生效 —— 包括 Owner / Lovers / Mistress / Timer+Password。
> 也就是说：如果某把锁原本的默认时长比你的配置**更长**，它会被**缩短**。
> 每次覆盖都会在控制台打印 `游戏给的 X → 改为 Y`，所以不会莫名其妙。
>
> **与其它插件的碰撞面**：`InventoryLock` 这个函数**已经被 BCC 和 DOGS 挂了**（你的环境实测）。
> 本脚本优先级最低，即**排在它们之后执行** —— 所以初始时长最终听本脚本的配置。
> 每次覆盖都会在控制台留一行 `初始时长 [部位] 锁名：游戏给的 5 分 → 改为 1 小时`，不会悄悄改掉别人的意图。
> 不想要这个覆盖：面板里关掉，或 `__DLS.settings.timerDefaults.initial.enabled = false; __DLS.save();`
>
> 另外，`InventoryLock(..., Update = false)` 这类调用（`Validation.js:409`、`Inventory.js:729/1546`）
> 游戏**根本不会**给锁设计时器 —— 那种情况下本脚本也**不会**凭空塞一个进去。

## 3. 怎么加载

**方式 A —— 控制台粘贴（最快，先这样测）**

1. 打开游戏，F12 → Console
2. 把 [src/dls.user.js](../src/dls.user.js) **全部内容**复制粘贴进去，回车
3. 看到 `[DLS] 已注册 mod：DLS v0.1.0` 就成了

**方式 B —— Tampermonkey / Violentmonkey（长期用，推荐）**

两个管理器都支持；本脚本已经为它们做好适配（脚本头里带了完整元数据与说明）。

**Tampermonkey**：图标 → 管理面板 → `+`（新建脚本）→ 全选删掉模板 → 粘贴
[src/dls.user.js](../src/dls.user.js) 全部内容 → `Ctrl+S` 保存 → 刷新游戏页面。
（也可以把 `.user.js` 文件拖进浏览器，TM 会弹出安装页。）

**Violentmonkey**：图标 → `+`（新建脚本）→ 同上粘贴保存 → 刷新页面。

**必须保持的头部设置**（改错就是"装了没反应"）：

```
// @match  *://*/BondageClub/*
// @match  *://*/*/BondageClub/*
// @match  *://*/*/*/BondageClub/*
// @include *BondageClub*        ← @match 的兜底（非标准端口/更深路径）
// @run-at document-start
// @grant  none                  ← ★ 最关键
// @noframes                     ← 游戏在顶层窗口，避免在别处 iframe 里误注入
```

- **`@grant none` 不能改**：只有 `none` 才在**页面上下文**运行，才能摸到 `bcModSdk`、
  `OwnerTimerChooseOptions` 这些游戏全局。一旦加上任何 `GM_*` 权限，脚本会被管理器的
  沙箱隔离 → 所有功能失效。**所以本脚本刻意不使用 `GM_setValue` / `GM_registerMenuCommand`**，
  配置走 `localStorage`（与页面同源，控制台粘贴方式也通用）。
- **管理器的「沙箱/隔离上下文」选项要关掉**（TM 的 `Sandbox`、VM 的类似选项）。
- **`@run-at document-start` 也是必须的**：钩子要在游戏初始化前就位；
  那时游戏符号都还不存在，所以脚本一切靠"轮询补挂"（每 1.5 秒试一次，见源码 `tick()`）。
- **重复注入会自我保护**：如果同一个脚本被注入两次（既装了脚本又在控制台粘贴过、或更新后重新注入），
  启动时会**先卸载旧实例**并在控制台提示；可用 `__DLS.replacedPrevious` 查看本次是否发生了替换。
- **没有自动更新**：本脚本没有 `@updateURL`（没有托管地址），换版本＝重新粘贴一次。

**装好后的确认**：刷新游戏 → F12 控制台应出现

```
[DLS] 已注册 mod：DLS v0.1.0 build b23（SDK 1.2.0 / apiVersion 1）
[DLS] 已注册「设置 → 拓展组件」设置页：DLS
```

以及右下角出现 `锁工具：开` 悬浮条。**没有这些** → 跑 `__DLS.report()` 看现状；
若提示"没有等到游戏自带的 bcModSdk"，按上面三条检查 `@grant` / `@run-at` / 沙箱选项。

**方式 C —— FUSAM**（你已经在用它加载十余个插件）
把文件放进 FUSAM 的插件来源即可。注意 FUSAM 加载的插件同样是**页面上下文**，
但它不是用户脚本、不读 `// ==UserScript==` 头 —— 所以 FUSAM 方式下
`@match` / `@run-at` 这些不生效，注入时机由 FUSAM 决定（本脚本对此已有容错：轮询补挂）。

## 4. 控制台命令

```js
__DLS.report()                                  // 现状一览；出问题就把它贴给我
__DLS.setTimerDefault('owner', 'Hours', 8)      // 改某一类锁的默认时长
__DLS.setTimerDefault('mistress', 'Hours', 4)
__DLS.setTimerDefault('passwordTimer', 'Hours', 2)
__DLS.setPassword('MYCODE')                     // 改默认密码（自动大写、去非法字符）
__DLS.setPassword('MYCODE', '提示语')            // 顺便带默认提示语
__DLS.applyTimerDefaults()                      // 立刻重新应用一次
__DLS.prefillPassword()                         // 手动触发一次密码预填
__DLS.reset()                                   // 恢复出厂默认
__DLS.unload()                                  // 卸载（移除全部钩子）
```

改完会自动存进 `localStorage['dls:settings:v1']`，刷新仍生效。

## 5. 验收清单（请照着做，然后把结果告诉我）

### 机械验收（推荐，不用你自己判断）

```js
__DLS.verify.arm(5)      // 开始观测 5 分钟；它会打印要你做什么
```

然后：① 打开一个计时锁的设置界面，**把 ◀ / ▶ 两边都点几下**，顺手切一下单位；
② 打开一个**还没设过密码**的密码锁的「首次设置」界面。

最后：

```js
__DLS.verify.report()
```

它会逐条给出 ✅ / ❌：SDK 注册、计时锁默认值是否写进选择器、
**★ 手动点 ◀/▶ 是否真的改动了选择器**（这一项证明默认值没有被每帧强设覆盖，是本脚本最容易写错的地方）、
`#SetPassword` 是否出现且被预填成你配的密码、是否收到过好友快照。**把整段贴给我就行。**

### 手动验收（想自己看一眼的话）

1. **加载**：粘贴后出现 `[DLS] 已注册 mod：DLS v0.1.0`（SDK 1.2.0 / apiVersion 1）
2. **计时锁默认值**：物品栏 → 自己的物品 → `Lock` → 选 `Timer Padlock` → 进设置界面
   - 期望：时间选择器显示 **1 Days**
   - **关键**：点 `◀` / `▶` 能正常改数值、能切换单位 —— 如果能点动，说明没有"每帧强设"的 bug
3. **换一类锁**：退出后再进 `Mistress Timer Padlock` / `Owner Timer Padlock`
   - 期望：分别显示 `2 Hours` / `1 Days`
4. **密码预填**：选 `Password Padlock`，进**首次设置**界面（还没设过密码的锁）
   - 期望：密码框已填好 `ABC`，提示语框为空
   - 预填**不会**自动上锁 —— 你不点 `Change Password` 就什么都不会发生
   - 试着把 `ABC` 改成别的 → 退出 → 重新进：应该保留你自己的改动（脚本不覆盖已输入的内容）
5. **收尾**：`__DLS.report()`，把输出贴给我（贴之前可以把设置原文那一行里的密码删掉）

## 6. 已知限制与设计取舍

- **计时锁的"默认时长"是全局选择器**：每当你点一个锁准备装上去（`DialogLockingClick`），脚本会把选择器重置回默认值。
  这是"默认值"应有的语义 —— 代价是你在一个界面里手改的选择不会保留到下一个界面。
  如果你更喜欢"只在启动时设一次、之后完全不动它"，说一声，我加个开关。
- **密码明文存 localStorage**（按你的决定）。注意它会出现在 `__DLS.report()` 里 —— 贴给我之前先删掉那一行。
- **组合锁（Combination Padlock，4 位数字）暂未覆盖**。它的输入框 id 是 `CombinationNumber` / `NewCombinationNumber`，要做很容易，等你需要。
- 页面若用 CSP 禁止 `eval`，**计时锁默认值会不可用**（那几个变量是 `const`/`let` 声明的，不在 `window` 上，只能靠全局 eval 读写）；
  密码锁不受影响。启动时会有明确告警。
- **只对"你自己有权操作"的锁生效** —— A1 只是改界面默认值，不绕过任何权限判断。

## 7. 与现有插件的共存

你的环境里有 FUSAM + 十余个插件，**586 个函数已被 hook**，所以本脚本刻意做到最小侵入：

- 注册名 `DLS` + `allowReplace`，`__DLS.unload()` 可随时完全移除
- 只挂 **冷路径**钩子：`DialogLockingClick` + 各密码锁的 `…Load`
- **不挂任何每帧调用的函数**（例如 `…DrawHook`、`CharacterRefresh`），
  也不使用 `patchFunction`（那是对源码做字符串替换，版本一漂就坏）
- **不发任何网络请求**

## 8. 出问题时怎么排查

**首选：一条命令把全部诊断打出来**

```js
__DLS.selftest()
```

它会逐项检查：SDK 是否注册上、**计时锁选择器**哪个已加载/已应用/下标换算对不对、
**密码锁钩子**状态与页面上实际存在的输入框、页面上实际存在哪些 `InventoryItemMisc*Password*` 全局名字、
**格式刷**的目标与可改件数、**功能 B** 的状态、以及**本脚本挂的钩子有没有和其它插件重叠**。
把整段输出贴给我就能定位问题。

```js
__DLS.report()                 // 更详细的现状快照
bcModSdk.getModsInfo()         // 看本脚本有没有注册上
bcModSdk.getPatchingInfo()     // 看某个函数被哪些插件 hook 了
```

想彻底停掉：`__DLS.unload()`，或者刷新页面。

---

## 9. 格式刷与好友盯梢：已移出本插件

这两块**已经从 DLS 里摘出去**，将来各自做成独立插件。原因：它们与"默认锁设置"是两件事，
放一起会让 DLS 变得又大又难验证。

- **格式刷**（把一身锁批量设成同一时长/密码）：草稿保留在 [`wip/brush.draft.js`](../wip/brush.draft.js)
- **好友盯梢**（上线提醒 + 房间历史）：草稿保留在 [`wip/friend-watch.draft.js`](../wip/friend-watch.draft.js)

**DLS 为将来那个格式刷插件留了接入点**（避免两边各写一套权限判定、日后漂移）：

```js
window.__DLS.api.apiVersion                  // 接口版本（不兼容时会递增）
window.__DLS.api.gateForLock(item, lock, C, mode)   // 权限闸门：通过返回 null，被拒返回原因
window.__DLS.api.knownLocks()                // 有自己权限条件的锁型
window.__DLS.api.defaults()                  // 当前设置（只读用途）
window.__DLS.api.notify(text)                // 游戏内提示（走 ToastManager）
```

`mode` 取 `'timer' | 'password' | 'combination'`。新插件只要 `gateForLock` 通过，
就可以照 DLS 的写法去改锁属性并 `ChatRoomCharacterItemUpdate(C, group)` 同步。

---
## 11. 右下角的悬浮控件（前端按钮）

进游戏后右下角会出现一个小条：

```
[ 锁工具：开 ] [ 设置 ]
```

- **`锁工具：开 / 关`** —— 一键切换整个锁工具（默认时长 + 密码预填 + 格式刷）的开关。绿色=开，红色=关。
  关掉之后脚本完全不动游戏数据（好友盯梢是独立开关，不受影响）。
- **`设置`** —— 展开面板，里面可以改：
  - **上锁时的初始时长**（★ 就是"计时锁默认时长"）
  - **选择器默认（Owner/恋人）** —— 点一次「添加」加多少（恋人锁与 Owner 锁共用这一套，见 §15 末尾）
  - **密码锁默认密码**
  - **`刷计时锁` / `刷密码`** —— 对"对话框当前聚焦的角色"执行格式刷；干跑模式下点第一下出计划、6 秒内再点一下才执行
  - **`精确时长（T1-B）`** + 「刷这一把」—— 把剩余时间精确设成你填的 `hh:mm:ss`（见 §12）
  - **`锁型默认（T1-A）`** + 「设为该锁型默认」—— 改"当前聚焦物品上那把锁"的**锁型**默认时长（见 §12）

改完即时生效并自动保存（`localStorage['dls:settings:v1']`）。

> 为什么是 DOM 浮层而不是画布按钮：BC 的对话框是 canvas 自绘的，按钮位置只能靠反复试坐标；
> DOM 浮层不受画布坐标影响、样式随时能改，也不会有"点了没反应/点错位置"的问题。
> 它只占右下角一小块，并且会拦下自己的鼠标事件，不会干扰游戏操作。
> 不想要它：执行 `__DLS.settings.ui = false; __DLS.save();` 后刷新。

### 面板里的单位下拉框

下拉框里的单位**不是写死的三个**，而是从游戏自己的 `TimeUnits`（`Common.js:53`）读出来的；
读不到时退而使用"已加载的锁选择器里出现过的单位"。所以：

- `Minutes / Hours / Days` 是 R132 的基础单位
- **`Days` 只有 Owner 锁的选择器会用到**（`OwnerTimerPadlock.js:6`），但它同样可以用于初始时长
- `Months` 在 R132 **不是**选择器单位 —— 它只出现在时长**格式化**函数里
  （把 400 天显示成"1 年 1 个月"那种），所以下拉框里不会出现
- 面板每次展开都会重填一次下拉框（那时按需加载的锁界面脚本通常已就位，单位表才完整）
- 命令：`__DLS.units()` 可以随时看游戏当前认识哪些单位

---

## 12. 精确编辑计时锁时长（hh:mm:ss）

T1 **已实现** —— A + B 两种读法都做了。

### T1-A：按**锁型**改默认时长（改锁资产自己的 `RemoveTimer`）

```js
__DLS.assetTimers.available()                      // 列出所有计时锁 + 当前默认值 / 上限
__DLS.assetTimers.set('MistressTimerPadlock', '02:00:00')
__DLS.assetTimers.setFocused('01:30:00')           // 用"当前聚焦物品上那把锁"的锁型
__DLS.assetTimers.list()                           // 看我的设置（含与资产当前值的对比）
__DLS.assetTimers.clear('MistressTimerPadlock')
__DLS.assetTimers.clearAll()
```

**为什么直接改资产最干净**：游戏自己就用 `Lock.Asset.RemoveTimer` 当初始值
（`Inventory.js:1485` → `Timer.js:166`）。而且这两处也读它，改了会**一并生效**：

- `TimerPadlock.js:63` 的「Restart Timer」按钮恢复到的时长
- Mistress / Owner 计时锁「随机 ±」按钮的步长（`asset.RemoveTimer * 3 / 60` 分钟）

所以**不只你自己上的锁** —— 任何走游戏上锁路径的情况都会用新默认，这正是"只要有权限就允许修改"的体现。

⚠️ 这是**运行时**改动（改的是内存里的 `Asset` 对象，刷新即失效）→ 脚本会把设置存起来、**刷新后自动重放**。

**优先级**：T1-A 的按锁型设置 **>** §2 里那个全局 `initial`。设了锁型默认就用它；没设才用全局值。

### T1-B：把**这一把锁**的剩余时间精确设成 hh:mm:ss

```js
// （"批量把一身锁设成同一精确时长"属于格式刷范畴，已随格式刷移出，见 §9；
//   单把锁的精确时长用原版锁界面里的 DLS 输入框，见 §13）
```

对**任何你有权限的锁**都可以用（复用格式刷那套权限闸门与节流）；
上限按**每把锁自己的** `Asset.MaxTimer` 截断，并在计划里标注。

### 输入格式（"写死格式"）

`hh:mm:ss`，**只认这一种**：小时 2~4 位（所以 `72:00:00` 这种长时长可以写）、分和秒必须两位且 ≤59。
`1h` / `90` / `1:30` / `00:60:00` 一律拒绝。想先单独验证格式：

```js
__DLS.hms.parse('01:30:00')             // → 5400
__DLS.hms.format(5401)                  // → '01:30:01'
__DLS.hms.resolve('02:00:00', 3600)     // → {ok:false, reason:'超出该锁允许的上限 01:00:00', capped:'01:00:00'}
```

### 面板入口

右下角「设置」里多出两行：

- **`精确时长（T1-B）`** + 「刷这一把」→ 对当前聚焦角色执行（干跑两步确认）
- **`锁型默认（T1-A）`** + 「设为该锁型默认」→ 把"当前聚焦物品上那把锁"的**锁型**默认设成该值

### 与"约束"的关系（你之前提的那条）

**默认时长 / 默认密码只在"自己第一次挂上锁"时生效；打开旧锁不重置任何东西**：

- 初始时长只在 `InventoryLock` 内部跑，而"打开旧锁界面"根本不经过它；
  A1b 也只预填 `LockMemberNumber === 你` 的锁 —— 别人上的、NPC 上的、没有上锁者的旧锁都不填。
- 而 T1-B 是**你主动点**才生效的，所以它当然可以作用在旧锁上（这正是它的用途）。

---

## 13. 原版锁界面里的 DLS 精确时长输入框

计时锁的原版界面里会多出一个**输入框**和**「DLS 应用」按钮**：

```
[ hh:mm:ss ]  [ DLS 应用 ]
```

**用法**：在输入框里填 `hh:mm:ss` → 点「DLS 应用」→ 当前聚焦物品上那把锁的剩余时间就被设成该值。
**留空**则什么都不做（你照样可以用游戏自己的「添加」按钮）。

- **权限**：和格式刷用**同一套**闸门 —— 对应"只要是玩家有权限的锁都允许修改"。
  没权限时会游戏内提示 `DLS 被拒绝：…` 并说明原因，**不会**动数据。
- **上限**：换算成秒后与该锁自己的 `Asset.MaxTimer` 比较，超出会被截断并明确提示。
- **格式**：严格 `hh:mm:ss`（见 §12）；格式错会在游戏内提示，且**不改数据**。
- 这个框只挂在**计时锁**的界面上（Timer / Owner Timer / Lovers Timer / Mistress Timer / Timer+Password）；
  切到非计时界面或退出时会自动收掉。

### 位置可能需要在你的分辨率上微调

坐标是 game canvas 坐标（2000×1000），默认放在既有控件上方的空档。**如果它和别的界面元素重叠**，改这几个数就好：

```js
__DLS.settings.lockBox = { enabled: true, cx: 1260, cy: 330, w: 320, bw: 180, bh: 56 };
__DLS.save();
```

- `cx / cy` = 输入框**中心**（`ElementPosition` 是以中心定位的，`Element.js:914-915`）
- `w` = 输入框宽度；`bw / bh` = 「DLS 应用」按钮的宽/高（按钮用**左上角**定位）
- 想彻底关掉这个框：`__DLS.settings.lockBox.enabled = false; __DLS.save();`

> 为什么用游戏自己的 `ElementCreateInput / ElementPosition / ElementValue / ElementRemove` 而不是自己造 DOM：
> 密码锁的输入框就是这么做的（`PasswordPadlock.js:31-32`），坐标走 canvas 坐标系、会自动处理缩放，
> 也不用猜游戏的 DOM 层级。
>
> ⚠️ 一个容易搞错的细节：`ElementPosition(ID, X, Y, W)` 的 `(X, Y)` 是**中心**，
> 而 `DrawButton(x, y, w, h)` / `MouseIn(x, y, w, h)` 的 `(x, y)` 是**左上角** —— 两者坐标系不一致。

---

## 14. 四种"密码类"锁支持的文本内容（源码实测）

你问的这件事我按源码逐个核对了。**真正有区别的只有"组合锁 vs 其余三种"**：

| 锁 | 输入框 | 允许的字符 | 长度 | 提示语 Hint |
|---|---|---|---|---|
| **组合密码锁** `CombinationPadlock` | `CombinationNumber` / `NewCombinationNumber` | **只有数字 0-9** | **正好 4 位** | ❌ 没有 |
| **密码锁** `PasswordPadlock` | `Password`（开）/ `SetPassword`（设） | **只有大写字母 A-Z** | **1~8 位** | ✅ **自由文本 ≤140** |
| **密码计时锁** `TimerPasswordPadlock` | 同上 | 同上 | 同上 | ✅ 同上 |
| **安全词锁** `SafewordPadlock` | 同上 | 同上 | 同上 | ✅ 同上 |

原文（都在 `refs/bc`）：

```js
// Validation.js:4-7
const ValidationCombinationNumberRegex = /^\d{4}$/;
const ValidationPasswordRegex = /^[A-Z]{1,8}$/;
const ValidationDefaultCombinationNumber = "0000";   // 组合非法时服务端重置成这个
const ValidationDefaultPassword = "UNLOCK";          // 密码非法时重置成这个
```

**后三种规则完全一样**，因为 `SafewordPadlock.js` 只有 66 行，Load / Draw / Click 全部委托给密码锁的函数。
几个容易踩的点：

- **空密码是合法的**（`PasswordPadlock.js:165` `if (pw === "" || ...)`）→ 空密码也会 `LockSet = true`，
  等于"谁都能开"。本脚本**拒绝**空密码（防误清），所以做不到这件事。
- **提示语不转大写、不校验、不截断** —— 只靠输入框的 140 上限（`PasswordPadlock.js:31`），
  服务端只在白名单里保留这个键（`Validation.js:11`）。所以**中文/emoji 都能存**。
- **安全词锁和组合锁是"瞎眼时也能查看"的唯二两种**（`Dialog.js:1377-1382` `DialogCanInspectLock`）：
  别的锁在你瞎眼时连界面都打不开。
- `ChatRoomSafewordChatCommand`（`ChatRoom.js:6542`）是**全局 /safeword 聊天命令**，跟安全词锁无关，别混。
- **组合锁打字会被打乱**：`CombinationPadlock.js:66-97` 在玩家瞎眼或笨拙度>0 时，
  会给每个输入的数字**加偏移量**（笨拙还带随机抖动）→ 没法打字输对。
  本脚本**直接写 `Property.CombinationNumber`**，绕过这个机制（本来就该如此）。

### 本脚本对这两类的支持

```js
// 默认提示语（自由文本 ≤140，中文/emoji 都行，不做大小写转换）
__DLS.setPassword('ABC', '这是我设的锁，密码问我要 🎀')

// 组合密码锁：正好 4 位数字
__DLS.setCombination('1234')                    // 设为默认（会预填进「新组合」框）
（批量套用已随格式刷移出；单个锁仍可用原版界面里的 DLS 输入框，见 §13）
```

- **组合锁默认不覆盖已设置的组合**：原版 UI 要先**输对旧组合**才能改（`CombinationPadlock.js:184`），
  本脚本直接写属性等于绕过这一步 —— 所以默认跳过，要覆盖得先开
  `__DLS.settings.brush.overwriteSetCombination = true`（跟密码的 `overwriteSetPassword` 同一个设计）。
- 组合锁的默认值只**预填**进「新组合」输入框，**最终仍需你输对旧组合**再点原版的「Change」——
  这样既方便，又不会替你绕过原版的保护。

### 上锁时**直接应用**（不用再点原版的「设置密码」/「Change」）

原版流程是：挂上锁 → 再打开锁界面 → 手打密码 → 点「设置密码」。**本脚本现在省掉这一轮点击**：
在你**刚把锁挂上自己身上**的那一刻，直接把值写进锁属性并同步。

```js
__DLS.settings.password.applyOnLock = true;      // 默认开：上锁时直接写密码 + 提示语 + LockSet
__DLS.settings.combination.applyOnLock = true;   // 默认开：上锁时直接写 4 位组合
__DLS.settings.password.onlySelf = false;        // 默认 false：无论上在谁身上都套默认值
```

| 锁类型 | 直接写入的字段 | 说明 |
|---|---|---|
| 三种字母密码锁 | `RemoveOnUnlock`（勾选框）→ `LockSet = true` → `Password` → `Hint` | **`LockSet` 必须一起置真** —— 游戏的 `…IsSet()` 是 `LockSet \|\| (LockMemberNumber 是数字且不是你)`，不置的话界面仍会当"未设置"。写入顺序按用户要求：**先勾，再设密码** |
| 组合密码锁 | `CombinationNumber` | 刚挂上的锁一般还没组合；若已有则不覆盖（与原版"要先输对旧组合"一致） |

**边界**：

- 只对 **`LockMemberNumber` 是你** 的锁生效（别人上的、NPC 上的都不动）
- `onlySelf` 默认 **false**：**给别人上锁也一样套默认值**（= 旧版行为）。想限制成"只对自己"才设 `true`
- **已经设过密码的锁一律保持原样**（`LockSet` 为真就跳过，不覆盖）
- 想恢复成"只预填输入框"：把 `applyOnLock` 设为 `false`
- **解锁时移除物品 / 计时结束时移除物品** = 原版那两个勾选框，上锁时直接写状态：
  `__DLS.setRemoveBehavior('password', true)` / `('timer', false)`

**诊断命令**：如果预填/直接应用没按预期发生，运行

```js
__DLS.prefill()
```

它会一次打印：当前界面上**存在哪些输入框**、预填**前后各自的值**、以及**当前配置**（密码/提示语/组合 + 各开关）。
`__DLS.selftest()` 里也会打印这几项配置。

---

## 15. 游戏内「设置 → 拓展组件」里的 DLS 页

进游戏后：**设置 → 拓展组件 → `DLS`**。

**整页直接画在 BC 画布上**（不是浮窗），内容**整体居中**、**字为黑色**：

```
        界面          计时锁
        密码锁        组合锁
        关于
                ✕ 关闭    ⟳ 重置
```

点分类进子页（子页有 `← 返回`）：

| 分类 | 能改什么 |
|---|---|
| **界面** | 总开关、**右下角悬浮条**（勾选即时生效）、锁界面里的精确时长输入框 |
| **计时锁** | 初始时长（**主人锁 / 恋人锁**各自一份 + 其它计时锁）、选择器增量（**主人锁 / 恋人锁** / Mistress / 密码计时）、计时结束时移除物品 |
| **密码锁** | 默认密码、默认提示语、解锁时移除物品、上锁时直接写入、只对自己生效 |
| **组合锁** | 默认组合、上锁时直接写入、只对自己生效 |
| **关于** | 目前只有全称 `DLS — Default locks setting` 与版本/build（其余以后补） |

操作：数字/单位用 `<` `>` 步进，开关点一下切换，需要打字的三项（密码 / 提示语 / 组合）
用**游戏自己的输入框**，填完点该行「应用」。底部只有 **✕ 关闭**（= ESC）和 **⟳ 重置**（会先确认）。

> **主人锁与恋人锁的默认值是分开的**：游戏里 `LoversTimerPadlock.js` 全文只有 9 行、
> 完全复用 Owner 计时锁的脚本，两者**共用同一组选择器全局变量**
> （`OwnerTimerChooseOptions / …Index / …Indexes`）。所以"两套默认"靠
> **在该锁界面打开 / 正要上这种锁的那一刻按锁型分别写入**来实现
> （`OwnerTimerPadlock → owner`、`LoversTimerPadlock → lovers`）。
> 初始时长（`initialByLock`）是普通属性，天然可以各存一套。

> **格式刷 / 好友盯梢 / 快捷键**都不在设置页里：前两者已**移出本插件**（将各自做成独立插件，见 §9），
> 快捷键入口按你的要求撤掉。想放回快捷键入口：把脚本里 `PREF_CATS` 中 `hotkeys` 那项的
> `hidden: true` 去掉即可。

改完**即时保存**，与右下角悬浮条共用同一份设置。

> 实现要点：每帧 `DrawButton` 画按钮时**同时登记它的矩形**，`click()` 只遍历这份数据 ——
> 所以"画出来的"和"能点的"永远一致，不会出现坐标漂移导致点了没反应。
> 布局常量集中在脚本的 `PREF_L`（`PREF_X0()` 给出居中后的左边界），
> 也可以用 `__DLS.prefLayout()` 看到当前值（想微调位置告诉我）。
> **为什么需要单独注册**：`bcModSdk.registerMod` 只管"挂钩子"，**不会**往那个菜单加条目。
> 那个菜单列的是游戏的注册表 `PreferenceExtensionsSettings`，要用
> `PreferenceRegisterExtensionSetting({ Identifier, ButtonText, load, run, click, unload, exit })` 注册
> （依据：本地类型镜像 `Preference.d.ts:85 / :118 / :125-202`）。
>
> 页面**直接画在 BC 画布上**（`DrawButton` / `DrawText` / `MouseIn`）；只有需要打字的地方才用
> 游戏自己的 `ElementCreateInput` + `ElementPosition`（与密码锁输入框同一套通道）。
> 官方注释也允许在 `load` 里建 HTML 元素，但你要的是"不要浮窗、直接显示在 BC 里"，所以没用那套。
>
> 如果这一页的位置和别的界面元素重叠，告诉我一声（固定定位，调起来很快）。

### 附：为什么没有"恋人计时锁"的单独设置

`LoversTimerPadlock.js` **全文只有 9 行**（就一个 `Validator`），它**完全复用 Owner 计时锁的脚本**：

```js
// LoversTimerPadlock.js（全文）
function InventoryItemMiscLoversTimerPadlockValidator(C) {
	return C.IsLoverOfPlayer() || C.IsOwnedByPlayer();
}
```

而选择器是 Owner 脚本里的**同一组全局变量** `OwnerTimerChooseOptions / …Index / …Indexes`：

```js
// OwnerTimerPadlock.js:3-9
const OwnerTimerChooseOptions = [ … ];
let OwnerTimerChooseOptionsIndex = 1;      // 默认 Hours
let OwnerTimerChooseIndexes = [0, 0, 0];   // 默认 [5 分钟, 1 小时, 1 天]
```

⇒ **游戏本身就不区分** Owner 锁和恋人锁的"默认时长/增量"，所以插件也不可能给出两个不同的值。
界面上因此标注为「选择器增量（Owner / 恋人锁共用）」。

---

## 16. 设置页右下角的两个 GitHub 按钮

设置页（**画布上**，不是浮窗）右下角、与「✕ 关闭 / ⟳ 重置」**同一行**、贴着画布**最右边**，有两个按钮：

| 按钮 | 打开 |
|---|---|
| **GitHub 详情页** | 你填的仓库地址本身 |
| **最近更新** | 仓库地址 + `/releases` |

**先填地址**（不填的话两个按钮是灰的，点了会提示怎么填）：

- 界面里填：**设置 → 拓展组件 → DLS → 界面 →「GitHub 仓库地址」**
- 或控制台：`__DLS.setRepo('github.com/你/仓库')`（可只写这一段，会自动补 `https://`、去掉末尾斜杠）
- 查看当前值：`__DLS.repo()`

地址存在 `localStorage`（键 `dls:settings:v1` 里的 `about.repoUrl`），刷新后仍在。

> 为什么不做在「关于」页：按你的要求，关于页只留全称与版本号。
> 这两个按钮点击时用 `window.open` 开新标签页 —— 用户脚本跑在页面上下文，
> 从点击里调用不会被弹窗拦截；万一被拦截，地址也会打到控制台（`[DLS] 打开：…`）。
---

## 17. 悬浮条与返回按钮（b26）

- **悬浮条可以拖动**（避免挡住游戏内容）：按住条上任何空白处拖走即可。
  位置记在设置里（`dls:settings:v1` 的 `uiPos`），**刷新后仍在**。
  拖动超过 **4px** 才算拖动，所以单纯点 `锁工具：开/关`、`设置` 不会误挪位置。
  - 复位：**设置 → 拓展组件 → DLS → 界面 →「复位到右下角」**
  - 命令：`__DLS.uiPos(null)` 复位；`__DLS.uiPos({ left: 200, top: 300 })` 精确放置
- **「← 返回」按钮移到右上角**（原来是左上角）。用的是游戏自己的 `DrawButton`，
  所以外观与 BC 原生按钮一致。
- **悬浮面板与设置页对齐**（检查发现的不一致）：
  - 面板里原来那行「选择器默认（Owner/恋人）」**实际只改主人锁**，恋人锁那套根本没被改到
    → 现在拆成「选择器增量（主人锁）」与「选择器增量（恋人锁）」两行
  - 「上锁时的初始时长」→ 改成与设置页同名的「**初始时长（其它计时锁）**」
    （主人锁/恋人锁的初始时长在设置页的「计时锁」页里各有单独一行）
  - 面板是**快捷入口**（常用项），完整设置仍在设置页；两边读写的是同一份 `settings`
---

## 18. 语言（b28）

**设置 → 拓展组件 → DLS → 界面 →「语言」**，三档：

| 档位 | 含义 |
|---|---|
| **跟随游戏**（默认） | 读游戏里的 `TranslationLanguage`（落盘在 `localStorage["BondageClubLanguage"]`） |
| 中文 / English | 强制 DLS **自己那部分文案**用中文或英文 |

**锁的名字永远走游戏官方译名**，不受这个开关影响 —— 它直接读资产属性
`Asset.Description`（源 `Female3DCG.csv`，被游戏的 `TranslationAsset` 按语言改写），
所以和游戏界面里的叫法完全一致。

> 依据：`research/i18n-languages.md`（逐条带源码证据的调查报告）。

### 三个必须知道的坑（都已在代码里处理）

1. **取文本有三条互不相同的路径**，别混用：
   - 界面字符串 → `InterfaceTextGet(key)`（`Screens/Interface.csv`）
   - 资产专用文本（Intro/按钮）→ `AssetTextGet(key)`（`AssetStrings.csv`）
   - **锁的显示名 → `Asset.Description`** —— `AssetTextGet` **取不到**锁名；`Asset.Name` 是内部 ID，永不翻译
2. **覆盖度极不均衡**：锁显示名 7 语言都有但都不全（德语文件只译了一部分，其余回落英文）；
   锁界面文本**只有 RU/CN** 生效；界面字符串 DE/RU/CN/UA 有，**FR/TW 连文件都没有**。
   取不到时游戏返回哨兵串（`MISSING INTERFACE TEXT: …` / `MISSING TEXT IN …`）或空串
   → 代码一律判空并回落到内部名/自带文案。
3. **时序**：`AssetLoadDescription` 在 `AssetLoadAll()` 里**不被 await**，
   所以启动时读 `Asset.Description` 可能拿到英文占位 → DLS **只在渲染/点击时读**，不做启动缓存。

### 目前只做了中英两种

R132 支持 **EN / DE / FR / RU / CN / TW / UA** 七种界面语言，但 DLS 自己那部分文案
（"初始时长（主人锁）"这类游戏里没有的词）目前只准备了**中文与英文**，
其余语言按其**官方英文**兜底（不会出现空白或乱码）。

> 顺带纠错（来自调研）：`TimerPadlock` 的**官方英文名是 "Five Minutes Padlock"**
> （`Female3DCG.csv:1447`），不是 "Timer Padlock" —— 所以 DLS 不再自己编锁名。
---

## 19. 右上角的「关闭 / 返回」图标按钮（b29）

按用户要求改成**跟游戏自己一模一样**的图标与位置。依据是游戏自己的子界面外框源码：

```js
// wip/i18n/Preference.js:331   ← 游戏注册子界面时
menubarButtons: [ElementButton.Create(PreferenceIDs.exit, PreferenceSubscreenExit, { image: "Icons/Exit.png" })],

// wip/i18n/Preference.js:346   ← 子界面布局时
ElementSetPosition(`${PreferenceIDs.subscreen}-menu`, 1905, 75, "top-right");
```

所以 DLS 现在画的是：

- **图标**：`Icons/Exit.png`（游戏那个退出图标），用 `DrawImage` 画
- **位置**：菜单栏锚点 **(1905, 75) top-right**、按钮 56×56、间距 8 —— 与游戏的 `rtl` 一致，
  即 **关闭在最右、返回在它左边**
- 游戏只为**它自己的**子界面画这个菜单栏；扩展页不会自动得到，所以 DLS 自己补一份
- 取不到 `DrawImage` 时用文字 `✕` 兜底（保证按钮一定可见可点）

底部动作栏因此只剩下 **⟳ 重置**（居中）。「关闭」＝调 `PreferenceSubscreenExit`（同游戏行为，ESC 一样有效）。
> **b30 修订（用户要求）**：右上角**只保留一个**图标按钮，不再并排两个。
> 它的行为就是"**返回上一层**"：子页 → 本插件首页；首页 → 退出设置页
> （调游戏的 `PreferenceSubscreenExit`，与游戏自己的退出行为一致）。
> 按钮位置/图标仍与游戏菜单栏一致：`Icons/Exit.png`、(1905,75) top-right、56×56。
### b31 / b32 修复的两个严重 bug（用户实测）

1. **右上角没有按钮** —— 原因：图标按钮被我画在了"**子页分支**"里，首页就完全没有按钮。
   现在画在 `prefDrawActions()`（**每页都画**），行为仍是"返回上一层"。
2. **悬浮条拖起来停不下** —— 原因：悬浮条自己挂了 `swallow()`，它会把 `mouseup` 的**冒泡**拦掉，
   于是 `document` 上的普通监听永远收不到 → 松开左键也不停。
   现在改用**捕获阶段**监听（`addEventListener(..., true)`），并在卸载时一并移除。

> 另外给 API 加了 `__DLS.prefPage()`（当前设置页在哪一页，`home` = 首页），诊断用。
### b33 / b34（用户反馈后）

- **图标改用正确的函数**：游戏画图标用的是 **`DrawImageResize("路径", x, y, w, h)`**（`refs/bc` 里全是这种用法）；
  我之前写的 `DrawImage` **函数名是错的**，所以只看到一个黑底板、根本没有图标。
- **图标 80px**、**水平翻转**（游戏没有翻转版，用 canvas `translate` + `scale(-1,1)` 实现）、
  **加黑框**（优先 `DrawEmptyRect`，取不到就手工画 4 条 2px 细边；**不用实心填充**，免得盖住图标）。
- **去掉「界面」页的 GitHub 填写**：设置页是给别的用户看的，不该出现作者的私人仓库地址。
  右下角那两个按钮仍在，地址用命令设置：`__DLS.setRepo('github.com/你/仓库')`。
- **语言按钮列出全部 7 种语言，且每个用它自己的语言写**：
  `Auto / English / 中文 / 繁體中文 / Deutsch / Français / Русский / Українська`
  （用户明确要求：正确是"中文 / English"，不是"中文 / 英文"）。当前生效的那个带 `●` 标记。
- 新增：`__DLS.prefLayout()` 现在还会给出 `iconSize / iconX / iconY`（诊断用）。
### b35（用户反馈后）

- **整个悬浮控件都能拖**（原来只有那根小条能拖）：监听挂在容器上，
  但**输入框 / 按钮 / 下拉框**上按下时不启动拖拽，免得给打字和点击添麻烦。
- **「界面」页去掉「右上角图标大小」一行**（设置项仍在，默认 **80**；要临时改就
  `__DLS.settings.iconSize = 100; __DLS.save();`，或告诉我给你一个命令）。
- **语言按钮保留全部语言**，但下面加了一行说明：
  「其余语言尚未完成，暂时按英文显示（锁名始终跟随游戏官方译名）」
  —— DLS 自己的文案目前只有中文与英文，其余语言按官方英文兜底；**锁名不受影响**。
### b36 / b37（用户反馈后）

- **抓着按钮也能拖**：`isInteractive` 不再排除 `BUTTON`（只排除 `INPUT/SELECT/TEXTAREA/OPTION`，
  它们需要焦点）。拖动阈值也从 `|dx|+|dy| < 4` 改成**单轴 > 5px**，
  并在松手时把 `moved` 复位 —— 之前手抖几像素就会被判定成"拖过"，
  于是紧接着的点击被吞掉（用户实测：**点「设置」收不起面板**）。
- **语言说明句改成居中**（左对齐时整句向右伸太远，用户反馈有字跑到看不见的地方），并缩短了文案。
- 顺带清掉一段我自己加的重复对齐代码（`prefTxt` 里本来就有）。
### b38（用户反馈后）

- **拖拽按钮时只当拖拽，不再触发按钮**：`mouseup` 早于 `click`，而 `onUp` 里就把 `moved` 复位了，
  所以抑制点击不能靠 `moved` —— 改用独立的锁存标志 `suppressClick`，等那次 `click` 来了再清掉。
- **默认密码改成 `ASRESIA`、默认提示语改成 `23575`**（`DEFAULT_SETTINGS` 里的初值）。
  ⚠️ 这只影响**新装/重置后**的默认值：你库里已经存了旧设置，所以要在游戏里生效，二选一：
  - 设置页 → DLS → **密码锁** → 改「默认密码」「默认提示语」→ 各点一次「应用」
  - 或控制台：`__DLS.setPassword('ASRESIA', '23575')`
### b39：插件图标（杨柳 logo）

- 按用户给的**手绘杨柳参考图**描线：自适应阈值（跟"局部纸面亮度"比，比底色暗的才算墨）
  → **纯黑细线 + 透明底**，256/128/64 三个尺寸，源文件与生成脚本在 [assets/](../assets)（`make-logo.py`）
- **内联成 base64 data URI** 塞进脚本 → 别的用户装上也能看到图标，**不依赖任何外链/托管**
- 通过 `PreferenceRegisterExtensionSetting({ ..., Image: LOGO_DATA_URI })` 交给游戏
  （类型 `Image?: string | (() => string)`，`Preference.d.ts:149`；游戏自己把图标排在按钮**左边**）
### b40：logo 重画（修断线 + 补全圆框）

描线版的问题是**铅笔稿有淡处** → 阈值一卡线条就断断续续 ✗，圆框也没画全 ✗。
所以改成**程序重画同一构图**：

- **完整加粗圆框**（3.2px @256）
- **连续柳条**6 根（贝塞尔曲线，长短交错、略外弓）
- **实心柳叶**（多边形填充，不再有断口），左右交替、朝斜下
- 主枝从左边缘伸入、向右上弯，枝上另有零星叶片

尺寸 256 / 128 / 64，脚本 [assets/make-logo.py](../assets/make-logo.py)；128px 版内联为 data URI 供游戏使用。
### b48：logo 定稿（用户提供的第二张源图）

用户给了一张**数字绘制**的杨柳（无纸纹、无暗角、背景均匀）→ 这类源图**不需要描线**
（自适应阈值那套是为照片准备的），直接**按暗度取 alpha** 即可：

- 纸色取四角平均（246）✓ → `alpha = (paper − 灰度) / (paper − 8) × 255` ✓ → 保留原来的浓淡层次 ✓
- 裁到内容 → 补正方形 → 4% 边距 → 256 / 128 / 64 ✓
- 用户选定"**忠实版**"（保留黑叶 + 灰叶的两档浓淡）✓
- 128px 版内联为 data URI ✓；旧版（描线 + 圆框）存档在 `assets/archive/old-circle-*.png` ✓