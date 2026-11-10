# 通用面试老师 · dsh-generic-interview-teacher

> 把「面试老师」从代码里抽出来，变成一份人人可定制的 **teacher profile**。
> 一个 [DeepSeek Harness](https://github.com/deepseek-ai) 插件 = 通用面试引擎 + 左侧栏控制台 + 定制向导；
> 你想要什么样的面试官，就生成什么样的 profile。

本项目是 [dsh-coach-plugins](https://github.com/tomorrozy/dsh-coach-plugins) 的通用化：
原仓库里四个老师（硬件评审 / 排错 / 测试 / 安全成本）的人设、题库、判分文案都写死在代码里；
这里把它们全部外置成 JSON + Markdown 配置，代码只保留一套引擎。

---

## 30 秒理解

```
┌─────────────────────── 会话里 ───────────────────────┐
│  模型扮演「当前老师」：出题 → 追问 → 判分              │
│  人设由 skill 模板 + 激活的 profile 动态组装           │
└───────────────┬──────────────────────────────────────┘
                │ interview_* / teacher_* 工具
┌───────────────▼──────────────────────────────────────┐
│  通用引擎（lib/index.js）                             │
│  · profile 装载/校验/切换（多老师，进度各自独立）      │
│  · 状态机 + 原子落盘 + 复盘生成（文案来自 profile）    │
│  · 工程扫描（正则规则来自 profile）                   │
└───────────────┬──────────────────────────────────────┘
                │ POST /plugins/dsh-generic-interview-teacher/rpc
┌───────────────▼──────────────────────────────────────┐
│  浏览器面板（lib/client.js）                          │
│  · 老师切换器、考核点进度、计时、提示/答案、复盘       │
└──────────────────────────────────────────────────────┘
```

**分工原则**：面板负责「记住」和「展示」，老师负责「问」和「判」，profile 负责「定义老师是谁」。

## 定制你自己的老师（两条路）

### 路线 A：会话内向导（推荐）

装好插件后，在会话里说：

> 定制面试老师

`interview-teacher-customizer` skill 会引导你回答 6 轮问题（考什么岗位 → 面试官身份 →
考核维度 → 追问方式 → 判分严格度 → 个性化细节），起草 profile 给你确认，
然后调 `teacher_create_profile` 写入 `<DSH_HOME>/interview-teacher/profiles/<id>/`。
之后说「开始面试」即可用新老师训练，面板里也能随时切换。

### 路线 B：手改配置文件

复制 `templates/teacher.template.json` 到 `<DSH_HOME>/interview-teacher/profiles/<你的id>/teacher.json`，
按 `docs/PROFILE.md` 的字段契约填写；考核点和题库可内联，也可放同目录的
`checklist.json` / `question-bank.json`。改完在面板刷新或说「切换到 <id>」即生效。

一个 profile 能定制的东西：

- **人设**：身份、语气、只考什么、明确不考什么、开场白
- **考核点**：编号规则、分组、必考/选考、建议用时
- **题库**：题干、追问、提示、参考答案、风险点（缺题自动按模板合成）
- **流程**：面试模式、追问层数、时间预算、用户命令
- **判分**：档位文案、待加强折算系数、覆盖率门槛、复盘总结语
- **扫描**：文件后缀 + 正则规则，从你的工程里提取证据
- **落盘**：复盘目录与文件名前缀

## 内置示例

`profiles/example-hardware/`：原仓库的「电控硬件面试老师」完整转制
（RoboMaster 硬件评审人设、H01–H20 考核点、20 题题库、STM32 扫描规则）。
装完即可直接练，也可以复制它当定制起点。

## 安装

前置：DeepSeek Harness（桌面端或 Web 端）；仅自测需要 Node.js 18+。

```powershell
# 装进桌面客户端 profile
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Profile desktop

# 装进 Web profile
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Profile web
```

脚本幂等：备份 profile 的 `package.json` → 登记 `link:` 依赖与 `dsh.profile.bundles`
→ 建 `node_modules` junction。装完重启 DSH，左侧栏出现「面试教练」。

卸载（保留所有 profile、状态与复盘）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1 -Profile desktop
```

## 目录结构

```
dsh-generic-interview-teacher/
├── package.json / cordis.patch.yml   # DSH bundle 登记
├── lib/
│   ├── index.js                      # 通用引擎：profile、状态机、RPC、skill、tools、扫描、复盘
│   └── client.js                     # 浏览器面板：老师切换器 + 面试控制台
├── skill/
│   ├── TEACHER.md                    # 老师人设模板（{{占位符}} 由 profile 注入）
│   └── CUSTOMIZER.md                 # 定制向导 skill
├── profiles/example-hardware/        # 内置示例老师（原硬件面试插件转制）
├── templates/teacher.template.json   # 空白定制模板
├── docs/PROFILE.md                   # profile 字段契约（完整）
└── scripts/                          # install / uninstall / selftest
```

## 数据落盘

| 内容 | 位置 |
| --- | --- |
| 用户定制老师 | `<DSH_HOME>/interview-teacher/profiles/<id>/` |
| 当前激活老师 | `<DSH_HOME>/interview-teacher/active.json` |
| 每个老师的面试进度 | `<DSH_HOME>/interview-teacher/state-<id>.json` |
| 复盘报告 | `<workspace>/<recordDir>/<prefix>-<id>-<时间>.md` |

`<DSH_HOME>` 默认 `~/.dsh`，可用环境变量覆盖；工程目录可用 `cordis.patch.yml` 的
`config.workspace`、profile 的 `workspace.default` 或面板「切换工程目录」指定。

## 自测

离线自测不需要启动 DSH（临时 DSH_HOME + 假 cordis ctx）：

```powershell
node scripts/selftest.mjs
```

覆盖：profile 装载与规范化、状态机与计分、缺题合成、复盘文案、skill 组装、
RPC 全流程（含创建新老师与进度隔离）、扫描与落盘、插件注册、浏览器半语法。

## 已知边界

- 面板**不自动判分**：通过/待加强/跳过由老师（模型）或你自己写入
- 扫描是正则证据提取，不做语义分析；规则质量取决于 profile
- 单个实例在作者的 DSH 版本 + Node 18/20/24 下验证；换宿主版本请跑自测

## 许可证

[MIT](LICENSE)

## 相关项目

- [dsh-coach-plugins](https://github.com/tomorrozy/dsh-coach-plugins) —— 面向电控岗的四个写死老师 + 面试控制台（本项目的前身）
- [gesture-control-car](https://github.com/tomorrozy/gesture-control-car) —— 示例题库对应的 STM32 手势识别小车
