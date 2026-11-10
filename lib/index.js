/**
 * dsh-generic-interview-teacher — host half.
 *
 * 通用面试老师 · DSH 插件宿主半。
 *
 * 与 dsh-coach-plugins 里的四个「写死老师」不同，本插件把老师抽象成
 * 一份可编辑的 teacher profile（JSON + 题库），代码只是通用引擎：
 *
 *   profiles/<id>/teacher.json        人设、考核点、分组、模式、复盘文案、扫描规则…
 *   profiles/<id>/checklist.json      考核点清单（可内联进 teacher.json）
 *   profiles/<id>/question-bank.json  题库（可内联）
 *
 * profile 查找顺序：
 *   1. <DSH_HOME>/interview-teacher/profiles/<id>/   （用户定制，向导/手改都写这里）
 *   2. <插件目录>/profiles/<id>/                      （随仓库分发的示例）
 *
 * 职责：
 *  1. JSON RPC（浏览器半的唯一数据通道）
 *     POST /plugins/dsh-generic-interview-teacher/rpc
 *     methods: state / question / begin / record / skip / next / setMode /
 *              setWorkspace / reset / finish / report / copyPrompt / scan /
 *              profiles / profile / setProfile / createProfile
 *  2. 注册模型可见 skill：
 *     - interview-teacher：由「当前 profile」动态组装的老师人设
 *     - interview-teacher-customizer：定制向导（引导用户生成新 profile）
 *  3. 注册同步工具 interview_state / interview_begin / interview_record /
 *     interview_report / teacher_profiles / teacher_create_profile
 *  4. 状态落盘 <DSH_HOME>/interview-teacher/state-<profile>.json（原子写，
 *     每个老师独立进度），复盘落盘 <workspace>/<recordDir>/
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-generic-interview-teacher';

const PLUGIN_ID = 'dsh-generic-interview-teacher';
const RPC_PATH = `/plugins/${PLUGIN_ID}/rpc`;
const MAX_BODY_BYTES = 512 * 1024;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const SKILL_TEMPLATE_PATH = path.join(PLUGIN_ROOT, 'skill', 'TEACHER.md');
const CUSTOMIZER_SKILL_PATH = path.join(PLUGIN_ROOT, 'skill', 'CUSTOMIZER.md');
const BUNDLED_PROFILES_DIR = path.join(PLUGIN_ROOT, 'profiles');

const DSH_HOME = (() => {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return path.resolve(fromEnv.trim());
  return path.join(os.homedir(), '.dsh');
})();
const HOME_DIR = path.join(DSH_HOME, 'interview-teacher');
const USER_PROFILES_DIR = path.join(HOME_DIR, 'profiles');
const ACTIVE_PATH = path.join(HOME_DIR, 'active.json');

const PROFILE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function log(level, message) {
  const line = `[${PLUGIN_ID}] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function readJson(file) {
  const text = readText(file);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    log('warn', `无法解析 ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    log('warn', `创建目录失败 ${dir}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, body, 'utf8');
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.writeFileSync(file, body, 'utf8');
      fs.rmSync(tmp, { force: true });
    } catch (inner) {
      log('error', `写文件失败 ${file}: ${inner instanceof Error ? inner.message : String(inner)}`);
      throw inner;
    }
  }
}

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function str(value, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function strArray(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.length > 0) : [];
}

function stripFrontmatter(text) {
  if (typeof text !== 'string' || !text.startsWith('---')) return text;
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (match === null) return text;
  return text.slice(match[0].length).replace(/^\s+/, '');
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function stamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function formatSeconds(total) {
  const seconds = Math.max(0, Math.round(Number(total) || 0));
  return `${Math.floor(seconds / 60)}分${pad(seconds % 60)}秒`;
}

/* ------------------------------------------------------------------ */
/* profile 装载与规范化                                                 */
/* ------------------------------------------------------------------ */

function profileDirs() {
  return [USER_PROFILES_DIR, BUNDLED_PROFILES_DIR];
}

function listProfileIds() {
  const ids = new Map();
  for (const dir of profileDirs()) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !PROFILE_ID_RE.test(entry.name)) continue;
      if (!ids.has(entry.name)) ids.set(entry.name, dir);
    }
  }
  return [...ids.entries()].map(([id, dir]) => ({ id, dir, user: dir === USER_PROFILES_DIR }));
}

function findProfileDir(id) {
  for (const dir of profileDirs()) {
    const candidate = path.join(dir, id);
    if (fs.existsSync(path.join(candidate, 'teacher.json'))) return candidate;
  }
  return undefined;
}

function compileIdPattern(raw) {
  const pattern = str(raw.ids?.pattern, raw.idPattern);
  if (pattern.length === 0) return /^[A-Z]{1,4}\d{1,3}$/;
  try {
    return new RegExp(pattern);
  } catch {
    log('warn', `id 正则无效：${pattern}，退回默认`);
    return /^[A-Z]{1,4}\d{1,3}$/;
  }
}

