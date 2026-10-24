import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { DraftController } from '../client/draft';
import { ClientError, createClient } from '../client/transport';
import { MAX_DRAFT_LENGTH, SYNTHETIC_PROBLEMS, type Session, type Snapshot, type WriteCommand } from '../shared/protocol';
import './style.css';

const logger = console;
const client = createClient(chrome.runtime.id, (command) => chrome.runtime.sendMessage(command));
const isPanel = location.pathname === '/sidepanel.html';
const errors: Record<string, string> = {
  REVISION_CONFLICT: '另一窗口已经保存了新内容。你的输入仍在这里；请先导出，再读取已保存版本。',
  OUTCOME_UNKNOWN: '连接中断，暂时无法确认是否已保存。保留此页面，点击重试核实结果。',
  STORAGE_FULL: '本地空间不足，尚未保存。请先导出草稿，释放空间后重试。',
  STORAGE_DENIED: '浏览器拒绝访问本地存储。请检查扩展或隐私模式设置。',
  STORAGE_FAILED: '本地保存失败。输入仍在此页，可以导出后重试。',
  PROTOCOL_MISMATCH: '页面和后台版本不一致，请重新打开扩展。',
  INSTANCE_MISMATCH: '这份请求属于另一扩展。不同扩展 ID 的数据空间不相通。',
  INVALID_STATE: '练习状态已改变，请读取已保存版本。',
  FORBIDDEN: '此页面没有操作权限，请从扩展工作台进入。',
  INVALID_RESPONSE: '后台返回内容不符合协议，请重新连接。',
};
const messageFor = (error: unknown) => error instanceof ClientError ? errors[error.code] ?? `操作未完成（${error.code}）。` : '连接失败，请保留输入并重试。';
const formatTime = (timestamp: number) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp);

