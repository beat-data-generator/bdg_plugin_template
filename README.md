# Beat Data Generator 插件模板

本仓库是 [Beat Data Generator](https://github.com/BUGJI/beat_data_generator) 的官方插件模板/脚手架。
仓库内的 `renderer.js` 是一份**可直接运行的完整示例**,覆盖当前插件 API 的主要能力;`main.js`
是主进程入口的最小骨架。基于本模板开发时,改掉 `manifest.json` 的 `id` / `name` 与入口脚本即可。

> 完整的接口清单(命名空间 / 方法 / 类型 / 示例)见宿主仓库的
> [**插件 API 参考**](https://github.com/BUGJI/beat_data_generator/blob/main/docs/plugin-api.md)。

插件用于扩展踩点编辑器:导入/导出新格式、数据生成与批量编辑、侧栏浮动静默面板、
时间轴叠加层、自定义快捷键、独立预览窗口,以及针对特定游戏新增“类型化轨道”(如翻转事件),
它们与内置踩点共用同一条节拍时间轴。

## 插件形态

插件是一个文件夹,内含:

```
my-plugin/
├─ manifest.json    # 元信息(必需)
├─ main.js          # 可选:主进程入口(全 Node + Electron 权限)
├─ renderer.js      # 可选:编辑器页面内执行的脚本(注册 UI 贡献)
└─ …                # 插件自带的 HTML/静态资源
```

扫描目录:

- 用户目录 `<userData>/plugins`(设置页可一键打开);
- 开发模式下同时扫描项目根目录的 `plugins/`(示例插件放这里)。
- manifest 解析失败的插件会列在设置中并显示错误,不影响其余插件。

### manifest.json

```json
{
  "id": "dev.bdg.example-basic",
  "version": "0.1.0",
  "name": { "zh": "示例插件", "en": "Example Plugin" },
  "description": { "zh": "…", "en": "…" },
  "main": "main.js",
  "renderer": "renderer.js"
}
```

`name`/`description` 可为字符串或 `{ zh, en }`。`id` 建议反向域名风格且**不得含冒号 `:`**。

## renderer.js(UI 侧)

`renderer.js` 是普通脚本,通过全局注册函数声明入口。类型提示:

```js
/// <reference path="plugin-api.d.ts" />
window.__bdgPluginRegister(function activate(api) {
  // 在此注册所有贡献(见 PluginApi 类型)
  return function dispose() {
    // 卸载清理(取消订阅等)
  };
});
```

可以注册的贡献:

- `api.ui.registerAction({ label, run })` → 出现在顶部「插件」菜单;
- `api.ui.registerPanel({ id, title, mount, defaultWidth?, defaultHeight?, minWidth?, minHeight? })` → 浮动静默窗口(可拖动、右下角可缩放),`mount(hostEl)` 里用 DOM 自由渲染,返回可选清理函数;返回 `PanelHandle` 可 `open()/toggle()` 等。**窗口位置与尺寸按「插件 + 面板 id」自动记忆**并重启恢复,`defaultWidth/Height` 为首次打开的初始尺寸;
- `api.ui.registerShortcut({ id, label, combo, run })` → `combo` 形如 `Alt+1`、`Ctrl+Shift+F`;
- `api.ui.registerImporter({ label, run })` → 出现在「文件 → 导入…」;
- `api.ui.registerExporter({ label, run })` → 出现在「导出」菜单的“插件导出”分组;
- `api.ui.registerTimelineOverlay({ id, mount, z? })` → 在时间轴视口内叠加一层(可视化/可拖拽);配合 `api.timeline.*` 换算与 `api.events.on("view", …)` 跟随滚动/缩放;
- `api.ui.registerBarButton({ id, title, icon?, toggle?, active?, order?, run })` → 在工程栏快捷行加一个小按钮(开关型);
- `api.trackTypes.register({ id, trackName, pointName, color?, fields })` → 新增类型化轨道,侧栏 `＋` 可创建,点在属性卡里编辑字段。

> **菜单入口只保留一个**:注册面板(`registerPanel`)已自动在「插件」菜单生成一个带开合状态的菜单项,
> 因此**不要再用 `registerAction` 重复开关同一个面板**。

## main.js(主进程侧)

在主进程加载,拥有完整 Node / Electron:

```js
module.exports = function activate(ctx) {
  ctx.log("loaded", ctx.dir);
  ctx.registerHandler("ping", () => "pong");
  ctx.onDispose(() => {});
};
```

渲染进程用 `api.callMain(method, ...args)` 调本插件注册的处理器。`activate` 需保持同步。

## 数据与工程文件

- 快照:`api.project.snapshot()` 一次给出节拍视角与 `timeMs` 时间视角(见字段)。
- 编辑一律走 `api.project.edit.*`,自动计入撤销栈;多步编辑用 `edit.batch(fn)` 合并为一次撤销。
- 类型化轨道:轨道带 `type: "<pluginId>:<localId>"`;点带 `attrs`,字段默认值在放置/粘贴时自动补齐,或由插件用 `setMarkerAttrs` 修改。
- 内置导出(.txt / EDL / 踩点指示灯)**不**包含类型化轨道;插件导出自行读取。
- `.bdg` 直接存 `type` + `attrs`,字段全可选、向后兼容。若保存的工程含某插件类型而该插件未安装:轨道与数据照常显示(点属性只读),属性卡提示需要安装对应插件。

## 渲染↔系统能力

编辑器渲染层是沙箱(`sandbox:true` + `contextIsolation`)。插件拿到的是受限桥接:

- 数据/编辑/播放/选区/事件、`api.timeline.*`(只读时间轴换算)、
  `api.system.pickFile/saveFile/readText/writeText/readBytes/writeBytes`、
  `openWindow(加载任意页面)`、`api.system.audioPath()`(当前加载音频的绝对路径,便于 main.js 用 Node 读取并打包)、`callMain`;
- **音频能力**:`api.audio.getBuffer` / `encodeWav` / `replaceFromBytes`(编码 WAV、解码并替换当前音频;替换不进入撤销栈);
- **持久化**:`api.storage.get/set/remove/all/clear` —— 按插件隔离、由主进程落盘的键值库(同步读写,**替代 `localStorage`**);
- 需要任意 Node 能力时让插件自带 `main.js` 处理。本系统**不弹权限确认**,安装插件即视为信任。

## 本模板示例覆盖

本仓库的 `renderer.js` 一个文件演示了:类型化轨道、可记忆尺寸的面板、工程栏开关按钮、
时间轴叠加层(跟随播放头 + `view` 事件)、快捷键、导入/导出、`api.storage` 与 `callMain`。
开发时把本目录放进插件扫描根即可(用户目录 `<userData>/plugins/`,或宿主工程根目录的 `plugins/`)。

## 常用命令

```bash
npm run typecheck   # 改动编辑器代码后跑类型检查
npm run build
```

## 发布与插件市场

插件通过 GitHub Release 分发,并登记到官方插件市场索引,即可被应用一键安装。

### 1. 打 tag 发布

`manifest.json` 的 `version` 必须与 tag 一致(tag 形如 `v1.2.3`,可省略 `v` 前缀)。
打 tag 后组织级工作流会自动打包并创建 Release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

产物是 `plugin.zip`(`manifest.json` 位于压缩包根目录),工作流会打印 SHA-256。
默认不打包 `.github/`、`.gitignore`、`.gitattributes`、`.pluginignore`、
`.editorconfig`、`node_modules/`;需要排除更多文件时编辑根目录的 `.pluginignore`。

### 2. 登记到市场

在 [registry](https://github.com/beat-data-generator/registry) 仓库新增
`plugins/<name>.json`(其中 `id` 必须与本插件 `manifest.json` 的 `id` 完全一致),
最低宿主版本 `minAppVersion`、分类与标签也在这里声明。合并后,registry 的定时任务
会读取 Release 资产的 SHA-256 写入 `versions`,插件随后出现在应用内的插件市场中。

## 许可与发布

- 你编写的插件属于你自己的作品(版权归你),可自行选择开源协议。
- 宿主编辑器 **Beat Data Generator** 以 **GNU GPL v3** 发布(作者 BUGJI)。插件由宿主加载器装载运行,分发插件时建议注明与宿主的关联。
- 官方插件模板/脚手架见 <https://github.com/beat-data-generator/bdg_plugin_template>。
