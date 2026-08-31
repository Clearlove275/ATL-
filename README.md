# 率土同盟数据库

一个面向《率土之滨》同盟的数据统计网站：**截图识别自动录入「武勋 / 势力值」**，支持**多用户同盟数据库**、**实时更新**、**任意两次时间的变化值对比**与**交互式排序**。

> 目标不是“谁氪得多、势力高谁优秀”，而是判断：谁稳定在线、谁能打、谁在关键任务中真正帮盟里推进。

## 功能特性

- 📷 **截图识别**：上传游戏截图，浏览器本地用 Tesseract.js 识别中文，自动提取「武勋（功勋）」「势力值」「贡献总量」「贡献周量」；识别结果可人工核对，也支持粘贴文字提取或纯手动录入。
- 🗂️ **成员列表批量识别**：上传「同盟成员列表」截图，可一次识别多行盟友数据（名称、武勋、贡献总量、贡献周量），逐行核对后批量保存，未匹配到的名字自动新增为玩家。
- 🕐 **时间记录**：每次导入自动记录时间，用于变化值计算与筛选。
- 📈 **变化值对比**：
  - 成员数据表可选定**任意两次时间**（全赛季 / 最近 7 天 / 最近 30 天 / 自定义），实时显示每位玩家的 Δ武勋、Δ势力值。
  - 变化值对比页可对单个玩家任意选择两条历史快照，查看精确变化。
- 🔀 **排序与筛选**：点击表头按武勋、势力值、变化值等排序，支持昵称/团组搜索。
- 👥 **同盟数据库**：每个玩家都可以为自己的盟创建一个数据库；盟友通过**邀请码**加入，并把最新数据上传到同一个盟的数据库。
- ⚡ **实时更新**：接入 Supabase Realtime，任意成员导入数据后，管理端榜单与表格即时刷新。
- 🎨 可选**本地演示模式**（默认）：无需任何配置即可体验全部功能，数据保存在浏览器本地，支持跨标签页同步。

## 技术架构

- **前端**：原生 HTML + CSS + JavaScript（无构建步骤），单页应用。
- **OCR**：Tesseract.js（`chi_sim+eng`），在浏览器本地运行。
- **后端（可选）**：Supabase（PostgreSQL + Row Level Security + Realtime）。
- **默认 `config.js` 中 `backend: "local"`**，开箱即用；配置 Supabase 后即为多人共享的实时数据库。

## 快速开始（本地演示）

直接双击 `index.html`，或用任意静态服务器打开，例如：

```bash
python -m http.server 8080
# 然后浏览器访问 http://localhost:8080
```

默认本地模式会自动进入，无需登录。

## 部署到 GitHub Pages

1. 将本仓库推送到 GitHub。
2. 在仓库 **Settings → Pages** 中，把 Source 设为 `main` 分支（根目录 `/`）。
3. 稍等片刻，通过 `https://<用户名>.github.io/<仓库名>/` 访问。

> 注意：GitHub Pages 是静态托管，多人实时数据库需要下面配置 Supabase。

## 配置 Supabase（多人实时数据库）

1. 到 [supabase.com](https://supabase.com) 注册并 **Create a new project**。
2. 打开左侧 **SQL Editor → New query**，把 `supabase/schema.sql` 的全部内容粘贴进去，点击 **Run**。
3. 在 **Project Settings → API** 中复制 **Project URL** 和 **anon public key**。
4. 编辑 `config.js`：

```js
window.APP_CONFIG = {
  backend: "supabase",
  supabaseUrl: "https://你的项目.supabase.co",
  supabaseAnonKey: "你的-anon-key"
};
```

5.（推荐）在 **Authentication → Providers → Email** 中关闭 **Confirm email**，这样注册后无需邮件验证即可直接登录。
6. 重新打开网站，注册账号即可使用。

## 配置视觉识别后端（可选，识别更准）

默认用浏览器本地 Tesseract 识别。若要更高识别率（尤其是成员列表的玩家名字、贡献周量），可配置视觉模型后端：

1. 在 Supabase 项目中部署 Edge Function `supabase/functions/vision-ocr`：
   Dashboard → Edge Functions → 新建 `vision-ocr`，把 `index.ts` 内容粘贴进去。
2. 在该 Function 的 **Secrets** 中设置：
   - `VISION_API_KEY`：视觉模型密钥
   - `VISION_BASE_URL`：以 `/compatible-mode/v1` 结尾的兼容端点
   - `VISION_MODEL`：模型名
   - `VISION_FUNC_KEY`（可选）：自定义访问密钥，用于简单校验
3. 在 `config.js` 中填入：
   ```js
   visionBackendUrl: "https://你的项目.supabase.co/functions/v1/vision-ocr",
   visionBackendKey: "你设置的 VISION_FUNC_KEY（没设就留空）"
   ```
4. 导入截图时会优先走视觉模型识别，失败自动回退到本地识别。
## 使用说明

### 盟主 / 管理者

1. 注册并登录，在「我的同盟」点击**创建同盟**，填写同盟名、赛季名和你的游戏昵称。
2. 把**邀请码**发给盟友；盟友注册登录后凭邀请码加入。
3. 在「成员数据」中添加/编辑玩家，点击表头排序，用变化值区间查看任意两次时间的 Δ武勋 / Δ势力值。
4. 「同盟设置」中可修改名称/赛季、管理成员权限、复制邀请码。

### 盟友 / 玩家

1. 注册登录，在「我的同盟」输入邀请码加入。
2. 打开「导入数据」→ 上传游戏截图 → 开始识别 → **核对武勋/势力值** → 保存。
3. 也可以手动填写或粘贴文字识别。

### 截图建议

- 优先使用游戏内 **主公簿 / 个人主页**（显示累计武勋与势力值）或 **势力面板** 截图。
- 保证数字清晰、亮度充足，避免被水印/表情遮挡。
- 识别结果**务必核对**后再保存。

## 数据模型

| 表 | 说明 |
| --- | --- |
| `alliances` | 同盟（名称、赛季、邀请码） |
| `alliance_members` | 用户与同盟关系及权限（owner / admin / member） |
| `players` | 盟员名单（游戏昵称、团组、职责） |
| `records` | 每次导入的快照，含 `recorded_at` 时间戳、`merit`（武勋）、`power`（势力值）、`contribution_total`（贡献总量）、`contribution_week`（贡献周量） |

武勋/势力值的变化值 = 「结束时间点之前最近一次快照」−「起始时间点之前最近一次快照」。

## 文件结构

```
├── index.html            页面结构
├── styles.css            样式
├── config.js             后端模式与 Supabase 配置
├── ocr.js                截图识别与字段提取
├── store.js              数据层（本地 / Supabase 双实现）
├── app.js                应用逻辑
├── supabase/schema.sql   数据库建表、RLS 与实时订阅脚本
└── README.md
```

## 致谢

本项目参考了 [率土同盟战报台账](https://jiangjialiang413-cyber.github.io/jiangjialiang413.github.io/) 的截图识别思路，并在此基础上实现了多用户同盟数据库、实时更新与变化值对比。

## License

MIT