function normalizeChecklist(raw, idRe) {
  if (!Array.isArray(raw)) return [];
  const valid = raw.filter((item) => item !== null && typeof item === 'object' && idRe.test(String(item.id)));
  return valid
    .map((item) => {
      const group = str(item.group, 'default');
      return {
        id: String(item.id),
        group,
        groupLabel: str(item.groupLabel, group),
        source: str(item.source),
        module: str(item.module),
        point: str(item.point),
        required: item.required === '选考' || item.required === 'optional' ? '选考' : '必考',
        seconds: Number.isFinite(Number(item.seconds)) ? clamp(Math.round(Number(item.seconds)), 30, 600) : 120,
        stage: str(item.stage),
        note: str(item.note),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

function normalizeBank(raw, idRe) {
  const bank = new Map();
  if (!Array.isArray(raw)) return bank;
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const id = String(entry.id ?? '');
    if (!idRe.test(id)) continue;
    bank.set(id, {
      id,
      question: str(entry.question),
      followUps: strArray(entry.followUps),
      hint: str(entry.hint),
      answer: strArray(entry.answer),
      risk: str(entry.risk),
      improve: str(entry.improve),
      troubleshoot: str(entry.troubleshoot),
      seconds: Number.isFinite(Number(entry.seconds)) ? clamp(Math.round(Number(entry.seconds)), 30, 600) : undefined,
    });
  }
  return bank;
}

function normalizeScanRules(raw) {
  if (!Array.isArray(raw)) return [];
  const rules = [];
  for (const rule of raw) {
    if (rule === null || typeof rule !== 'object') continue;
    const pattern = str(rule.pattern);
    if (pattern.length === 0) continue;
    try {
      rules.push({
        point: str(rule.point),
        module: str(rule.module, rule.point),
        pattern: new RegExp(pattern, typeof rule.flags === 'string' ? rule.flags : 'i'),
      });
    } catch (error) {
      log('warn', `扫描规则正则无效，已跳过：${pattern}（${error instanceof Error ? error.message : String(error)}）`);
    }
  }
  return rules;
}

/**
 * 把一个 profile 目录里的 teacher.json（+ 可选 checklist.json / question-bank.json）
 * 规范成引擎内部结构。缺什么给什么默认值，坏什么丢什么并记 warn。
 */
function normalizeProfile(id, dir) {
  const raw = readJson(path.join(dir, 'teacher.json'));
  if (raw === null || typeof raw !== 'object') return undefined;
  const persona = raw.persona ?? {};
  const idRe = compileIdPattern(raw);
  const checklistRaw = Array.isArray(raw.checklist) && raw.checklist.length > 0
    ? raw.checklist
    : readJson(path.join(dir, str(raw.checklistFile, 'checklist.json'))) ?? [];
  const bankRaw = Array.isArray(raw.questionBank) && raw.questionBank.length > 0
    ? raw.questionBank
    : readJson(path.join(dir, str(raw.bankFile, 'question-bank.json'))) ?? [];
  const checklist = normalizeChecklist(checklistRaw, idRe);
  const bank = normalizeBank(bankRaw, idRe);

  const groups = [];
  const seenGroup = new Set();
  for (const declared of Array.isArray(raw.groups) ? raw.groups : []) {
    const gid = str(declared?.id ?? (typeof declared === 'string' ? declared : ''));
    if (gid.length === 0 || seenGroup.has(gid)) continue;
    seenGroup.add(gid);
    const sample = checklist.find((item) => item.group === gid);
    groups.push({ id: gid, label: str(declared?.label ?? (typeof declared === 'string' ? '' : ''), sample?.groupLabel ?? gid) });
  }
  for (const item of checklist) {
    if (seenGroup.has(item.group)) continue;
    seenGroup.add(item.group);
    groups.push({ id: item.group, label: item.groupLabel });
  }

  const allLabel = str(raw.allModeLabel, '全部考核点');
  const modes = [{ id: 'all', label: allLabel, groups: null }];
  const declaredModes = Array.isArray(raw.modes) ? raw.modes : [];
  const seenMode = new Set(['all']);
  for (const mode of declaredModes) {
    const mid = str(mode?.id);
    if (mid.length === 0 || seenMode.has(mid)) continue;
    seenMode.add(mid);
    const modeGroups = strArray(mode?.groups).filter((g) => seenGroup.has(g));
    modes.push({ id: mid, label: str(mode?.label, mid), groups: modeGroups.length > 0 ? modeGroups : null });
  }
  if (declaredModes.length === 0) {
    for (const group of groups) {
      if (group.id === 'default') continue;
      modes.push({ id: group.id, label: `只看${group.label}`, groups: [group.id] });
    }
  }

  const grades = Array.isArray(raw.scoring?.grades) && raw.scoring.grades.length > 0
    ? raw.scoring.grades
        .filter((g) => Number.isFinite(Number(g?.min)))
        .map((g) => ({ min: Number(g.min), label: str(g.label) }))
        .sort((a, b) => b.min - a.min)
    : [
        { min: 85, label: '优秀（可以顶住追问）' },
        { min: 70, label: '良好（主线清楚，个别项会被追问）' },
        { min: 55, label: '及格（能说清结论，但依据与验证偏弱）' },
      ];
  const fallbackGrade = str(raw.scoring?.fallbackGrade, '待加强（多数考核点只能背结论）');

  const summaries = Array.isArray(raw.scoring?.summaries)
    ? raw.scoring.summaries
        .filter((s) => Number.isFinite(Number(s?.min)) && str(s.text).length > 0)
        .map((s) => ({ min: Number(s.min), text: s.text }))
        .sort((a, b) => b.min - a.min)
    : [];
  const fallbackSummary = str(raw.scoring?.fallbackSummary, '先把必考项练到能直接说出结论、依据和验证方法，再谈进阶。');

  const scan = raw.scan ?? {};
  return {
    id,
    dir,
    user: dir === USER_PROFILES_DIR,
    version: 1,
    name: str(raw.name, id),
    subtitle: str(raw.subtitle),
    persona: {
      role: str(persona.role, '一位资深面试官'),
      style: str(persona.style, '专业、直接'),
      scope: str(persona.scope),
      outOfScope: str(persona.outOfScope),
      language: str(persona.language, '中文'),
    },
    ids: {
      pattern: idRe,
      label: str(raw.ids?.label ?? raw.idLabel, '考核点'),
    },
    groups,
    modes,
    checklist,
    bank,
    materials: str(raw.materials),
    questionFormat: str(raw.questionFormat),
    followUp: {
      maxDepth: Number.isFinite(Number(raw.followUp?.maxDepth)) ? clamp(Math.round(Number(raw.followUp.maxDepth)), 0, 5) : 2,
      layer1: str(raw.followUp?.layer1),
      layer2: str(raw.followUp?.layer2),
    },
    timeBudget: Array.isArray(raw.timeBudget)
      ? raw.timeBudget.filter((t) => t !== null && typeof t === 'object').map((t) => ({ topic: str(t.topic), range: str(t.range) }))
      : [],
    opening: str(raw.opening),
    commands: Array.isArray(raw.commands)
      ? raw.commands
          .filter((c) => c !== null && typeof c === 'object' && str(c.command).length > 0)
          .map((c) => ({ command: c.command, effect: str(c.effect) }))
      : [],
    principles: strArray(raw.principles),
    scoring: {
      grades,
      fallbackGrade,
      summaries,
      fallbackSummary,
      weakWeight: Number.isFinite(Number(raw.scoring?.weakWeight)) ? clamp(Number(raw.scoring.weakWeight), 0, 1) : 0.6,
      minCoverage: Number.isFinite(Number(raw.scoring?.minCoverage)) ? clamp(Math.round(Number(raw.scoring.minCoverage)), 0, 100) : 60,
    },
    report: {
      title: str(raw.report?.title),
      riskTitle: str(raw.report?.riskTitle, '最容易被淘汰的 3 个风险点'),
      recordDir: str(raw.workspace?.recordDir ?? raw.report?.recordDir, '面试记录'),
      reportPrefix: str(raw.report?.prefix, '面试复盘'),
    },
    scan: {
      enabled: scan.enabled === true || (Array.isArray(scan.rules) && scan.rules.length > 0),
      extensions: strArray(scan.extensions).length > 0 ? strArray(scan.extensions) : ['.c', '.h', '.md', '.txt', '.json', '.py', '.ts', '.js'],
      skipDirs: strArray(scan.skipDirs).length > 0 ? strArray(scan.skipDirs) : ['node_modules', '.git', 'build', 'dist', '__pycache__'],
      maxFiles: Number.isFinite(Number(scan.maxFiles)) ? clamp(Math.round(Number(scan.maxFiles)), 1, 500) : 80,
      maxDepth: Number.isFinite(Number(scan.maxDepth)) ? clamp(Math.round(Number(scan.maxDepth)), 1, 12) : 5,
      rules: normalizeScanRules(scan.rules),
      materials: Array.isArray(scan.materialRules)
        ? scan.materialRules
            .filter((m) => m !== null && typeof m === 'object')
            .map((m) => ({ kind: str(m.kind, '材料'), ext: str(m.ext).toLowerCase(), hasMain: strArray(m.hasMain) }))
        : [],
    },
    synthesis: {
      question: str(raw.synthesis?.question, '围绕「{module}」：{point}，请给出结论、依据和验证方法。'),
      followUp1: str(raw.synthesis?.followUp1, '第1层：具体怎么做？关键参数是什么？'),
      followUp2: str(raw.synthesis?.followUp2, '第2层：为什么这么做？出问题怎么定位？如果重来改哪里？'),
      hint: str(raw.synthesis?.hint, '先给结论，再讲依据，最后讲怎么验证。'),
      troubleshoot: str(raw.synthesis?.troubleshoot, '先查最可能的公共依赖，再分段缩小范围，最后用替换法验证。'),
    },
    workspaceDefault: str(raw.workspace?.default),
    panel: {
      label: str(raw.panel?.label, '面试教练'),
      order: Number.isFinite(Number(raw.panel?.order)) ? Math.round(Number(raw.panel.order)) : 4,
    },
  };
}

function loadProfile(id) {
  const dir = findProfileDir(id);
  if (dir === undefined) return undefined;
  return normalizeProfile(id, dir);
}

function loadActiveId() {
  const active = readJson(ACTIVE_PATH);
  const id = str(active?.profile);
  if (id.length > 0 && findProfileDir(id) !== undefined) return id;
  const ids = listProfileIds();
  return ids.length > 0 ? ids[0].id : undefined;
}

function saveActiveId(id) {
  writeJsonAtomic(ACTIVE_PATH, { profile: id, updatedAt: nowIso() });
}

/* ------------------------------------------------------------------ */
/* 面试状态（每个 profile 独立）                                        */
/* ------------------------------------------------------------------ */

function statePath(profileId) {
  return path.join(HOME_DIR, `state-${profileId}.json`);
}

function defaultState(profileId) {
  return {
    version: 1,
    profile: profileId,
    status: 'idle',
    mode: 'all',
    current: null,
    timer: null,
    startedAt: null,
    updatedAt: null,
    records: [],
    log: [],
  };
}

function normalizeRecord(raw, idRe) {
  if (raw === null || typeof raw !== 'object') return undefined;
  const id = String(raw.id ?? '');
  if (!idRe.test(id)) return undefined;
  const verdict = raw.verdict === 'passed' || raw.verdict === 'weak' || raw.verdict === 'skipped' ? raw.verdict : 'weak';
  return {
    id,
    verdict,
    seconds: Number.isFinite(Number(raw.seconds)) ? clamp(Math.round(Number(raw.seconds)), 0, 3600) : 0,
    note: typeof raw.note === 'string' ? raw.note.slice(0, 500) : '',
    at: typeof raw.at === 'string' ? raw.at : nowIso(),
  };
}

function normalizeState(raw, profile) {
  const base = defaultState(profile.id);
  if (raw === null || typeof raw !== 'object') return base;
  const idRe = profile.ids.pattern;
  const modeIds = new Set(profile.modes.map((mode) => mode.id));
  return {
    ...base,
    status: raw.status === 'running' || raw.status === 'finished' ? raw.status : 'idle',
    mode: modeIds.has(raw.mode) ? raw.mode : 'all',
    current: idRe.test(String(raw.current ?? '')) ? String(raw.current) : null,
    timer: raw.timer !== null && typeof raw.timer === 'object' && idRe.test(String(raw.timer.id ?? '')) && typeof raw.timer.startedAt === 'string'
      ? { id: String(raw.timer.id), startedAt: raw.timer.startedAt }
      : null,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    records: Array.isArray(raw.records) ? raw.records.map((r) => normalizeRecord(r, idRe)).filter((v) => v !== undefined) : [],
    log: Array.isArray(raw.log) ? raw.log.slice(-200) : [],
  };
}

function loadState(profile) {
  return normalizeState(readJson(statePath(profile.id)), profile);
}

function saveState(state) {
  const next = { ...state, updatedAt: nowIso() };
  writeJsonAtomic(statePath(next.profile), next);
  return next;
}

function statsOf(state, profile) {
  const checklist = profile.checklist;
  const byId = new Map(checklist.map((item) => [item.id, item]));
  const recordById = new Map(state.records.map((record) => [record.id, record]));
  const groups = new Map();
  for (const item of checklist) {
    const group = groups.get(item.group) ?? { group: item.group, label: item.groupLabel, total: 0, required: 0, passed: 0, weak: 0, skipped: 0, unattempted: 0 };
    group.total += 1;
    if (item.required === '必考') group.required += 1;
    const record = recordById.get(item.id);
    if (record === undefined) group.unattempted += 1;
    else if (record.verdict === 'passed') group.passed += 1;
    else if (record.verdict === 'weak') group.weak += 1;
    else group.skipped += 1;
    groups.set(item.group, group);
  }
  const attempted = state.records.length;
  const passed = state.records.filter((record) => record.verdict === 'passed').length;
  const weak = state.records.filter((record) => record.verdict === 'weak').length;
  const skipped = state.records.filter((record) => record.verdict === 'skipped').length;
  const weakWeight = profile.scoring.weakWeight;
  const attemptedRequired = state.records.filter((record) => byId.get(record.id)?.required === '必考').length;
  const passedRequired = state.records.filter((record) => byId.get(record.id)?.required === '必考' && record.verdict === 'passed').length;
  const weakRequired = state.records.filter((record) => byId.get(record.id)?.required === '必考' && record.verdict === 'weak').length;
  const score = attemptedRequired > 0 ? Math.round(((passedRequired + weakWeight * weakRequired) / attemptedRequired) * 100) : 0;
  const coverage = checklist.length > 0 ? Math.round((attempted / checklist.length) * 100) : 0;
  const totalSeconds = state.records.reduce((sum, record) => sum + record.seconds, 0);
  const groupOrder = profile.groups.map((g) => g.id);
  return {
    total: checklist.length,
    attempted,
    passed,
    weak,
    skipped,
    unattempted: Math.max(0, checklist.length - attempted),
    coverage,
    score,
    totalSeconds,
    groups: [...groups.values()].sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group)),
  };
}

function modePoints(profile, mode) {
  const config = profile.modes.find((m) => m.id === mode) ?? profile.modes[0];
  if (config.groups === null || config.groups === undefined) return profile.checklist;
  return profile.checklist.filter((item) => config.groups.includes(item.group));
}

function nextPointId(state, profile, afterId) {
  const points = modePoints(profile, state.mode);
  if (points.length === 0) return undefined;
  const recorded = new Set(state.records.map((record) => record.id));
  const startIndex = afterId === undefined ? -1 : points.findIndex((item) => item.id === afterId);
  for (let step = 1; step <= points.length; step += 1) {
    const item = points[(startIndex + step + points.length) % points.length];
    if (!recorded.has(item.id)) return item.id;
  }
  return points[(startIndex + 1 + points.length) % points.length]?.id;
}

function applyRecord(state, record) {
  const records = state.records.filter((item) => item.id !== record.id);
  records.push(record);
  records.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const logLine = { at: record.at, id: record.id, verdict: record.verdict, seconds: record.seconds };
  return {
    ...state,
    status: 'running',
    records,
    log: [...state.log, logLine].slice(-200),
    timer: state.timer?.id === record.id ? null : state.timer,
    current: state.current === record.id ? null : state.current,
  };
}

/* ------------------------------------------------------------------ */
/* 出题（题库缺失时按 profile 的 synthesis 模板合成）                    */
/* ------------------------------------------------------------------ */

function synthesizeQuestion(profile, checklistItem, bankEntry) {
  if (bankEntry !== undefined && bankEntry.question.length > 0) {
    return { ...bankEntry, seconds: bankEntry.seconds ?? checklistItem.seconds, synthesized: false };
  }
  const firstPoint = checklistItem.point.split(/[、,，]/)[0].trim();
  const fill = (template) => template.replaceAll('{module}', checklistItem.module).replaceAll('{point}', firstPoint || checklistItem.point).replaceAll('{id}', checklistItem.id);
  return {
    id: checklistItem.id,
    question: fill(profile.synthesis.question),
    followUps: [profile.synthesis.followUp1, profile.synthesis.followUp2].filter((v) => v.length > 0),
    hint: profile.synthesis.hint,
    answer: checklistItem.point.split(/[、,，]/).map((v) => `要点：${v.trim()}`).filter((v) => v.length > 3),
    risk: '',
    improve: '',
    troubleshoot: profile.synthesis.troubleshoot,
    seconds: checklistItem.seconds,
    synthesized: true,
  };
}

/* ------------------------------------------------------------------ */
/* 复盘报告（确定性生成，文案全部来自 profile）                          */
/* ------------------------------------------------------------------ */

function gradeOf(profile, score) {
  for (const grade of profile.scoring.grades) {
    if (score >= grade.min) return grade.label;
  }
  return profile.scoring.fallbackGrade;
}

function summaryOf(profile, score) {
  for (const summary of profile.scoring.summaries) {
    if (score >= summary.min) return summary.text;
  }
  return profile.scoring.fallbackSummary;
}

function buildReport(context) {
  const { state, profile, stats, workspace } = context;
  const checklist = profile.checklist;
  const bank = profile.bank;
  const recordById = new Map(state.records.map((record) => [record.id, record]));
  const lines = [];
  const now = new Date();
  const title = profile.report.title.length > 0 ? profile.report.title : `${profile.name} · 复盘报告`;
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`- 老师：${profile.name}（profile: ${profile.id}）`);
  lines.push(`- 生成时间：${now.toISOString()}`);
  lines.push(`- 工程目录：\`${workspace}\``);
  lines.push(`- 状态文件：\`${statePath(profile.id)}\``);
  lines.push(`- 覆盖：${stats.attempted}/${stats.total} 个${profile.ids.label}（${stats.coverage}%），已考用时 ${formatSeconds(stats.totalSeconds)}`);
  lines.push('');
  lines.push('## 1. 总体评分与档位');
  lines.push('');
  const lowCoverage = stats.coverage < profile.scoring.minCoverage;
  lines.push(`**${stats.score} / 100**（已考项得分）— ${lowCoverage ? `覆盖不足（<${profile.scoring.minCoverage}%），暂不评级，先跑完一轮再评分` : gradeOf(profile, stats.score)}`);
  lines.push('');
  lines.push(`> 说明：评分 = 必考${profile.ids.label}（通过×1 + 待加强×${profile.scoring.weakWeight} + 跳过×0）/ 已考必考点；未考不扣分，覆盖率单独统计。`);
  lines.push('');
  lines.push('## 2. 分项评分');
  lines.push('');
  lines.push('| 分项 | 覆盖 | 通过 | 待加强 | 跳过 | 未考 | 分项得分 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const group of stats.groups) {
    const attempted = group.total - group.unattempted;
    const groupScore = attempted > 0 ? Math.round(((group.passed + profile.scoring.weakWeight * group.weak) / attempted) * 100) : 0;
    lines.push(`| ${group.label} | ${attempted}/${group.total} | ${group.passed} | ${group.weak} | ${group.skipped} | ${group.unattempted} | ${groupScore} |`);
  }
  lines.push('');
  const passedRecords = state.records.filter((record) => record.verdict === 'passed').sort((a, b) => a.seconds - b.seconds).slice(0, 3);
  lines.push('## 3. 表现最好的 3 点');
  lines.push('');
  if (passedRecords.length === 0) lines.push('- 还没有「通过」记录；先把必考项跑完一轮。');
  for (const record of passedRecords) {
    const item = checklist.find((entry) => entry.id === record.id);
    lines.push(`- **${record.id} ${item?.module ?? ''}**：${item?.point ?? ''}（用时 ${formatSeconds(record.seconds)}）`);
  }
  lines.push('');
  lines.push(`## 4. ${profile.report.riskTitle}`);
  lines.push('');
  const risky = checklist
    .filter((item) => item.required === '必考')
    .map((item) => ({ item, record: recordById.get(item.id) }))
    .filter(({ record }) => record === undefined || record.verdict !== 'passed')
    .sort((a, b) => (a.record === undefined ? 0 : 1) - (b.record === undefined ? 0 : 1) || a.item.id.localeCompare(b.item.id))
    .slice(0, 3);
  if (risky.length === 0) lines.push('- 必考项全部通过，没有明显风险点；下一轮直接上深度追问。');
  risky.forEach(({ item, record }, index) => {
    const entry = bank.get(item.id);
    lines.push(`### 风险 ${index + 1}：${item.id} ${item.module}`);
    lines.push('');
    lines.push(`- **状态**：${record === undefined ? '未考' : record.verdict === 'weak' ? '待加强' : '跳过'}`);
    lines.push(`- **考核点**：${item.point}`);
    if (entry?.risk) lines.push(`- **风险**：${entry.risk}`);
    lines.push(`- **改进建议**：${entry?.improve || `把「${item.point}」拆成「结论 / 依据 / 怎么验证」三问，逐问写出答案。`}`);
    if (entry?.troubleshoot || profile.synthesis.troubleshoot) {
      lines.push(`- **排查框架**：${entry?.troubleshoot || profile.synthesis.troubleshoot}`);
    }
    lines.push('');
  });
  lines.push(`## 5. ${profile.ids.label}覆盖矩阵`);
  lines.push('');
  lines.push('| 编号 | 来源 | 具体项 | 考核点 | 必考/选考 | 是否考到 | 结果 | 用时 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const item of checklist) {
    const record = recordById.get(item.id);
    lines.push(`| ${item.id} | ${item.source} | ${item.module} | ${item.point} | ${item.required} | ${record === undefined ? '否' : '是'} | ${record === undefined ? '—' : record.verdict} | ${record === undefined ? '—' : formatSeconds(record.seconds)} |`);
  }
  lines.push('');
  lines.push(`## 6. 下一轮重点练的 3 道题`);
  lines.push('');
  const practice = checklist
    .map((item) => ({ item, record: recordById.get(item.id), entry: bank.get(item.id) }))
    .filter(({ record }) => record === undefined || record.verdict !== 'passed')
    .sort((a, b) => (a.record === undefined ? 0 : a.record.verdict === 'skipped' ? 1 : 2) - (b.record === undefined ? 0 : b.record.verdict === 'skipped' ? 1 : 2) || a.item.id.localeCompare(b.item.id))
    .slice(0, 3);
  if (practice.length === 0) lines.push('1. 覆盖完成，建议加练组合追问与压力追问。');
  practice.forEach(({ item, entry }, index) => {
    lines.push(`${index + 1}. ${item.id} ${item.module}：${entry?.question || item.point}`);
  });
  lines.push('');
  lines.push('## 7. 一句话总结');
  lines.push('');
  lines.push(summaryOf(profile, stats.score));
  lines.push('');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 工作区扫描（规则来自 profile.scan.rules）                            */
/* ------------------------------------------------------------------ */

function buildSkipRe(profile) {
  const names = profile.scan.skipDirs.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(^|[\\\\/])(${names})([\\\\/]|$)`, 'i');
}

function collectSourceFiles(workspace, profile) {
  const files = [];
  const skipRe = buildSkipRe(profile);
  const exts = profile.scan.extensions.map((e) => e.toLowerCase());
  const maxFiles = profile.scan.maxFiles;
  const maxDepth = profile.scan.maxDepth;
  const walk = (dir, depth) => {
    if (depth > maxDepth || files.length >= maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipRe.test(full)) continue;
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        if (!exts.some((ext) => lower.endsWith(ext))) continue;
        try {
          const stat = fs.statSync(full);
          if (stat.size > 512 * 1024) continue;
        } catch {
          continue;
        }
        files.push(full);
      }
    }
  };
  walk(workspace, 0);
  return files;
}

function detectMaterials(workspace, profile) {
  const materials = [];
  const skipRe = buildSkipRe(profile);
  let entries = [];
  try {
    entries = fs.readdirSync(workspace, { withFileTypes: true });
  } catch {
    return materials;
  }
  for (const entry of entries) {
    const full = path.join(workspace, entry.name);
    if (entry.isDirectory()) {
      if (skipRe.test(full)) continue;
      for (const rule of profile.scan.materials) {
        if (rule.hasMain.length === 0) continue;
        if (rule.hasMain.some((rel) => fs.existsSync(path.join(full, rel)))) {
          materials.push({ kind: rule.kind, name: entry.name, path: full });
          break;
        }
      }
    } else if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      for (const rule of profile.scan.materials) {
        if (rule.ext.length > 0 && lower.endsWith(rule.ext)) {
          materials.push({ kind: rule.kind, name: entry.name, path: full });
          break;
        }
      }
    }
  }
  return materials;
}

function scanWorkspace(workspace, profile) {
  const files = collectSourceFiles(workspace, profile);
  const items = [];
  const seen = new Set();
  const push = (item) => {
    const key = `${item.file}|${item.line}|${item.point}|${item.code}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (items.length < 90) items.push({ ...item, file: path.relative(workspace, item.file) });
  };
  for (const file of files) {
    const text = readText(file);
    if (text === undefined) continue;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const code = lines[index].trim();
      if (code.length === 0 || code.startsWith('//') || code.startsWith('/*') || code.startsWith('*') || code.startsWith('#')) continue;
      if (code.length > 200) continue;
      for (const rule of profile.scan.rules) {
        if (!rule.pattern.test(code)) continue;
        const window = lines.slice(Math.max(0, index - 1), Math.min(lines.length, index + 2)).map((line) => line.trim()).filter(Boolean).join(' | ');
        push({ point: rule.point, module: rule.module, file, line: index + 1, code: window.slice(0, 240) });
        break;
      }
    }
  }
  const groups = new Map();
  for (const item of items) {
    const bucket = groups.get(item.module) ?? [];
    bucket.push(item);
    groups.set(item.module, bucket);
  }
  return {
    workspace,
    scannedAt: nowIso(),
    enabled: profile.scan.enabled,
    materials: detectMaterials(workspace, profile),
    fileCount: files.length,
    itemCount: items.length,
    modules: [...groups.entries()]
      .map(([module, entries]) => ({ module, point: entries[0].point, items: entries.slice(0, 8) }))
      .sort((a, b) => String(a.point).localeCompare(String(b.point)) || a.module.localeCompare(b.module)),
  };
}

