# Teacher Profile 数据契约

一个"老师" = 一个 profile 目录。目录名即 profile id（小写字母/数字/连字符，≤64 位）。

## 查找顺序

1. `<DSH_HOME>/interview-teacher/profiles/<id>/` —— 用户定制（向导写入、手改都放这里），同名时优先
2. `<插件目录>/profiles/<id>/` —— 随仓库分发的内置示例

`<DSH_HOME>` 默认 `~/.dsh`，可用环境变量 `DSH_HOME` 覆盖。

## 目录内容

```
profiles/<id>/
├── teacher.json        # 必需：老师的全部配置
├── checklist.json      # 可选：考核点清单（也可内联在 teacher.json 的 checklist 字段）
└── question-bank.json  # 可选：题库（也可内联在 questionBank 字段）
```

内联数组非空时优先于文件。引擎对缺失/损坏字段一律给默认值并记 warn，不会崩。

## teacher.json 字段

### 身份与人设

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 必填，与目录名一致 |
| `name` | string | 老师名字（面板标题、skill 标题） |
| `subtitle` | string | 一句话简介 |
| `persona.role` | string | 面试官身份（"有 10 年经验的硬件评审"） |
| `persona.style` | string | 语气风格 |
| `persona.scope` | string | 只考什么 |
| `persona.outOfScope` | string | 明确不考什么 |
| `persona.language` | string | 默认"中文" |
| `materials` | string | 默认材料描述（注入 skill） |
| `opening` | string | 开场白（注入 skill） |

### 考核点

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ids.pattern` | string(正则) | 考核点 id 校验，默认 `^[A-Z]{1,4}\d{1,3}$` |
| `ids.label` | string | 考核点叫什么（"硬件考核点"/"考点"），默认"考核点" |
| `checklist` / `checklistFile` | array / string | 考核点清单，条目见下 |
| `groups` | array | `[{id,label}]`；不写则从清单自动收集 |
| `modes` | array | `[{id,label,groups:[分组id]}]`；`groups:null`=全部。不写则自动生成"只看<分组>"模式 |

checklist 条目：

```json
{
  "id": "A01",
  "group": "jvm",
  "groupLabel": "JVM",
  "source": "简历-项目1",
  "module": "GC 调优",
  "point": "GC 算法选择、停顿指标、调参依据",
  "required": "必考",        // 或 "选考"
  "seconds": 180,            // 建议回答秒数，30–600
  "stage": "可选出处备注",
  "note": "可选备注"
}
```

### 题库

`questionBank` / `bankFile`，条目：

```json
{
  "id": "A01",
  "question": "题干",
  "followUps": ["第1层…", "第2层…"],
  "hint": "思路提示",
  "answer": ["参考答案要点"],
  "risk": "答不好暴露什么",
  "improve": "改进建议",
  "troubleshoot": "排查框架",
  "seconds": 180
}
```

没有题库条目的考核点，引擎按 `synthesis` 模板自动合成基础题（`{module}`/`{point}`/`{id}` 占位符）。

### 流程与文案

| 字段 | 说明 |
| --- | --- |
| `principles` | 核心原则列表（注入 skill） |
| `questionFormat` | 每轮出题格式模板 |
| `followUp.maxDepth/layer1/layer2` | 追问层数与每层问法 |
| `timeBudget` | `[{topic,range}]` 时间预算 |
| `commands` | `[{command,effect}]` 用户命令（面板可复制） |
| `synthesis` | `question/followUp1/followUp2/hint/troubleshoot` 缺题时的合成模板 |

### 判分与复盘

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `scoring.weakWeight` | 0.6 | "待加强"折算系数 |
| `scoring.minCoverage` | 60 | 覆盖率低于此值不评级 |
| `scoring.grades` | 85/70/55 | `[{min,label}]` 评分档位，按 min 降序匹配 |
| `scoring.fallbackGrade` | "待加强…" | 低于所有档位时的文案 |
| `scoring.summaries` | — | `[{min,text}]` 一句话总结档位 |
| `scoring.fallbackSummary` | 通用建议 | 兜底总结 |
| `report.title` | `<name> · 复盘报告` | 报告标题 |
| `report.riskTitle` | "最容易被淘汰的 3 个风险点" | 风险节标题 |
| `report.prefix` | "面试复盘" | 落盘文件名前缀 |

评分公式（确定性，不判断"答得好不好"）：
`必考点得分 = (passed×1 + weak×weakWeight) / 已考必考点 × 100`，未考不扣分，覆盖率单独统计。

### 工作区与扫描

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `workspace.default` | 环境变量 `DSH_COACH_WORKSPACE` 或用户主目录 | 默认工程目录 |
| `workspace.recordDir` | "面试记录" | 复盘落盘子目录 |
| `scan.enabled` | 有 rules 即 true | 开关 |
| `scan.extensions` | 常见源码后缀 | 扫描文件后缀 |
| `scan.skipDirs` | node_modules/.git/build/dist/__pycache__ | 跳过目录名 |
| `scan.maxFiles` / `scan.maxDepth` | 80 / 5 | 扫描上限 |
| `scan.rules` | [] | `[{point,module,pattern,flags?}]`，pattern 为正则字符串，命中即记录文件/行/上下文 |
| `scan.materialRules` | [] | `[{kind,ext}]` 按后缀识别材料；`[{kind,hasMain:["USER/main.c",…]}]` 按目录特征识别工程 |

### 面板

`panel.label`（默认"面试教练"）、`panel.order`（侧栏排序，默认 4）。

## 修改生效

- 改 `teacher.json` / `checklist.json` / `question-bank.json` 后：面板每次刷新都会重读数据；skill 人设在切换老师或重启 DSH 时重新组装。
- 会话里说「切换到 <id>」或调 `teacher_profiles` 工具即可触发重载。
- 新增 profile：向导用 `teacher_create_profile` 写入；手动则复制 `templates/` 到用户 profiles 目录。

## 状态与落盘

- 当前激活老师：`<DSH_HOME>/interview-teacher/active.json`
- 每个老师独立进度：`<DSH_HOME>/interview-teacher/state-<id>.json`（原子写）
- 复盘：`<workspace>/<recordDir>/<prefix>-<id>-<时间>.md`
