/**
 * 离线自测：不需要启动 DSH。
 * 用临时 DSH_HOME 驱动宿主半（profile 装载、状态机、RPC 方法、skill 组装、
 * 扫描、复盘、注册），并用 vm.Script 校验浏览器半语法。
 *
 *   node scripts/selftest.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-generic-test-'));
process.env.DSH_HOME = TMP_HOME;

const mod = await import(pathToFileURL(path.join(ROOT, 'lib', 'index.js')).href);
const T = mod.__test;

let passed = 0;
function test(label, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok  ${label}`);
    })
    .catch((error) => {
      console.error(`FAIL  ${label}`);
      console.error(error instanceof Error ? error.stack : String(error));
      fs.rmSync(TMP_HOME, { recursive: true, force: true });
      process.exit(1);
    });
}

console.log(`DSH_HOME（临时）: ${TMP_HOME}\n`);

/* 1. 内置示例 profile 装载 */
let hw;
await test('示例 profile 装载：20 个硬件考核点 + 题库 + 6 分组 + 4 模式', () => {
  hw = T.loadProfile('example-hardware');
  assert.ok(hw, 'example-hardware 应存在');
  assert.equal(hw.checklist.length, 20);
  assert.ok(hw.bank.size >= 10);
  assert.equal(hw.groups.length, 6);
  assert.deepEqual(hw.modes.map((m) => m.id).sort(), ['all', 'interface', 'motor', 'power']);
  assert.ok(hw.ids.pattern.test('H01'));
  assert.ok(!hw.ids.pattern.test('A01'));
  assert.equal(hw.scan.rules.length, 15);
});

/* 2. 规范化与默认值 */
await test('normalizeProfile：teacher.json 缺失返回 undefined', () => {
  const minimal = T.normalizeProfile('minimal', path.join(TMP_HOME, 'nonexistent'));
  assert.equal(minimal, undefined);
});

await test('normalizeRecord：拒绝不匹配 id 正则的记录', () => {
  assert.equal(T.normalizeRecord({ id: 'Z99', verdict: 'passed' }, hw.ids.pattern), undefined);
  const ok = T.normalizeRecord({ id: 'H03', verdict: 'passed', seconds: 90 }, hw.ids.pattern);
  assert.equal(ok.id, 'H03');
  assert.equal(ok.verdict, 'passed');
  assert.equal(T.normalizeRecord({ id: 'H03', verdict: 'bogus' }, hw.ids.pattern).verdict, 'weak');
});

await test('normalizeState：非法 mode/current 回退默认', () => {
  const state = T.normalizeState({ mode: 'nope', current: 'BAD', status: 'running', records: [{ id: 'H01', verdict: 'passed' }, { id: 'BAD', verdict: 'weak' }] }, hw);
  assert.equal(state.mode, 'all');
  assert.equal(state.current, null);
  assert.equal(state.records.length, 1);
});

/* 3. 状态机与统计 */
await test('statsOf：必考点 passed×1 + weak×0.6 计分', () => {
  const state = T.normalizeState({
    records: [
      { id: 'H01', verdict: 'passed', seconds: 100 },
      { id: 'H02', verdict: 'weak', seconds: 100 },
      { id: 'H15', verdict: 'passed', seconds: 100 },
    ],
  }, hw);
  const stats = T.statsOf(state, hw);
  assert.equal(stats.attempted, 3);
  assert.equal(stats.score, 80); // (1 + 0.6) / 2 必考
  assert.equal(stats.coverage, 15);
});

await test('nextPointId：跳过已考、尊重模式分组', () => {
  const state = T.normalizeState({ mode: 'motor', records: [{ id: 'H06', verdict: 'passed' }] }, hw);
  const next = T.nextPointId(state, hw, 'H06');
  const item = hw.checklist.find((i) => i.id === next);
  assert.ok(item);
  assert.equal(item.group, 'motor');
  assert.notEqual(next, 'H06');
});

await test('synthesizeQuestion：题库命中 / 缺题合成', () => {
  const banked = T.synthesizeQuestion(hw, hw.checklist[0], hw.bank.get('H01'));
  assert.equal(banked.synthesized, false);
  const noBank = { id: 'H99', module: '测试模块', point: '要点一、要点二', seconds: 120 };
  const synth = T.synthesizeQuestion(hw, noBank, undefined);
  assert.equal(synth.synthesized, true);
  assert.ok(synth.question.includes('测试模块'));
  assert.ok(synth.question.includes('要点一'));
});

/* 4. 复盘 */
await test('buildReport：文案来自 profile，低覆盖不评级', () => {
  const state = T.normalizeState({ records: [{ id: 'H01', verdict: 'passed', seconds: 120 }] }, hw);
  const report = T.buildReport({ state, profile: hw, stats: T.statsOf(state, hw), workspace: TMP_HOME });
  assert.ok(report.includes('电控硬件面试 · 复盘报告'));
  assert.ok(report.includes('最容易被淘汰的 3 个硬件风险点'));
  assert.ok(report.includes('覆盖不足'));
  assert.ok(report.includes('| H01 |'));
});