/* ------------------------------------------------------------------ */
/* skill 组装：模板 + profile 注入                                      */
/* ------------------------------------------------------------------ */

function renderSkill(profile, toolPrefix) {
  const template = readText(SKILL_TEMPLATE_PATH);
  if (template === undefined) return undefined;

  const checklistTable = profile.checklist.length > 0
    ? [
        `| 分组 | 编号 | 具体项 | 考核点 | 必考/选考 |`,
        `| --- | --- | --- | --- | --- |`,
        ...profile.checklist.map((item) => `| ${item.groupLabel} | ${item.id} | ${item.module} | ${item.point} | ${item.required} |`),
      ].join('\n')
    : '（本老师还没有考核点清单：出题前先按 persona 与材料现场拆点，并用 `teacher_create_profile` 把拆出的清单写回 profile。）';

  const modesText = profile.modes.map((mode) => `- \`${mode.id}\`：${mode.label}${mode.groups ? `（分组：${mode.groups.join('、')}）` : ''}`).join('\n');
  const commandsText = profile.commands.length > 0
    ? profile.commands.map((c) => `- “${c.command}”：${c.effect}`).join('\n')
    : '- “提示”：给 1 条思路，不给完整答案。\n- “跳过”：换下一题并记 skipped。\n- “参考答案”：给回答框架。\n- “结束面试”：生成复盘。';
  const followUpText = [
    `追问最多 ${profile.followUp.maxDepth} 层。`,
    profile.followUp.layer1 ? `第 1 层：${profile.followUp.layer1}` : '',
    profile.followUp.layer2 ? `第 2 层：${profile.followUp.layer2}` : '',
  ].filter(Boolean).join('\n');
  const timeBudgetText = profile.timeBudget.length > 0
    ? profile.timeBudget.map((t) => `- ${t.topic}：${t.range}`).join('\n')
    : '- 每题默认按考核点的 seconds 字段计时。';
  const principlesText = profile.principles.length > 0
    ? profile.principles.map((p, i) => `${i + 1}. ${p}`).join('\n')
    : [
        '1. 先拆考核点，再出题；每个最小考核点至少 1 题。',
        '2. 每轮只问 1 题，标注【来源】【覆盖考核点】【建议熟练回答时间】。',
        '3. 不把多个考核点合并成一道“综合题”凑覆盖。',
        '4. 不替用户回答，不直接给标准答案，除非用户说“提示”或“参考答案”。',
      ].join('\n');

  const values = {
    NAME: profile.name,
    SUBTITLE: profile.subtitle,
    ROLE: profile.persona.role,
    STYLE: profile.persona.style,
    SCOPE: profile.persona.scope,
    OUT_OF_SCOPE: profile.persona.outOfScope,
    LANGUAGE: profile.persona.language,
    ID_LABEL: profile.ids.label,
    MATERIALS: profile.materials,
    CHECKLIST_TABLE: checklistTable,
    MODES: modesText,
    PRINCIPLES: principlesText,
    FOLLOW_UP: followUpText,
    TIME_BUDGET: timeBudgetText,
    QUESTION_FORMAT: profile.questionFormat,
    COMMANDS: commandsText,
    OPENING: profile.opening,
    TOOLS: [`${toolPrefix}_state`, `${toolPrefix}_begin`, `${toolPrefix}_record`, `${toolPrefix}_report`].join(' / '),
    PROFILE_ID: profile.id,
  };

  let out = stripFrontmatter(template);
  for (const [key, value] of Object.entries(values)) {
    out = out.replaceAll(`{{${key}}}`, typeof value === 'string' && value.length > 0 ? value : '（未配置）');
  }
  out = out.split('\n').filter((line) => line.trim() !== '{{#if}}').join('\n');
  return out;
}