function downloadDraft(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'algorhythm-draft.txt'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function Editor({ session, busy, register, onAction, reload }: {
  session: Session; busy: boolean; register: (controller: DraftController | null) => void;
  onAction: (type: 'recordAttempt' | 'pause' | 'resume') => void; reload: () => void;
}) {
  const [controller] = useState(() => new DraftController(session, client.envelope, client.write));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [copyNotice, setCopyNotice] = useState('');
  useEffect(() => { register(controller); return () => { controller.dispose(); register(null); }; }, [controller, register]);
  const paused = state.session.status === 'paused';
  return <section className="editor" aria-labelledby="draft-label">
    <div className="section-heading"><label id="draft-label" htmlFor="draft">你的思路与代码</label>
      <span className={`save-status ${state.status}`} role="status">{paused ? '已暂停' : { saved: '已保存', dirty: '尚未保存', saving: '正在保存', error: '尚未保存' }[state.status]}</span></div>
    <textarea id="draft" value={state.text} onChange={(event) => controller.edit(event.target.value)} disabled={paused || busy}
      maxLength={MAX_DRAFT_LENGTH} spellCheck={false} placeholder="可以先用一句话说说怎么做。暂时没有思路，也可以记下你尝试过什么。" aria-describedby="draft-help" />
    <p id="draft-help" className="muted hint">{paused ? '停在这里也没关系。继续练习后可以接着写。' : '停笔后自动保存。关闭前，请确认当前输入显示“已保存”。'}</p>
    {state.error && <div className="error-box" role="alert"><p>{messageFor(new ClientError(state.error))}</p><div className="button-row">
      <button disabled={busy} onClick={() => { void controller.retry().catch(() => undefined); }}>重试保存</button>
      <button disabled={busy} onClick={reload}>放弃本地修改，读取已保存版本</button>
    </div></div>}
    <div className="button-row">
      <button className="primary" disabled={busy || paused || !state.text.trim() || !!state.error} onClick={() => onAction('recordAttempt')}>记录这次尝试</button>
      <button disabled={busy || !!state.error} onClick={() => onAction(paused ? 'resume' : 'pause')}>{paused ? '继续练习' : '暂停练习'}</button>
      <button className="quiet" onClick={() => downloadDraft(state.text)}>导出草稿</button>
      <button className="quiet" onClick={() => { void navigator.clipboard.writeText(state.text).then(() => setCopyNotice('草稿已复制。'), () => setCopyNotice('复制失败，可使用“导出草稿”。')); }}>复制</button>
    </div>
    <span className="muted hint" role="status">{copyNotice}</span>
  </section>;
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [active, setActive] = useState<Session | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<WriteCommand | null>(null);
  const [windowId, setWindowId] = useState<number>();
  const controller = useRef<DraftController | null>(null);
  const lock = useRef(false);
  // 稳定注册函数避免每次输入重建编辑器。
  const [register] = useState(() => (value: DraftController | null) => { controller.current = value; });

  async function load(selectedId?: string) {
    const next = await client.read(); setSnapshot(next);
    const selected = next.sessions.find((item) => item.id === selectedId) ?? next.sessions[0] ?? null;
    setActive(selected); setEpoch((value) => value + 1);
    return next;
  }
  async function guarded(task: () => Promise<void>) {
    if (lock.current) return;
    /*
     * ========================================================================
     * 步骤1：串行处理界面动作
     * ========================================================================
     * 数据源：用户点击、当前编辑器和持久化回执。
     * 操作：1) 锁定切换并等待草稿确认。2) 失败保留当前编辑器与原动作。
     */
    logger.info('开始处理界面动作');
    // 1.1 同步互斥阻止快速重复点击，文本不进入日志。
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await task(); } catch (failure) { setError(messageFor(failure)); }
    finally { lock.current = false; setBusy(false); logger.info('界面动作结束'); }
  }
  useEffect(() => {
    void guarded(async () => { setWindowId((await chrome.windows.getCurrent()).id); await load(location.hash.slice(1)); });
  }, []);

  async function mutate(command: WriteCommand, recovering = false) {
    setPending(command);
    try {
      const result = await client.write(command, recovering);
      setPending(null);
      // 1.2 回执属于此命令；写入期间禁用选择，随后从数据库重新读取。
      setActive(result.session); setEpoch((value) => value + 1);
      await load(result.session.id);
      setNotice(command.type === 'recordAttempt' ? '这次尝试已记录。尚未判题，也没有判定掌握。' : '记录已保存。');
    } catch (failure) {
      if (failure instanceof ClientError && !['OUTCOME_UNKNOWN', 'STORAGE_FULL', 'STORAGE_FAILED', 'STORAGE_DENIED'].includes(failure.code)) setPending(null);
      throw failure;
    }
  }
  function start(problemKey: Session['problemKey']) {
    void guarded(async () => {
      await controller.current?.flush();
      await mutate({ ...client.envelope(), type: 'start', sessionId: crypto.randomUUID(), problemSnapshotId: crypto.randomUUID(), problemKey });
    });
  }
  function select(id: string) {
    void guarded(async () => { await controller.current?.flush(); await load(id); });
  }
  function action(type: 'recordAttempt' | 'pause' | 'resume') {
    void guarded(async () => {
      await controller.current?.flush();
      const session = controller.current?.getSnapshot().session;
      if (!session) return;
      await mutate({ ...client.envelope(), type, sessionId: session.id, problemSnapshotId: session.problemSnapshotId, expectedRevision: session.revision });
    });
  }
  const disabled = busy || pending !== null;
  const problem = snapshot?.problems.find((item) => item.id === active?.problemSnapshotId);
  const attempts = snapshot?.events.filter((item) => item.sessionId === active?.id && item.kind === 'attempt').sort((a, b) => b.revision - a.revision) ?? [];
  return <div className={isPanel ? 'app panel' : 'app'}>
    <header><a className="brand" href={chrome.runtime.getURL('workspace.html')} target="_blank" rel="noreferrer">AlgoRhythm<span>练习记录</span></a>
      {!isPanel && <button disabled={windowId === undefined} onClick={() => {
        // sidePanel.open 必须直接处于用户手势中，不先等待异步读写。
        if (windowId !== undefined) void chrome.sidePanel.open({ windowId }).catch(() => setError('侧栏未能打开。可从浏览器侧栏菜单选择 AlgoRhythm。'));
      }}>打开练习侧栏</button>}
    </header>
    <p className="prototype">存储验证原型 · 仅含两道合成练习，暂未接入力扣或 AI 教练。</p>
    {error && <div className="error-box" role="alert"><p>{error}</p>{pending && <button disabled={busy} onClick={() => { void guarded(() => mutate(pending, true)); }}>恢复上次操作</button>}
      {!snapshot && <button disabled={busy} onClick={() => { void guarded(async () => { await load(); }); }}>重新连接</button>}</div>}
    <p className="notice" role="status">{notice}</p>
    <div className="workspace">
      <aside aria-label="练习导航"><details className="nav-disclosure" open={!isPanel || !active}><summary hidden={!isPanel}>练习与切换</summary><div className="section-heading"><h2>练习</h2><button className="quiet" disabled={disabled} onClick={() => { void guarded(async () => { await controller.current?.flush(); await load(active?.id); }); }}>更新记录</button></div>
        {snapshot?.sessions.length ? <ul className="sessions">{snapshot.sessions.map((session) => <li key={session.id}><button disabled={disabled} aria-current={active?.id === session.id ? 'true' : undefined} onClick={() => select(session.id)}>
          <span>{SYNTHETIC_PROBLEMS[session.problemKey].title}</span><small>{session.status === 'paused' ? '已暂停' : '练习中'} · {formatTime(session.createdAt)}</small>
        </button></li>)}</ul> : <p className="muted">{snapshot ? '还没有练习记录。' : '正在读取本地记录…'}</p>}
        <div className="new-session"><h3>开始合成练习</h3>{Object.values(SYNTHETIC_PROBLEMS).map((item) => <button disabled={disabled || !snapshot} key={item.key} onClick={() => start(item.key)}>{item.title}<span aria-hidden="true">＋</span></button>)}</div>
      </details></aside>
      <main>{active && problem ? <>
        <section className="problem"><h1>{problem.title}</h1><p className="statement">{problem.statement}</p><p className="muted hint">原创合成题 · Python · 无自动判题</p></section>
        <Editor key={`${active.id}:${epoch}`} session={active} busy={disabled} register={register} onAction={action}
          reload={() => { void guarded(async () => { await load(active.id); }); }} />
        <section className="history"><h2>这次练习留下的尝试</h2>{attempts.length ? <ol>{attempts.map((attempt) => <li key={attempt.id}><time dateTime={new Date(attempt.at).toISOString()}>{formatTime(attempt.at)}</time><pre>{attempt.text}</pre></li>)}</ol> : <p className="muted">草稿会自动保存。点击“记录这次尝试”，才会在这里留下当时的思路或代码。</p>}</section>
      </> : <section className="empty"><h1>先留下你的思路。</h1><p>选择一道合成练习，写几行想法，再从侧栏接着写。</p><p className="muted">工作台关掉后，侧栏仍能保存。重新打开时，可以继续上次练习。</p></section>}</main>
    </div>
    <footer><details><summary>本地数据说明</summary><p>记录仅属于当前浏览器配置与扩展 ID。更换 ID、浏览器配置或卸载扩展不会自动迁移。原型尚无完整备份；“导出草稿”只保存当前文本。</p><code>扩展 ID：{chrome.runtime.id}</code></details></footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