await test('buildReport：高覆盖走评分档位与总结', () => {
  const records = hw.checklist.filter((i) => i.required === '必考').map((i) => ({ id: i.id, verdict: 'passed', seconds: 100 }));
  const state = T.normalizeState({ records }, hw);
  const stats = T.statsOf(state, hw);
  const report = T.buildReport({ state, profile: hw, stats, workspace: TMP_HOME });
  assert.equal(stats.score, 100);
  assert.ok(report.includes('优秀（可以顶住硬件评审追问）'));
  assert.ok(report.includes('硬件主线（供电—地—电平—驱动—测量）'));
});

/* 5. skill 组装 */
await test('renderSkill：占位符全部替换，含清单表与工具名', () => {
  const skill = T.renderSkill(hw, 'interview');
  assert.ok(skill);
  assert.ok(!skill.includes('{{'));
  assert.ok(skill.includes('电控硬件面试老师'));
  assert.ok(skill.includes('| 供电与地 | H01 |'));
  assert.ok(skill.includes('interview_state'));
  assert.ok(skill.includes('example-hardware'));
});

/* 6. RPC 全流程（buildApi） */
const api = T.buildApi();
await test('RPC profiles/setProfile：内置示例可列出并激活', async () => {
  const list = await api.methods.profiles();
  assert.ok(list.profiles.some((p) => p.id === 'example-hardware'));
  const switched = await api.methods.setProfile({ id: 'example-hardware' });
  assert.equal(switched.active, 'example-hardware');
  await assert.rejects(api.methods.setProfile({ id: 'no-such' }));
});

await test('RPC begin/record/next/skip/setMode/reset：状态闭环', async () => {
  await api.methods.reset();
  const begun = await api.methods.begin({ mode: 'power', id: 'H01' });
  assert.equal(begun.state.current, 'H01');
  assert.equal(begun.state.timer.id, 'H01');
  const recorded = await api.methods.record({ id: 'H01', verdict: 'passed', seconds: 95, note: '清楚' });
  assert.equal(recorded.state.current, null);
  assert.equal(recorded.stats.attempted, 1);
  const next = await api.methods.next({ after: 'H01' });
  assert.ok(next.state.current);
  const skipped = await api.methods.skip({ id: next.state.current });
  assert.equal(skipped.stats.attempted, 2);
  await api.methods.setMode({ mode: 'motor' });
  await assert.rejects(api.methods.setMode({ mode: 'bogus' }));
  await assert.rejects(api.methods.record({ id: 'BAD' }));
});

await test('RPC createProfile：向导写入新老师 + 进度隔离', async () => {
  const draft = {
    id: 'test-java',
    name: 'Java 后端面试老师',
    persona: { role: '8 年架构师', scope: 'JVM/并发' },
    ids: { pattern: '^A\\d{2}$', label: '考点' },
    checklist: [
      { id: 'A01', group: 'jvm', groupLabel: 'JVM', module: 'GC', point: 'GC 选型与调参', required: '必考', seconds: 180 },
      { id: 'A02', group: 'concurrency', groupLabel: '并发', module: '线程池', point: '参数与拒绝策略', required: '必考', seconds: 150 },
    ],
    questionBank: [{ id: 'A01', question: '为什么选 G1？', answer: ['分区回收', '停顿目标'] }],
    scoring: { grades: [{ min: 80, label: '很强' }], fallbackGrade: '还要练' },
  };
  const created = await api.methods.createProfile({ profile: draft });
  assert.equal(created.created.points, 2);
  assert.ok(fs.existsSync(path.join(created.dir, 'teacher.json')));
  assert.ok(fs.existsSync(path.join(created.dir, 'checklist.json')));
  await assert.rejects(api.methods.createProfile({ profile: draft }), /已存在/);
  const bad = await api.methods.createProfile({ profile: { id: 'bad id', name: 'x' } }).catch((e) => e);
  assert.ok(bad instanceof Error);

  await api.methods.setProfile({ id: 'test-java' });
  const state = await api.methods.state();
  assert.equal(state.profile.name, 'Java 后端面试老师');
  assert.equal(state.stats.attempted, 0); // 与硬件老师进度隔离
  assert.deepEqual(state.modes.map((m) => m.id).sort(), ['all', 'concurrency', 'jvm']); // 自动派生模式
  const begun = await api.methods.begin({});
  assert.equal(begun.state.current, 'A01');
  await api.methods.record({ id: 'A01', verdict: 'weak', seconds: 120 });
  const report = await api.methods.report();
  assert.ok(report.report.includes('Java 后端面试老师'));
  assert.ok(report.report.includes('很强') || report.report.includes('覆盖不足'));
  const prompt = await api.methods.copyPrompt();
  assert.ok(prompt.prompt.includes('8 年架构师'));
  assert.ok(!prompt.prompt.includes('{{'));

  await api.methods.setProfile({ id: 'example-hardware' });
  const hwState = await api.methods.state();
  assert.equal(hwState.stats.attempted, 2); // 硬件进度未受影响
});

