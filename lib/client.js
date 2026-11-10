/**
 * dsh-generic-interview-teacher — client half (browser).
 *
 * Bundle-plugin client format: `window.__ModuleLoader__.load({ id, factory })`.
 * The factory is CJS-style and may require only platform seed words
 * (`react`, `react/jsx-runtime`, primitives); everything else must be
 * self-contained.
 *
 * UI:
 *   - 左侧栏入口：`sidebar.panellist`（id `interview-coach`）
 *   - 全局面板：`main` keyed slot（key = `interview-coach`）
 *
 * 面板是「通用面试控制台」：老师（profile）切换器、考核点覆盖进度、当前题
 * （来源/考核点/建议时间/计时/提示/参考答案）、逐题记录、工程扫描（规则来自
 * profile）、复盘生成与落盘、可复制的面试命令。所有文案从当前 profile 读取。
 *
 * Data comes from the host route POST /plugins/dsh-generic-interview-teacher/rpc.
 */

window.__ModuleLoader__.load({
  id: 'dsh-generic-interview-teacher',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const react = require('react');
    const h = react.createElement;

    const PANEL_ID = 'interview-coach';
    const RPC_PATH = '/plugins/dsh-generic-interview-teacher/rpc';
    const REFRESH_MS = 12000;

    const VERDICT_LABEL = { passed: '通过', weak: '待加强', skipped: '跳过' };
    const VERDICT_COLOR = { passed: '#12a150', weak: '#e0a500', skipped: '#8a919c' };

    const CSS = [
      '.giw-page{box-sizing:border-box;min-height:100%;overflow:auto;padding:calc(var(--dsh-frame-top-clearance,0px) + 20px) 24px 48px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#1b1f27)}',
      '.giw-inner{max-width:1180px;margin:0 auto}',
      '.giw-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}',
      '.giw-mark{width:38px;height:38px;flex:none;border-radius:11px;display:flex;align-items:center;justify-content:center;color:#fff;background:linear-gradient(135deg,#3d5afe,#7b5cff);box-shadow:0 6px 18px rgba(77,107,254,.28)}',
      '.giw-title{font-size:20px;font-weight:660;margin:0;letter-spacing:.01em}',
      '.giw-sub{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#8a919c);margin-top:3px}',
      '.giw-chips{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto;justify-content:flex-end;max-width:46%}',
      '.giw-chip{display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid var(--dsw-alias-line-normal,#e7e9ee);color:var(--dsw-alias-label-secondary,#5c6470);white-space:nowrap}',
      '.giw-chip b{font-weight:620;color:var(--dsw-alias-label-primary,#1b1f27)}',
      '.giw-dot{width:7px;height:7px;border-radius:50%;background:#8a919c;display:inline-block}',
      '.giw-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 14px}',
      '.giw-btn{font:inherit;font-size:12.5px;padding:6px 11px;border-radius:8px;border:1px solid var(--dsw-alias-line-normal,#e7e9ee);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#5c6470);cursor:pointer;white-space:nowrap;transition:border-color .12s ease,color .12s ease}',
      '.giw-btn:hover{border-color:var(--dsw-alias-state-business-primary,#4d6bfe);color:var(--dsw-alias-label-primary,#1b1f27)}',
      '.giw-btn:disabled{opacity:.55;cursor:default}',
      '.giw-btn.primary{background:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:transparent;color:#fff;font-weight:600}',
      '.giw-btn.primary:hover{color:#fff;filter:brightness(1.05)}',
      '.giw-btn.ghost{background:transparent}',
      '.giw-teachers{display:flex;gap:7px;flex-wrap:wrap}',
      '.giw-teacher{font:inherit;text-align:left;display:flex;flex-direction:column;gap:2px;padding:8px 11px;border-radius:10px;border:1px solid var(--dsw-alias-line-normal,#e7e9ee);background:var(--dsw-alias-bg-base,#fff);cursor:pointer;min-width:150px;color:inherit}',
      '.giw-teacher:hover{border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.giw-teacher.on{background:rgba(77,107,254,.1);border-color:transparent}',
      '.giw-teacher b{font-size:13px;font-weight:640}',
      '.giw-teacher em{font-size:11px;font-style:normal;color:var(--dsw-alias-label-tertiary,#8a919c)}',
      '.giw-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:12px;align-items:start}',
      '.giw-col{display:flex;flex-direction:column;gap:12px;min-width:0}',
      '.giw-card{border:1px solid var(--dsw-alias-line-normal,#e7e9ee);border-radius:13px;background:var(--dsw-alias-bg-elevated,#fafbfc);padding:14px 16px;min-width:0}',
      '.giw-card h3{margin:0 0 10px;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#5c6470);display:flex;align-items:center;gap:8px}',
      '.giw-card h3 em{font-style:normal;font-weight:500;color:var(--dsw-alias-label-tertiary,#8a919c);font-size:11.5px}',
      '.giw-qhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}',
      '.giw-qid{font-family:var(--dsw-font-family-mono,ui-monospace);font-size:12px;font-weight:700;padding:2px 7px;border-radius:6px;background:rgba(77,107,254,.12);color:#4d6bfe}',
      '.giw-meta{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a919c)}',
      '.giw-qtext{font-size:15px;line-height:1.8;font-weight:560;margin:2px 0 10px;white-space:pre-wrap}',
      '.giw-qsub{font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-secondary,#5c6470)}',
      '.giw-qsub ul{margin:4px 0 8px;padding-left:18px}',
      '.giw-qsub li{margin:2px 0}',
      '.giw-field{font-size:11px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8a919c);margin:10px 0 4px}',
      '.giw-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}',
      '.giw-timer{font-family:var(--dsw-font-family-mono,ui-monospace);font-size:13px;font-weight:650;padding:4px 9px;border-radius:7px;background:var(--dsw-alias-bg-sunken,#eceef2);color:var(--dsw-alias-label-primary,#1b1f27)}',
      '.giw-timer.live{background:rgba(18,161,80,.12);color:#0f8a44}',
      '.giw-metrics{display:flex;align-items:baseline;gap:8px}',
      '.giw-big{font-size:30px;font-weight:700;line-height:1.05;letter-spacing:-.01em}',
      '.giw-big span{font-size:14px;font-weight:500;color:var(--dsw-alias-label-tertiary,#8a919c)}',
      '.giw-small{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a919c)}',
      '.giw-bar{height:7px;border-radius:999px;background:var(--dsw-alias-bg-sunken,#eceef2);overflow:hidden;margin:10px 0 4px}',
      '.giw-bar>i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#4d6bfe,#7b5cff);transition:width .3s ease}',
      '.giw-grow{display:flex;flex-direction:column;gap:7px;margin-top:10px}',
      '.giw-grow-row{display:grid;grid-template-columns:76px minmax(0,1fr) 52px;gap:8px;align-items:center;font-size:12px}',
      '.giw-grow-row span:first-child{color:var(--dsw-alias-label-secondary,#5c6470)}',
      '.giw-grow-row span:last-child{text-align:right;color:var(--dsw-alias-label-tertiary,#8a919c);font-variant-numeric:tabular-nums}',
      '.giw-mini{height:5px;border-radius:999px;background:var(--dsw-alias-bg-sunken,#eceef2);overflow:hidden}',
      '.giw-mini>i{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.giw-modes{display:flex;gap:6px;flex-wrap:wrap}',
      '.giw-mode{font:inherit;font-size:12px;padding:5px 10px;border-radius:8px;border:1px solid var(--dsw-alias-line-normal,#e7e9ee);background:transparent;color:var(--dsw-alias-label-secondary,#5c6470);cursor:pointer}',
      '.giw-mode.on{background:rgba(77,107,254,.12);border-color:transparent;color:#4d6bfe;font-weight:600}',
      '.giw-table{width:100%;border-collapse:collapse;font-size:12.5px}',
      '.giw-table th{position:sticky;top:0;background:var(--dsw-alias-bg-elevated,#fafbfc);text-align:left;font-size:11px;font-weight:650;letter-spacing:.05em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8a919c);padding:7px 8px;border-bottom:1px solid var(--dsw-alias-line-normal,#e7e9ee);z-index:1}',
      '.giw-table td{padding:7px 8px;border-bottom:1px dashed var(--dsw-alias-line-normal,#eef0f4);vertical-align:top}',
      '.giw-table tr{cursor:pointer}',
      '.giw-table tbody tr:hover{background:rgba(77,107,254,.05)}',
      '.giw-table tr.on{background:rgba(77,107,254,.09)}',
      '.giw-table code{font-family:var(--dsw-font-family-mono,ui-monospace);font-size:11.5px;font-weight:700;color:#4d6bfe}',
      '.giw-table .pt{color:var(--dsw-alias-label-secondary,#5c6470)}',
      '.giw-scroll{max-height:360px;overflow:auto;border-radius:10px;margin:0 -4px}',
      '.giw-status{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;white-space:nowrap}',
      '.giw-tag{font-size:10.5px;padding:1px 6px;border-radius:5px;background:var(--dsw-alias-bg-sunken,#eceef2);color:var(--dsw-alias-label-tertiary,#8a919c)}',
      '.giw-tag.req{background:rgba(196,48,43,.1);color:#c4302b}',
      '.giw-cmds{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:7px}',
      '.giw-cmd{display:flex;flex-direction:column;gap:1px;padding:7px 9px;border-radius:8px;border:1px solid var(--dsw-alias-line-normal,#e7e9ee);background:var(--dsw-alias-bg-base,#fff);cursor:pointer;text-align:left;font:inherit;color:inherit}',
      '.giw-cmd:hover{border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}',
      '.giw-cmd b{font-size:12.5px;font-weight:600}',
      '.giw-cmd em{font-size:10.5px;font-style:normal;color:var(--dsw-alias-label-tertiary,#8a919c)}',
      '.giw-scanmod{display:flex;flex-direction:column;gap:6px;margin-top:8px;max-height:240px;overflow:auto}',
      '.giw-scanmod>div{border:1px solid var(--dsw-alias-line-normal,#eef0f4);border-radius:8px;padding:7px 9px;background:var(--dsw-alias-bg-base,#fff)}',
      '.giw-scanmod b{font-size:12px}',
      '.giw-scanmod code{display:block;font-family:var(--dsw-font-family-mono,ui-monospace);font-size:10.5px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8a919c);margin-top:3px;white-space:pre-wrap;word-break:break-all}',
      '.giw-pre{font-family:var(--dsw-font-family-mono,ui-monospace);font-size:11.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;margin:0;padding:12px;border-radius:10px;background:var(--dsw-alias-bg-sunken,#f2f4f7);color:var(--dsw-alias-label-primary,#1b1f27)}',
      '.giw-note{font-size:11.5px;line-height:1.7;color:var(--dsw-alias-label-tertiary,#8a919c);margin-top:8px}',
      '.giw-note code{font-family:var(--dsw-font-family-mono,ui-monospace);word-break:break-all}',
      '.giw-empty{font-size:12.5px;color:var(--dsw-alias-label-tertiary,#8a919c);line-height:1.7}',
      '.giw-err{font-size:12.5px;color:#c4302b;background:rgba(196,48,43,.07);border-radius:8px;padding:8px 10px;margin-bottom:10px;word-break:break-all}',
      '.giw-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#1b1f27;color:#fff;font-size:12px;padding:8px 14px;border-radius:8px;z-index:80;opacity:.96;max-width:70vw;text-align:center}',
      '@media (max-width:980px){.giw-grid{grid-template-columns:minmax(0,1fr)}.giw-chips{max-width:100%}}',
    ].join('');

    /* -------------------------------------------------------------- */
    /* 基础设施                                                        */
    /* -------------------------------------------------------------- */

    function rpc(method, args) {
      return fetch(RPC_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ method, args: args ?? {} }),
      })
        .then((res) => res.json())
        .then((payload) => {
          if (!payload || payload.ok !== true) throw new Error((payload && payload.error) || 'RPC 失败');
          return payload.value;
        });
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand('copy');
      } finally {
        area.remove();
      }
      return Promise.resolve();
    }

    function pct(value, total) {
      if (!total) return 0;
      return Math.max(0, Math.min(100, Math.round((value / total) * 100)));
    }

    function fmtClock(totalSeconds) {
      const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
      const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
      const ss = String(seconds % 60).padStart(2, '0');
      return `${mm}:${ss}`;
    }

    function fmtTime(totalSeconds) {
      const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
      return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`;
    }

    function since(startedAt) {
      if (typeof startedAt !== 'string') return 0;
      const started = Date.parse(startedAt);
      if (!Number.isFinite(started)) return 0;
      return Math.max(0, Math.round((Date.now() - started) / 1000));
    }

    function CoachIcon() {
      return h(
        'svg',
        { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M12 4 3 8.5l9 4.5 9-4.5L12 4Z', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round' }),
        h('path', { d: 'M6.5 10.8V15c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3v-4.2', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('path', { d: 'M21 8.5v5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      );
    }

    function Card(props) {
      return h(
        'div',
        { className: 'giw-card', style: props.style },
        h('h3', null, props.title, props.hint !== undefined ? h('em', null, props.hint) : null),
        props.children,
      );
    }

    /* -------------------------------------------------------------- */
    /* 面板                                                            */
    /* -------------------------------------------------------------- */

    function InterviewCoachPage() {
      const [data, setData] = react.useState(null);
      const [teachers, setTeachers] = react.useState(null);
      const [question, setQuestion] = react.useState(null);
      const [scan, setScan] = react.useState(null);
      const [report, setReport] = react.useState(null);
      const [error, setError] = react.useState(null);
      const [toast, setToast] = react.useState('');
      const [busy, setBusy] = react.useState(false);
      const [showHint, setShowHint] = react.useState(false);
      const [showAnswer, setShowAnswer] = react.useState(false);
      const [, forceTick] = react.useState(0);
      const currentRef = react.useRef(null);

      const showToast = react.useCallback((text) => {
        setToast(text);
        setTimeout(() => setToast(''), 2200);
      }, []);

      const refreshTeachers = react.useCallback(() => {
        return rpc('profiles')
          .then((value) => setTeachers(value))
          .catch(() => {});
      }, []);

      const refresh = react.useCallback(
        (options) => {
          const silent = options && options.silent;
          if (!silent) setBusy(true);
          return rpc('state')
            .then((value) => {
              setData(value);
              setError(null);
              const current = value && value.state ? value.state.current : null;
              if (current !== currentRef.current) {
                currentRef.current = current;
                setShowHint(false);
                setShowAnswer(false);
                if (current === null) {
                  setQuestion(null);
                } else {
                  return rpc('question', { id: current }).then((entry) => setQuestion(entry));
                }
              }
              return undefined;
            })
            .catch((err) => setError(err instanceof Error ? err.message : String(err)))
            .finally(() => {
              if (!silent) setBusy(false);
            });
        },
        [],
      );

      react.useEffect(() => {
        refresh();
        refreshTeachers();
        const timer = setInterval(() => refresh({ silent: true }), REFRESH_MS);
        const tick = setInterval(() => forceTick((value) => value + 1), 1000);
        return () => {
          clearInterval(timer);
          clearInterval(tick);
        };
      }, [refresh, refreshTeachers]);

      const state = data && data.state ? data.state : null;
      const teacher = data && data.profile ? data.profile : null;
      const idLabel = data && data.idLabel ? data.idLabel : '考核点';
      const checklist = data && Array.isArray(data.checklist) ? data.checklist : [];
      const stats = data && data.stats ? data.stats : null;
      const modes = data && Array.isArray(data.modes) ? data.modes : [];
      const paths = data && data.paths ? data.paths : {};
      const scanEnabled = data ? data.scanEnabled !== false : true;
      const currentId = state && state.current ? state.current : null;
      const currentItem = currentId === null ? null : checklist.find((item) => item.id === currentId) || null;
      const currentIndex = currentItem === null ? -1 : checklist.findIndex((item) => item.id === currentItem.id);
      const recordById = new Map();
      if (state && Array.isArray(state.records)) for (const record of state.records) recordById.set(record.id, record);
      const liveTimer = state && state.timer && state.timer.id ? since(state.timer.startedAt) : null;
      const elapsed = liveTimer === null ? 0 : liveTimer;

      const applyState = (value) => {
        if (value && value.state) {
          setData((previous) => {
            if (previous === null) return previous;
            return { ...previous, state: value.state, stats: value.stats ?? previous.stats };
          });
          const next = value.state.current ?? null;
          if (next !== currentRef.current) {
            currentRef.current = next;
            setShowHint(false);
            setShowAnswer(false);
            if (next === null) setQuestion(null);
            else rpc('question', { id: next }).then((entry) => setQuestion(entry)).catch(() => {});
          }
        }
      };

      const run = (method, args, label) => {
        setBusy(true);
        return rpc(method, args)
          .then((value) => {
            applyState(value);
            if (label) showToast(label);
            return value;
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            showToast(message);
            return undefined;
          })
          .finally(() => setBusy(false));
      };

      const switchTeacher = (id) => {
        setBusy(true);
        setReport(null);
        setScan(null);
        setQuestion(null);
        currentRef.current = '__switch__';
        return rpc('setProfile', { id })
          .then(() => {
            showToast(`已切换老师：${id}`);
            return Promise.all([refresh({ silent: true }), refreshTeachers()]);
          })
          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusy(false));
      };

      const startInterview = () => run('begin', { mode: state ? state.mode : 'all' }, currentId === null ? '开始面试' : '已切到下一题');
      const setMode = (mode) => run('setMode', { mode }, `模式：${(modes.find((item) => item.id === mode) || {}).label || mode}`);
      const recordVerdict = (verdict) => {
        if (currentId === null) return undefined;
        const seconds = elapsed;
        return run('record', { id: currentId, verdict, seconds }, `已记录 ${currentId}：${VERDICT_LABEL[verdict]}`).then(() => run('next', { after: currentId }, '下一题'));
      };
      const skipCurrent = () => {
        if (currentId === null) return undefined;
        return run('skip', { id: currentId, seconds: elapsed }, `已跳过 ${currentId}`).then(() => run('next', { after: currentId }, '下一题'));
      };
      const goPoint = (id) => run('begin', { id, mode: state ? state.mode : 'all' }, `切到 ${id}`);
      const finishInterview = () => {
        setBusy(true);
        return rpc('finish')
          .then((value) => {
            setReport(value);
            showToast(`复盘已落盘：${value.reportPath}`);
            return refresh({ silent: true });
          })
          .catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            showToast('落盘失败，可先用「预览复盘」');
          })
          .finally(() => setBusy(false));
      };
      const previewReport = () => {
        setBusy(true);
        return rpc('report')
          .then((value) => {
            setReport(value);
            showToast('复盘已生成（未落盘）');
          })
          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusy(false));
      };
      const scanWorkspace = () => {
        setBusy(true);
        return rpc('scan')
          .then((value) => {
            setScan(value);
            showToast(value.enabled === false ? '该老师未配置扫描规则' : `扫描完成：${value.fileCount} 个源文件 / ${value.itemCount} 条证据`);
          })
          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusy(false));
      };
      const copyPrompt = () => {
        setBusy(true);
        return rpc('copyPrompt')
          .then((value) => copyText(value.prompt).then(() => showToast(`已复制「${teacher ? teacher.name : '老师'}」提示词（${value.bytes} 字节），粘到新会话即可开工`)))
          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => setBusy(false));
      };
      const changeWorkspace = () => {
        const next = typeof window.prompt === 'function' ? window.prompt('工程/材料目录绝对路径：', paths.workspace || '') : null;
        if (next === null || next.trim().length === 0) return undefined;
        return run('setWorkspace', { workspace: next.trim() }, '目录已更新（本进程内有效）').then(() => refresh({ silent: true }));
      };
      const resetInterview = () => {
        if (typeof window.confirm === 'function' && !window.confirm(`清空老师「${teacher ? teacher.name : ''}」的所有面试记录？`)) return undefined;
        return run('reset', {}, '已清空面试记录').then(() => setReport(null));
      };
      const copyCommand = (text) => () => copyText(text).then(() => showToast(`已复制「${text}」`));

      const statusLabel = state === null ? '未开始' : state.status === 'running' ? '进行中' : state.status === 'finished' ? '已结束' : '未开始';
      const statusColor = state === null || state.status === 'idle' ? '#8a919c' : state.status === 'finished' ? '#12a150' : '#4d6bfe';
      const askedCount = stats === null ? 0 : stats.attempted;
      const totalCount = stats === null ? checklist.length : stats.total;

      const commands = Array.isArray(data && data.commands) && data.commands.length > 0
        ? data.commands.map((c) => [c.command, c.effect])
        : [
            ['开始面试', '拆点→逐题考察'],
            ['继续面试', '从断点接续'],
            ['提示', '只给 1 条思路'],
            ['参考答案', '回答框架'],
            ['跳过', '换题并记未覆盖'],
            ['结束面试', '100 分制复盘'],
          ];
      commands.push(['定制面试老师', '向导生成新老师']);

      return h(
        'div',
        { className: 'giw-page' },
        h(
          'div',
          { className: 'giw-inner' },
          h(
            'div',
            { className: 'giw-head' },
            h('div', { className: 'giw-mark' }, h(CoachIcon)),
            h(
              'div',
              { style: { minWidth: 0 } },
              h('h1', { className: 'giw-title' }, teacher ? teacher.name : '面试教练'),
              h(
                'div',
                { className: 'giw-sub' },
                teacher && teacher.subtitle
                  ? teacher.subtitle
                  : '通用面试老师 · 老师由 profile 定义，可在下方切换或用「定制面试老师」向导创建',
              ),
            ),
            h(
              'div',
              { className: 'giw-chips' },
              h('span', { className: 'giw-chip' }, h('i', { className: 'giw-dot', style: { background: statusColor } }), '状态 ', h('b', null, statusLabel)),
              h('span', { className: 'giw-chip' }, '覆盖 ', h('b', null, `${askedCount}/${totalCount}`)),
              h('span', { className: 'giw-chip' }, '当前 ', h('b', null, currentId ?? '—')),
              h('span', { className: 'giw-chip' }, '计时 ', h('b', null, currentId === null ? '—' : fmtClock(elapsed))),
            ),
          ),
          h(
            Card,
            { title: '我的老师', hint: teachers ? `${teachers.profiles.length} 个 profile · 进度各自独立` : '加载中…' },
            teachers === null || teachers.profiles.length === 0
              ? h('div', { className: 'giw-empty' }, '还没有老师。在会话里发送「定制面试老师」，向导会引导你生成第一个 profile；或把示例 profile 复制到 ', h('code', null, (teachers && teachers.dirs ? teachers.dirs.user : '<DSH_HOME>/interview-teacher/profiles/')), '。')
              : h(
                  'div',
                  { className: 'giw-teachers' },
                  teachers.profiles.map((p) =>
                    h(
                      'button',
                      { key: p.id, className: 'giw-teacher' + (p.id === teachers.active ? ' on' : ''), disabled: busy || p.error !== undefined, onClick: () => switchTeacher(p.id), title: p.error || `${p.points} 个考核点 · 题库 ${p.bank} 条` },
                      h('b', null, p.name || p.id),
                      h('em', null, p.error ? '损坏' : `${p.id} · ${p.points} 点 · ${p.user ? '定制' : '内置'}`),
                    ),
                  ),
                ),
          ),
          h(
            'div',
            { className: 'giw-toolbar', style: { marginTop: 14 } },
            h('button', { className: 'giw-btn primary', disabled: busy, onClick: startInterview }, currentId === null ? '开始面试' : '下一题（开始计时）'),
            h('button', { className: 'giw-btn', disabled: busy, onClick: previewReport }, '预览复盘'),
            h('button', { className: 'giw-btn', disabled: busy, onClick: finishInterview }, '结束面试并落盘'),
            scanEnabled ? h('button', { className: 'giw-btn', disabled: busy, onClick: scanWorkspace }, '扫描工程') : null,
            h('button', { className: 'giw-btn ghost', disabled: busy, onClick: copyPrompt }, '复制角色提示词'),
            h('button', { className: 'giw-btn ghost', disabled: busy, onClick: changeWorkspace }, '切换工程目录'),
            h('button', { className: 'giw-btn ghost', disabled: busy, onClick: () => refresh() }, busy ? '刷新中…' : '刷新状态'),
            h('button', { className: 'giw-btn ghost', disabled: busy, onClick: resetInterview }, '清空'),
          ),
          error !== null ? h('div', { className: 'giw-err' }, `读取失败：${error}`) : null,
          h(
            'div',
            { className: 'giw-grid' },
            h(
              'div',
              { className: 'giw-col' },
              h(
                Card,
                { title: '当前题', hint: currentItem === null ? '从右侧清单或「开始面试」选题' : `第 ${currentIndex + 1} / ${checklist.length} 题` },
                currentItem === null
                  ? h(
                      'div',
                      { className: 'giw-empty' },
                      `还没有选题。点「开始面试」自动跳到第一个未考点，或在下方《${idLabel}清单》点一行直接开考。`,
                      h('div', { className: 'giw-note' }, '面试对话在会话里进行；面板负责计时、选题与记录，结果实时同步。'),
                    )
                  : h(
                      'div',
                      null,
                      h(
                        'div',
                        { className: 'giw-qhead' },
                        h('span', { className: 'giw-qid' }, currentItem.id),
                        currentItem.source ? h('span', { className: 'giw-meta' }, `来源：${currentItem.source}${currentItem.module ? ` - ${currentItem.module}` : ''}`) : null,
                        h('span', { className: 'giw-tag req' }, currentItem.required),
                        h('span', { className: 'giw-timer' + (state && state.timer ? ' live' : '') }, fmtClock(elapsed), ' / 建议 ', fmtClock(currentItem.seconds)),
                      ),
                      h('div', { className: 'giw-field' }, `覆盖${idLabel}`),
                      h('div', { className: 'giw-qsub' }, `${currentItem.id} ${currentItem.point}`),
                      currentItem.stage ? h('div', { className: 'giw-note' }, `出处：${currentItem.stage}`) : null,
                      h('div', { className: 'giw-field' }, '题目'),
                      h('div', { className: 'giw-qtext' }, question ? question.question : '（题库加载中…）'),
                      showHint
                        ? h(
                            'div',
                            { className: 'giw-qsub' },
                            h('div', { className: 'giw-field' }, '提示（只给思路）'),
                            h('div', null, question && question.hint ? question.hint : '先给结论，再讲依据，最后讲怎么验证。'),
                          )
                        : null,
                      showAnswer
                        ? h(
                            'div',
                            { className: 'giw-qsub' },
                            h('div', { className: 'giw-field' }, '参考答案框架'),
                            h(
                              'ul',
                              null,
                              (question && Array.isArray(question.answer) && question.answer.length > 0 ? question.answer : ['结论', '依据', '怎么验证']).map((line, index) =>
                                h('li', { key: index }, line),
                              ),
                            ),
                            question && question.followUps && question.followUps.length > 0
                              ? h(
                                  'div',
                                  null,
                                  h('div', { className: 'giw-field' }, '追问'),
                                  h('ul', null, question.followUps.map((line, index) => h('li', { key: index }, line))),
                                )
                              : null,
                          )
                        : null,
                      h(
                        'div',
                        { className: 'giw-actions' },
                        h('button', { className: 'giw-btn', disabled: busy, onClick: () => setShowHint(!showHint) }, showHint ? '收起提示' : '提示'),
                        h('button', { className: 'giw-btn', disabled: busy, onClick: () => setShowAnswer(!showAnswer) }, showAnswer ? '收起参考答案' : '参考答案'),
                        h('button', { className: 'giw-btn primary', disabled: busy, onClick: () => recordVerdict('passed') }, '通过并下一题'),
                        h('button', { className: 'giw-btn', disabled: busy, onClick: () => recordVerdict('weak') }, '待加强并下一题'),
                        h('button', { className: 'giw-btn', disabled: busy, onClick: skipCurrent }, '跳过'),
                        h('button', { className: 'giw-btn ghost', disabled: busy, onClick: () => run('begin', { id: currentId, mode: state ? state.mode : 'all' }, '计时已重置') }, '重置计时'),
                      ),
                      h(
                        'div',
                        { className: 'giw-note' },
                        '点评与追问请在会话里进行。记录结果写进 ',
                        h('code', null, paths.state || '<DSH_HOME>/interview-teacher/state-<profile>.json'),
                        '。',
                      ),
                    ),
              ),
              h(
                Card,
                { title: `${idLabel}清单`, hint: `${checklist.length} 点 · 必考 ${checklist.filter((item) => item.required === '必考').length}` },
                checklist.length === 0
                  ? h('div', { className: 'giw-empty' }, '该老师还没有考核点清单。在会话里说「定制面试老师」补全，或直接编辑 profile 目录下的 checklist.json。')
                  : h(
                      'div',
                      { className: 'giw-scroll' },
                      h(
                        'table',
                        { className: 'giw-table' },
                        h('thead', null, h('tr', null, h('th', { style: { width: 52 } }, '编号'), h('th', null, '具体项 / 考核点'), h('th', { style: { width: 74 } }, '状态'), h('th', { style: { width: 58 } }, '建议'))),
                        h(
                          'tbody',
                          null,
                          checklist.map((item) => {
                            const record = recordById.get(item.id);
                            const on = record !== undefined;
                            return h(
                              'tr',
                              { key: item.id, className: item.id === currentId ? 'on' : '', onClick: () => (busy ? undefined : goPoint(item.id)), title: item.point },
                              h('td', null, h('code', null, item.id)),
                              h(
                                'td',
                                null,
                                item.module ? h('div', { style: { fontWeight: 550 } }, item.module) : null,
                                h('div', { className: 'pt', style: { fontSize: 11.5, lineHeight: 1.55 } }, item.point),
                              ),
                              h(
                                'td',
                                null,
                                on
                                  ? h(
                                      'span',
                                      { className: 'giw-status', style: { color: VERDICT_COLOR[record.verdict] } },
                                      h('i', { className: 'giw-dot', style: { background: VERDICT_COLOR[record.verdict] } }),
                                      VERDICT_LABEL[record.verdict],
                                    )
                                  : h('span', { className: 'giw-status' }, h('i', { className: 'giw-dot' }), item.required === '必考' ? '必考' : '选考'),
                              ),
                              h('td', { className: 'giw-small' }, fmtClock(item.seconds)),
                            );
                          }),
                        ),
                      ),
                    ),
                h('div', { className: 'giw-note' }, '点任意一行 = 切到该题并重新计时。状态由面板/老师记录，不自动判断对错。'),
              ),
            ),
            h(
              'div',
              { className: 'giw-col' },
              h(
                Card,
                { title: '覆盖进度' },
                h(
                  'div',
                  { className: 'giw-metrics' },
                  h('span', { className: 'giw-big' }, askedCount, h('span', null, `/${totalCount}`)),
                  h('span', { className: 'giw-small' }, `覆盖 ${pct(askedCount, totalCount)}% · 得分 ${stats === null ? 0 : stats.score}`),
                ),
                h('div', { className: 'giw-bar' }, h('i', { style: { width: `${pct(askedCount, totalCount)}%` } })),
                h(
                  'div',
                  { className: 'giw-grow' },
                  (stats && Array.isArray(stats.groups) ? stats.groups : []).map((group) =>
                    h(
                      'div',
                      { className: 'giw-grow-row', key: group.group },
                      h('span', null, group.label),
                      h('div', { className: 'giw-mini' }, h('i', { style: { width: `${pct(group.total - group.unattempted, group.total)}%` } })),
                      h('span', null, `${group.total - group.unattempted}/${group.total}`),
                    ),
                  ),
                ),
                h('div', { className: 'giw-note' }, `已考用时 ${fmtTime(stats === null ? 0 : stats.totalSeconds)} · 通过 ${stats === null ? 0 : stats.passed} · 待加强 ${stats === null ? 0 : stats.weak} · 跳过 ${stats === null ? 0 : stats.skipped}`),
              ),
              h(
                Card,
                { title: '面试模式', hint: '决定「下一题」的范围' },
                h(
                  'div',
                  { className: 'giw-modes' },
                  (modes.length > 0 ? modes : [{ id: 'all', label: '全部考核点' }]).map((mode) =>
                    h('button', { key: mode.id, className: 'giw-mode' + (state && state.mode === mode.id ? ' on' : ''), disabled: busy, onClick: () => setMode(mode.id) }, mode.label),
                  ),
                ),
              ),
              h(
                Card,
                { title: '面试命令', hint: '复制后发到会话' },
                h(
                  'div',
                  { className: 'giw-cmds' },
                  commands.map(([command, note]) => h('button', { key: command, className: 'giw-cmd', onClick: copyCommand(command) }, h('b', null, command), h('em', null, note || ''))),
                ),
                h('div', { className: 'giw-note' }, '命令在会话里由当前老师的 skill 执行；「定制面试老师」会启动向导生成新 profile。'),
              ),
              scanEnabled
                ? h(
                    Card,
                    { title: '工程扫描', hint: scan === null ? '未扫描' : `${scan.itemCount} 条证据` },
                    scan === null
                      ? h('div', { className: 'giw-empty' }, '点顶部「扫描工程」，按当前老师 profile 里配置的规则提取证据（正则规则可在 teacher.json 的 scan.rules 里自定义）。')
                      : h(
                          'div',
                          null,
                          h('div', { className: 'giw-note', style: { marginTop: 0 } }, '目录：', h('code', null, scan.workspace), ` · 源文件 ${scan.fileCount} · 证据 ${scan.itemCount}`),
                          scan.materials && scan.materials.length > 0
                            ? h('div', { className: 'giw-note' }, '材料：', scan.materials.map((material) => `${material.kind}「${material.name}」`).join(' · '))
                            : null,
                          h(
                            'div',
                            { className: 'giw-scanmod' },
                            (scan.modules || []).slice(0, 14).map((module) =>
                              h(
                                'div',
                                { key: module.module },
                                h('b', null, `${module.point ? `${module.point} ` : ''}${module.module}`),
                                module.items.slice(0, 3).map((item, index) => h('code', { key: index }, `${item.file}:${item.line}  ${item.code}`)),
                              ),
                            ),
                          ),
                        ),
                  )
                : null,
              h(
                Card,
                { title: '复盘', hint: report === null ? '未生成' : report.reportPath ? '已落盘' : '仅预览' },
                report === null
                  ? h('div', { className: 'giw-empty' }, '点「预览复盘」看 100 分制评分、分项、覆盖矩阵与风险点；点「结束面试并落盘」写到工程目录的面试记录文件夹。')
                  : h(
                      'div',
                      null,
                      report.reportPath ? h('div', { className: 'giw-note', style: { marginTop: 0 } }, '已保存：', h('code', null, report.reportPath)) : null,
                      h('pre', { className: 'giw-pre' }, report.report),
                      h(
                        'div',
                        { className: 'giw-actions' },
                        h('button', { className: 'giw-btn', onClick: () => copyText(report.report).then(() => showToast('复盘已复制')) }, '复制复盘'),
                        h('button', { className: 'giw-btn ghost', onClick: () => setReport(null) }, '收起'),
                      ),
                    ),
              ),
            ),
          ),
          h('div', { className: 'giw-note', style: { marginTop: 14, textAlign: 'center' } }, '状态：', h('code', null, paths.state || '—'), ' · profile：', h('code', null, paths.dir || '—'), ' · 面试对话在会话里进行'),
          toast !== '' ? h('div', { className: 'giw-toast' }, toast) : null,
        ),
      );
    }

    /* -------------------------------------------------------------- */
    /* 注册                                                            */
    /* -------------------------------------------------------------- */

    const inject = ['slots'];

    function apply(ctx) {
      ctx.effect(() => {
        if (typeof document === 'undefined') return;
        const tag = document.createElement('style');
        tag.dataset.plugin = 'dsh-generic-interview-teacher';
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => {
          tag.remove();
        };
      }, 'interview-coach: styles');

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 4,
            label: '面试教练',
          },
          CoachIcon,
        ),
      );

      ctx.slots.inject('main', function* () {
        yield ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
          },
          InterviewCoachPage,
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