/* ------------------------------------------------------------------ */
/* RPC 方法                                                            */
/* ------------------------------------------------------------------ */

const RPC_METHOD_NAMES = [
  'state', 'question', 'begin', 'record', 'skip', 'next', 'setMode', 'setWorkspace',
  'reset', 'finish', 'report', 'copyPrompt', 'scan', 'profiles', 'profile', 'setProfile', 'createProfile',
];

function buildApi() {
  const session = { workspace: '', config: {} };
  let activeProfile = undefined;
  let onActiveChange = undefined;

  const setActive = (id) => {
    const profile = loadProfile(id);
    if (profile === undefined) throw new Error(`profile 不存在：${id}`);
    const changed = activeProfile?.id !== profile.id;
    activeProfile = profile;
    saveActiveId(id);
    if (session.workspace.length === 0) {
      session.workspace = profile.workspaceDefault.length > 0 && fs.existsSync(profile.workspaceDefault)
        ? profile.workspaceDefault
        : process.env.DSH_COACH_WORKSPACE || process.env.USERPROFILE || process.env.HOME || '';
    }
    if (changed) onActiveChange?.();
    return profile;
  };

  const init = () => {
    const id = loadActiveId();
    if (id !== undefined) {
      try {
        setActive(id);
      } catch (error) {
        log('warn', `加载 profile 失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  init();

  const requireProfile = () => {
    if (activeProfile === undefined) throw new Error('还没有任何老师 profile：先在会话里用「定制面试老师」向导创建一个，或把示例 profile 复制到 <DSH_HOME>/interview-teacher/profiles/');
    return activeProfile;
  };

  const profileSummary = (profile) => ({
    id: profile.id,
    name: profile.name,
    subtitle: profile.subtitle,
    user: profile.user,
    points: profile.checklist.length,
    bank: profile.bank.size,
    groups: profile.groups.length,
    modes: profile.modes.map((mode) => ({ id: mode.id, label: mode.label })),
  });

  const methods = {
    async profiles() {
      const list = listProfileIds();
      return {
        profiles: list.map((entry) => {
          const profile = loadProfile(entry.id);
          return profile === undefined ? { id: entry.id, user: entry.user, error: 'teacher.json 缺失或无法解析' } : profileSummary(profile);
        }),
        active: activeProfile?.id ?? null,
        dirs: { user: USER_PROFILES_DIR, bundled: BUNDLED_PROFILES_DIR },
      };
    },
    async profile() {
      const profile = requireProfile();
      return { profile: profileSummary(profile), persona: profile.persona, paths: { dir: profile.dir, state: statePath(profile.id) } };
    },
    async setProfile(args) {
      const id = String(args?.id ?? '').trim();
      const profile = setActive(id);
      return { active: profile.id, profile: profileSummary(profile) };
    },
    async createProfile(args) {
      const raw = args?.profile;
      if (raw === null || typeof raw !== 'object') throw new Error('createProfile 需要 { profile: <teacher.json 对象> }');
      const id = String(raw.id ?? '').trim();
      if (!PROFILE_ID_RE.test(id)) throw new Error(`profile id 只允许小写字母/数字/连字符（1–64 位）：${JSON.stringify(raw.id)}`);
      const dir = path.join(USER_PROFILES_DIR, id);
      if (fs.existsSync(path.join(dir, 'teacher.json')) && args?.overwrite !== true) {
        throw new Error(`profile「${id}」已存在于 ${dir}；换 id 或传 overwrite:true`);
      }
      const checklistInline = Array.isArray(raw.checklist) ? raw.checklist : undefined;
      const bankInline = Array.isArray(raw.questionBank) ? raw.questionBank : undefined;
      const teacherJson = { ...raw, id };
      if (checklistInline !== undefined) delete teacherJson.checklist;
      if (bankInline !== undefined) delete teacherJson.questionBank;
      ensureDir(dir);
      writeJsonAtomic(path.join(dir, 'teacher.json'), teacherJson);
      if (checklistInline !== undefined) writeJsonAtomic(path.join(dir, 'checklist.json'), checklistInline);
      if (bankInline !== undefined) writeJsonAtomic(path.join(dir, 'question-bank.json'), bankInline);
      const profile = loadProfile(id);
      if (profile === undefined) throw new Error(`profile 写入后校验失败：${id}`);
      return { created: profileSummary(profile), dir, warnings: profile.checklist.length === 0 ? ['考核点清单为空，老师会在首轮现场拆点'] : [] };
    },
    async state() {
      const profile = requireProfile();
      const state = loadState(profile);
      return {
        state,
        profile: profileSummary(profile),
        persona: profile.persona,
        checklist: profile.checklist,
        stats: statsOf(state, profile),
        modes: profile.modes.map((mode) => ({ id: mode.id, label: mode.label })),
        commands: profile.commands,
        panel: profile.panel,
        idLabel: profile.ids.label,
        scanEnabled: profile.scan.enabled,
        paths: { state: statePath(profile.id), workspace: session.workspace, dir: profile.dir, plugin: PLUGIN_ROOT },
        now: nowIso(),
      };
    },
    async question(args) {
      const profile = requireProfile();
      const id = String(args?.id ?? '');
      const item = profile.checklist.find((entry) => entry.id === id);
      if (item === undefined) throw new Error(`unknown point ${JSON.stringify(args?.id)}`);
      return synthesizeQuestion(profile, item, profile.bank.get(id));
    },
    async begin(args) {
      const profile = requireProfile();
      let state = loadState(profile);
      const mode = args?.mode ?? state.mode;
      if (!profile.modes.some((m) => m.id === mode)) throw new Error(`unknown mode ${JSON.stringify(mode)}`);
      const requested = typeof args?.id === 'string' ? args.id : undefined;
      const id = requested !== undefined && profile.checklist.some((item) => item.id === requested)
        ? requested
        : nextPointId(state, profile, state.current ?? undefined);
      if (id === undefined) throw new Error('没有可用考核点：先给 profile 补 checklist');
      state = {
        ...state,
        status: 'running',
        mode,
        current: id,
        startedAt: state.startedAt ?? nowIso(),
        timer: { id, startedAt: nowIso() },
        log: [...state.log, { at: nowIso(), kind: 'begin', id, mode }].slice(-200),
      };
      return { state: saveState(state), stats: statsOf(state, profile) };
    },
    async record(args) {
      const profile = requireProfile();
      const record = normalizeRecord(args, profile.ids.pattern);
      if (record === undefined) throw new Error(`record 需要 { id: 匹配 ${profile.ids.pattern} 的编号, verdict: passed|weak|skipped }`);
      let state = applyRecord(loadState(profile), record);
      return { state: saveState(state), stats: statsOf(state, profile) };
    },
    async skip(args) {
      const profile = requireProfile();
      const id = String(args?.id ?? loadState(profile).current ?? '');
      const record = normalizeRecord({ id, verdict: 'skipped', seconds: args?.seconds ?? 0, note: args?.note ?? '跳过' }, profile.ids.pattern);
      if (record === undefined) throw new Error('skip 需要有效的考核点 id');
      let state = applyRecord(loadState(profile), record);
      return { state: saveState(state), stats: statsOf(state, profile) };
    },
    async next(args) {
      const profile = requireProfile();
      let state = loadState(profile);
      const after = typeof args?.after === 'string' ? args.after : state.current ?? undefined;
      const id = nextPointId(state, profile, after);
      if (id === undefined) throw new Error('没有下一题');
      state = { ...state, status: state.status === 'idle' ? 'running' : state.status, current: id, timer: { id, startedAt: nowIso() } };
      return { state: saveState(state), stats: statsOf(state, profile) };
    },
    async setMode(args) {
      const profile = requireProfile();
      const mode = String(args?.mode ?? '');
      if (!profile.modes.some((m) => m.id === mode)) throw new Error(`unknown mode ${JSON.stringify(args?.mode)}`);
      const state = { ...loadState(profile), mode };
      return { state: saveState(state), stats: statsOf(state, profile) };
    },
    async setWorkspace(args) {
      const next = String(args?.workspace ?? '').trim();
      if (next.length === 0) throw new Error('workspace 路径为空');
      if (!fs.existsSync(next)) throw new Error(`workspace 不存在：${next}`);
      session.workspace = path.resolve(next);
      return { workspace: session.workspace };
    },
    async reset() {
      const profile = requireProfile();
      const state = saveState(defaultState(profile.id));
      return { state, stats: statsOf(state, profile) };
    },
    async report() {
      const profile = requireProfile();
      const state = loadState(profile);
      const stats = statsOf(state, profile);
      return { report: buildReport({ state, profile, stats, workspace: session.workspace }), stats, state };
    },
    async finish() {
      const profile = requireProfile();
      const state0 = loadState(profile);
      const stats = statsOf(state0, profile);
      const report = buildReport({ state: state0, profile, stats, workspace: session.workspace });
      const dir = path.join(session.workspace, profile.report.recordDir);
      ensureDir(dir);
      const file = path.join(dir, `${profile.report.reportPrefix}-${profile.id}-${stamp(new Date())}.md`);
      try {
        fs.writeFileSync(file, report, 'utf8');
      } catch (error) {
        throw new Error(`复盘写入失败：${error instanceof Error ? error.message : String(error)}`);
      }
      const state = saveState({ ...state0, status: 'finished', timer: null });
      return { report, reportPath: file, stats, state };
    },
    async copyPrompt() {
      const profile = requireProfile();
      const prompt = renderSkill(profile, 'interview');
      if (prompt === undefined) throw new Error('skill/TEACHER.md 模板不存在');
      return { prompt, bytes: Buffer.byteLength(prompt, 'utf8') };
    },
    async scan() {
      const profile = requireProfile();
      if (!profile.scan.enabled) return { enabled: false, workspace: session.workspace, materials: [], fileCount: 0, itemCount: 0, modules: [] };
      return scanWorkspace(session.workspace, profile);
    },
  };

  return {
    methods,
    session,
    get activeProfile() {
      return activeProfile;
    },
    set onActiveChange(hook) {
      onActiveChange = hook;
    },
  };
}

/* ------------------------------------------------------------------ */
/* HTTP 通道                                                           */
/* ------------------------------------------------------------------ */

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ */
/* 模型可见：skill + tools                                             */
/* ------------------------------------------------------------------ */

const TOOL_OUTPUT = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
  render: (_args, value) => [{ type: 'text', text: String(value.text) }],
};

function buildToolDefinitions(api) {
  return [
    {
      name: 'interview_state',
      description: '读取当前面试老师的状态：激活的老师（profile）、模式、当前考核点、已考/未考统计。开始或继续任何面试训练前先调用。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: TOOL_OUTPUT,
      async execute() {
        const value = await api.methods.state();
        const { state, checklist, stats, profile } = value;
        const lines = [];
        lines.push(`当前老师：${profile.name}（${profile.id}）｜状态：${state.status}｜模式：${state.mode}｜当前：${state.current ?? '无'}`);
        lines.push(`覆盖：${stats.attempted}/${stats.total}（${stats.coverage}%）｜得分：${stats.score}`);
        lines.push(`已考：${state.records.map((record) => `${record.id}:${record.verdict}`).join(', ') || '无'}`);
        lines.push(`未考：${checklist.filter((item) => !state.records.some((record) => record.id === item.id)).map((item) => item.id).join(', ') || '无'}`);
        lines.push(`考核点清单：${checklist.map((item) => `${item.id} ${item.module}（${item.required}）`).join('；') || '（空，需先拆点）'}`);
        return { text: lines.join('\n') };
      },
    },
    {
      name: 'interview_begin',
      description: '开始/继续面试：设定模式并选中当前考核点（不给 id 时自动跳到下一个未考点）。左侧栏面板会同步显示。',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', description: '面试模式 id（见 interview_state / 面板），默认沿用当前模式。' },
          id: { type: 'string', description: '指定从哪个考核点开始。' },
        },
        additionalProperties: false,
      },
      output: TOOL_OUTPUT,
      async execute(args) {
        const { state, stats } = await api.methods.begin(args ?? {});
        return { text: `已开始：${state.current}（模式 ${state.mode}）；覆盖 ${stats.attempted}/${stats.total}。` };
      },
    },
    {
      name: 'interview_record',
      description: '把一道题的结果写进面试状态（左侧栏实时同步）：通过 passed / 待加强 weak / 跳过 skipped，可带实际用时秒数和一句备注。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '考核点编号。' },
          verdict: { type: 'string', enum: ['passed', 'weak', 'skipped'], description: '本题结论。' },
          seconds: { type: 'integer', description: '实际用时（秒）。' },
          note: { type: 'string', description: '一句点评或追问记录。' },
        },
        required: ['id', 'verdict'],
        additionalProperties: false,
      },
      output: TOOL_OUTPUT,
      async execute(args) {
        const { state, stats } = await api.methods.record(args ?? {});
        return { text: `已记录 ${args?.id}：${args?.verdict}；覆盖 ${stats.attempted}/${stats.total}，当前题 ${state.current ?? '无'}。` };
      },
    },
    {
      name: 'interview_report',
      description: '生成当前老师的面试复盘（100 分制 + 分项评分 + 覆盖矩阵 + 风险点 + 下一轮重点题）。结束面试时调用；不写文件，写文件用面板「结束面试并落盘」。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: TOOL_OUTPUT,
      async execute() {
        const { report, stats } = await api.methods.report();
        return { text: `覆盖 ${stats.attempted}/${stats.total}，评分 ${stats.score}\n\n${report}` };
      },
    },
    {
      name: 'teacher_profiles',
      description: '列出所有面试老师 profile 并切换当前老师。不传参数=列出；传 id=切换到该老师（每个老师的面试进度独立保存）。',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: '要切换到的 profile id。' } },
        additionalProperties: false,
      },
      output: TOOL_OUTPUT,
      async execute(args) {
        if (typeof args?.id === 'string' && args.id.trim().length > 0) {
          const { active, profile } = await api.methods.setProfile({ id: args.id.trim() });

          return { text: `已切换到老师「${profile.name}」（${active}）：${profile.points} 个考核点、题库 ${profile.bank} 条。请重新按该老师的人设开场。` };
        }
        const value = await api.methods.profiles();
        const lines = value.profiles.map((p) => `${p.id === value.active ? '→ ' : '  '}${p.id}｜${p.name ?? '（损坏）'}｜考核点 ${p.points ?? '—'}｜${p.user ? '用户定制' : '内置示例'}${p.error ? `｜错误：${p.error}` : ''}`);
        lines.push(`用户 profile 目录：${value.dirs.user}`);
        return { text: lines.length > 0 ? lines.join('\n') : '还没有任何老师 profile。' };
      },
    },
    {
      name: 'teacher_create_profile',
      description: '创建/更新一个面试老师 profile（定制向导的最后一步）：传入完整 teacher.json 对象（含 id、name、persona、checklist、questionBank 等），插件校验后写入 <DSH_HOME>/interview-teacher/profiles/<id>/。字段说明见仓库 docs/PROFILE.md 与 templates/teacher.template.json。',
      parameters: {
        type: 'object',
        properties: {
          profile: { type: 'object', description: 'teacher.json 对象。至少包含 id、name、persona.role、checklist。' },
          overwrite: { type: 'boolean', description: '同 id 已存在时是否覆盖，默认 false。' },
        },
        required: ['profile'],
        additionalProperties: false,
      },
      output: TOOL_OUTPUT,
      async execute(args) {
        const value = await api.methods.createProfile(args ?? {});

        return { text: `已创建老师「${value.created.name}」（${value.created.id}），目录：${value.dir}；考核点 ${value.created.points} 个。可用 teacher_profiles 切换过去。${value.warnings.length > 0 ? `\n注意：${value.warnings.join('；')}` : ''}` };
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* 插件入口                                                            */
/* ------------------------------------------------------------------ */

export function apply(ctx, config = {}) {
  const api = buildApi();
  if (typeof config?.workspace === 'string' && config.workspace.trim().length > 0) {
    api.session.workspace = path.resolve(config.workspace.trim());
  }
  api.session.config = config ?? {};

  let webRegistered = false;
  let toolsRegistered = false;
  const disposers = [];
  let skillDisposer = undefined;
  let customizerDisposer = undefined;

  const registerWeb = () => {
    if (webRegistered) return;
    const webServer = ctx.get('webServer') ?? ctx.get('httpServer');
    if (webServer === undefined || typeof webServer.register !== 'function') return;
    webRegistered = true;
    disposers.push(
      ctx.effect(
        () =>
          webServer.register({
            kind: 'exact',
            path: RPC_PATH,
            handler: async (req, res) => {
              if (req.method !== 'POST') {
                sendJson(res, 405, { ok: false, error: 'method not allowed' });
                return;
              }
              let body;
              try {
                body = JSON.parse(await readBody(req));
              } catch (error) {
                sendJson(res, 400, { ok: false, error: `invalid json: ${error instanceof Error ? error.message : String(error)}` });
                return;
              }
              const method = typeof body?.method === 'string' ? body.method : '';
              const handler = Object.hasOwn(api.methods, method) ? api.methods[method] : undefined;
              if (handler === undefined) {
                sendJson(res, 400, { ok: false, error: `unknown method ${JSON.stringify(method)}` });
                return;
              }
              try {
                const value = await handler(body?.args ?? {});
                sendJson(res, 200, { ok: true, value });
              } catch (error) {
                sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
              }
            },
          }),
        'generic-interview: rpc route',
      ),
    );
    log('info', `RPC 已挂载 ${RPC_PATH}`);
  };

  const registerSkills = () => {
    const skills = ctx.get('skills');
    if (skills === undefined || typeof skills.register !== 'function') return;

    if (customizerDisposer === undefined) {
      const customizer = readText(CUSTOMIZER_SKILL_PATH);
      if (customizer !== undefined) {
        try {
          customizerDisposer = skills.register({
            name: 'interview-teacher-customizer',
            description: '面试老师定制向导：通过提问了解用户的岗位、项目、考核维度和严格程度，生成一份 teacher profile（人设+考核点+题库+复盘标准）并写入插件，让用户拥有自己的面试老师。',
            whenToUse: '用户说「定制/创建/新建面试老师」「做一个属于我的老师」「个性化」时使用；用户已有老师但想大改人设时也可使用。',
            content: stripFrontmatter(customizer),
            invocation: { modelInvocable: true, userInvocable: true },
          });
          log('info', '已注册 skill：interview-teacher-customizer');
        } catch (error) {
          log('warn', `注册定制向导失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    const profile = api.activeProfile;
    if (profile === undefined) return;
    const content = renderSkill(profile, 'interview');
    if (content === undefined) {
      log('warn', `skill 模板缺失：${SKILL_TEMPLATE_PATH}`);
      return;
    }
    try {
      if (typeof skillDisposer === 'function') skillDisposer();
    } catch {
      /* best effort */
    }
    try {
      skillDisposer = skills.register({
        name: 'interview-teacher',
        description: `当前面试老师「${profile.name}」：${profile.subtitle || profile.persona.role}。按 ${profile.ids.label}逐题考察，配合左侧栏面板与 interview_* 工具同步进度。`,
        whenToUse: '用户要求进行面试训练、模拟面试、逐题考察或复盘时使用。',
        content,
        invocation: { modelInvocable: true, userInvocable: true },
      });
      log('info', `已注册 skill：interview-teacher（profile: ${profile.id}）`);
    } catch (error) {
      log('warn', `注册老师 skill 失败（不影响面板）：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const registerTools = () => {
    if (toolsRegistered) return;
    const tools = ctx.get('tools');
    if (tools === undefined || typeof tools.register !== 'function') return;
    try {
      for (const definition of buildToolDefinitions(api)) {
        disposers.push(tools.register(definition));
      }
      toolsRegistered = true;
      log('info', '已注册工具：interview_state / interview_begin / interview_record / interview_report / teacher_profiles / teacher_create_profile');
    } catch (error) {
      toolsRegistered = false;
      log('warn', `注册工具失败（不影响面板）：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  api.onActiveChange = () => registerSkills();

  const installAll = () => {
    registerWeb();
    registerSkills();
    registerTools();
  };

  installAll();
  if (typeof ctx.on === 'function') {
    ctx.on('internal/service', () => installAll());
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        for (const dispose of disposers.splice(0)) {
          try {
            dispose();
          } catch {
            /* teardown best effort */
          }
        }
        for (const dispose of [skillDisposer, customizerDisposer]) {
          try {
            if (typeof dispose === 'function') dispose();
          } catch {
            /* teardown best effort */
          }
        }
      },
      'generic-interview: dispose',
    );
  }

  return {
    name,
    rpcPath: RPC_PATH,
    methods: RPC_METHOD_NAMES,
    homeDir: HOME_DIR,
    userProfilesDir: USER_PROFILES_DIR,
  };
}

/** 纯函数导出，供离线测试使用（不属于插件 API）。 */
export const __test = {
  normalizeProfile,
  normalizeState,
  normalizeRecord,
  statsOf,
  nextPointId,
  modePoints,
  buildReport,
  scanWorkspace,
  synthesizeQuestion,
  renderSkill,
  listProfileIds,
  loadProfile,
  buildApi,
  PROFILE_ID_RE,
  HOME_DIR,
  USER_PROFILES_DIR,
};