await test('RPC scan/setWorkspace/finish：扫描证据 + 复盘落盘', async () => {
  const workspace = path.join(TMP_HOME, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'main.c'), 'void Motor_Init(void) {\n  TIM_TimeBaseInit(TIM2, &TIM_TimeBaseStructure);\n}\n', 'utf8');
  fs.writeFileSync(path.join(workspace, '题目.pdf'), '%PDF-1.4 fake', 'utf8');
  await api.methods.setWorkspace({ workspace });
  const scan = await api.methods.scan();
  assert.equal(scan.enabled, true);
  assert.ok(scan.fileCount >= 1);
  assert.ok(scan.itemCount >= 1);
  assert.ok(scan.modules.some((m) => m.point === 'H12'));
  assert.ok(scan.materials.some((m) => m.kind === '题目文档'));
  const finished = await api.methods.finish();
  assert.ok(finished.reportPath.includes('面试记录'));
  assert.ok(fs.existsSync(finished.reportPath));
  assert.ok(finished.report.includes('TIM') || finished.report.includes('H12') || finished.report.includes('复盘'));
  await assert.rejects(api.methods.setWorkspace({ workspace: path.join(TMP_HOME, 'nope') }));
});

/* 7. apply()：假 cordis ctx 注册 */
await test('apply：注册 RPC 路由、2 个 skill、6 个工具；切换老师重注册 skill', () => {
  const routes = new Map();
  const skills = new Map();
  const tools = new Map();
  let skillRegistrations = 0;
  const services = new Map();
  services.set('webServer', {
    register: (route) => {
      routes.set(route.path, route.handler);
      return () => routes.delete(route.path);
    },
  });
  services.set('skills', {
    register: (def) => {
      skills.set(def.name, def);
      if (def.name === 'interview-teacher') skillRegistrations += 1;
      return () => skills.delete(def.name);
    },
  });
  services.set('tools', {
    register: (def) => {
      tools.set(def.name, def);
      return () => tools.delete(def.name);
    },
  });
  const ctx = {
    get: (key) => services.get(key),
    effect: (fn) => fn(),
    on: () => {},
  };
  const result = mod.apply(ctx, {});
  assert.equal(result.name, 'dsh-generic-interview-teacher');
  assert.ok(routes.has('/plugins/dsh-generic-interview-teacher/rpc'));
  assert.ok(skills.has('interview-teacher'));
  assert.ok(skills.has('interview-teacher-customizer'));
  assert.equal(tools.size, 6);
  assert.ok(skills.get('interview-teacher').content.includes('电控硬件面试老师'));

  const teacherTool = tools.get('teacher_profiles');
  return teacherTool.execute({ id: 'test-java' }).then((out) => {
    assert.ok(out.text.includes('Java 后端面试老师'));
    assert.ok(skillRegistrations >= 2, '切换老师后应重新注册老师 skill');
    assert.ok(skills.get('interview-teacher').content.includes('8 年架构师'));
  });
});

await test('apply：HTTP 处理器路由与错误返回', async () => {
  const routes = new Map();
  const services = new Map();
  services.set('webServer', { register: (route) => { routes.set(route.path, route.handler); return () => {}; } });
  const ctx = { get: (k) => services.get(k), effect: (fn) => fn(), on: () => {} };
  mod.apply(ctx, {});
  const handler = routes.get('/plugins/dsh-generic-interview-teacher/rpc');
  assert.ok(handler);
  const { EventEmitter } = await import('node:events');
  const call = (method, args) => new Promise((resolve) => {
    const req = new EventEmitter();
    req.method = 'POST';
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { resolve(JSON.parse(body)); } };
    const done = handler(req, res);
    req.emit('data', Buffer.from(JSON.stringify({ method, args })));
    req.emit('end');
    return done;
  });
  const ok = await call('profiles', {});
  assert.equal(ok.ok, true);
  const bad = await call('nonexistent', {});
  assert.equal(bad.ok, false);
});

/* 8. 浏览器半语法校验（不执行） */
await test('client.js：语法可编译，注册入口齐全', () => {
  const source = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
  new vm.Script(source, { filename: 'client.js' });
  assert.ok(source.includes("id: 'dsh-generic-interview-teacher'"));
  assert.ok(source.includes('sidebar.panellist'));
  assert.ok(source.includes("key: PANEL_ID"));
  assert.ok(source.includes('switchTeacher'));
});

console.log(`\n全部通过：${passed} 项`);
fs.rmSync(TMP_HOME, { recursive: true, force: true });
