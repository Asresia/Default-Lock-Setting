# DLS — Default Lock Setting

Bondage Club（R132）的用户脚本。给"上锁"预设默认值，省掉每次手动填。

## 功能

1. **计时锁默认时长** —— 上锁那一刻直接写入
   - **主人锁 / 恋人锁 / 其它计时锁各自一套**（互不影响）
   - 选择器增量（点一次「添加」加多少）
   - 「计时结束时移除物品」勾选状态
2. **密码锁默认密码** —— 上锁时直接写进去
   - 默认提示语（自由文本 ≤140）
   - 「解锁时移除物品」勾选状态
   - 密码规则跟原版一致：A–Z，最多 8 位
3. **组合锁默认组合** —— 4 位数字
4. **原版锁界面里的精确时长框** —— 在原版计时锁界面输入 `hh:mm:ss`，点「DLS 应用」

外加：右下角可拖动的悬浮条 + 游戏内「设置 → 拓展组件 → DLS」设置页。

## 安装

需要 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)：

**https://raw.githubusercontent.com/Asresia/Default-Lock-Setting/main/DLS.user.js**

装好后刷新游戏，控制台应出现 `[DLS] 已注册 mod：DLS v0.1.1 build b53`。

> 脚本必须保持 `@grant none` 和 `@run-at document-start` —— 改成 `GM_*` 会被沙箱隔离、看不到游戏全局。

## 用法

**设置 → 拓展组件 → DLS**，五页：界面 / 计时锁 / 密码锁 / 组合锁 / 关于。

- 数字与单位用 `<` `>` 步进，开关点一下切换，需要打字的三项填完点「应用」
- 右下角悬浮条：拖动可挪位（在输入框/按钮上按住不会拖），「设置」展开面板
- 设置页右上角的图标 = 返回上一层（在首页时 = 退出设置页）

## 控制台命令

```js
__DLS.report()                                  // 现状一览（出问题就贴这个）
__DLS.selftest()                                // 自检
__DLS.setTimerDefault('owner', 'Days', 1)       // 改某一类锁的默认时长
__DLS.setPassword('ASRESIA', '23575')           // 改默认密码 + 提示语
__DLS.setCombination('1234')                    // 改默认组合
__DLS.reset()                                   // 恢复全部默认（只动 DLS 自己的设置）
__DLS.unload()                                  // 彻底卸载
```

## 注意

- **只影响之后新上的锁** —— 不会改你已经上好的锁（要改旧的用原版界面，或第 4 项那个输入框）
- 密码以明文存在浏览器 `localStorage`（键 `dls:settings:v1`）
- 只写自己那一个存储键 —— 不会碰游戏或其它账号的数据
- 计时锁的「选择器默认值」写在游戏自己的全局变量上，不做每帧强设（否则 ◀/▶ 会点不动）
- 没有任何 `GM_*` 权限、没有外链依赖（图标是内联的）

## 许可

MIT © Asresia(Dr)23575 — 版本历史见 [CHANGELOG.md](CHANGELOG.md)
