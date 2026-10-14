import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  Download,
  ExternalLink,
  FileCode2,
  Github,
  History,
  Home,
  LayoutGrid,
  ListChecks,
  LoaderCircle,
  LogOut,
  Maximize2,
  Menu,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Send,
  Smartphone,
  Sparkles,
  Square,
  WandSparkles,
  X,
  Zap,
  BookOpen,
  Timer,
  CheckCircle2,
  AlertCircle,
  Cpu,
} from 'lucide-react';
import { zipSync, strToU8 } from 'fflate';
import type {
  Mode,
  Project,
  ProjectDetail,
  PublicConfig,
  Snapshot,
  ModelSettings,
} from '@atoms/shared';
import { ACTIVE_STATUSES } from '@atoms/shared';
import {
  auth,
  getConfig,
  request,
  listProjects,
  detail,
  snapshot,
  listen,
  ApiError,
} from './client';
import { demos, demoDetail, demoProjects, demoSnapshot } from './demo';
import { ModelSettingsDialog } from './ModelSettingsDialog';
const repo = 'https://github.com/SimonL777/atoms-workbench';
const tabs = [
  { id: 'preview', label: '预览', icon: Monitor },
  { id: 'spec', label: '需求', icon: ListChecks },
  { id: 'code', label: '代码', icon: Code2 },
  { id: 'versions', label: '版本', icon: History },
] as const;
type Tab = (typeof tabs)[number]['id'];
function Markdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      {content
        .split('\n')
        .map((line, i) =>
          line.startsWith('# ') ? (
            <h2 key={i}>{line.slice(2)}</h2>
          ) : line.startsWith('## ') ? (
            <h3 key={i}>{line.slice(3)}</h3>
          ) : line.startsWith('### ') ? (
            <h4 key={i}>{line.slice(4)}</h4>
          ) : (
            <p key={i}>{line || '\u00a0'}</p>
          ),
        )}
    </div>
  );
}
function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`logo ${small ? 'small' : ''}`}>
      <span className="logo-symbol">
        a<span>✳</span>
      </span>
      {!small && (
        <span>
          atoms<span className="logo-sub">workbench</span>
        </span>
      )}
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState<PublicConfig>();
  const [session, setSession] = useState<Session | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [current, setCurrent] = useState<ProjectDetail>();
  const [view, setView] = useState<Snapshot>();
  const [version, setVersion] = useState<string>();
  const [tab, setTab] = useState<Tab>('preview');
  const [mode, setMode] = useState<Mode>('brainstorm');
  const [input, setInput] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [notice, setNotice] = useState('');
  const [mobile, setMobile] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [activity, setActivity] = useState(false);
  const [codeFile, setCodeFile] = useState('');
  const [account, setAccount] = useState(false);
  const [modelDialog, setModelDialog] = useState(false);
  const [userModel, setUserModel] = useState<{ userId: string; settings: ModelSettings }>();
  const frame = useRef<HTMLIFrameElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const selectedProject = useRef<string | undefined>(undefined);
  const loadGeneration = useRef(0);
  const requestKey = useRef({ key: '', id: '' });
  const isDemo = current?.project.owner_id === 'demo';
  const active = current?.runs.find((r) => ACTIVE_STATUSES.includes(r.status));
  const pending = active?.status === 'waiting_for_user' ? active.question : null;
  const latestSpec = current?.specs[0];
  const currentId = current?.project.id;
  const tokenId = (key: string) => {
    if (requestKey.current.key !== key) requestKey.current = { key, id: crypto.randomUUID() };
    return requestKey.current.id;
  };
  useEffect(() => {
    let cleanup = () => {};
    void getConfig()
      .then(async (value) => {
        setConfig(value);
        if (auth) {
          const { data } = await auth.auth.getSession();
          setSession(data.session);
          const { data: subscription } = auth.auth.onAuthStateChange((event, next) => {
            setSession(next);
            if (event === 'PASSWORD_RECOVERY') {
              setRecovery(true);
              setLogin(true);
            }
          });
          cleanup = () => subscription.subscription.unsubscribe();
        }
      })
      .catch((error) => setNotice(error.message));
    return () => cleanup();
  }, []);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 6500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    let cancelled = false;
    if (session && config?.configured)
      void listProjects()
        .then((value) => {
          if (!cancelled) setProjects(value);
        })
        .catch((error) => {
          if (!cancelled) setNotice(error.message);
        });
    else setProjects([]);
    return () => {
      cancelled = true;
    };
  }, [session?.user.id, config?.configured]);
  useEffect(() => {
    let cancelled = false;
    setUserModel(undefined);
    setModelDialog(false);
    setAccount(false);
    selectedProject.current = undefined;
    setCurrent(undefined);
    setView(undefined);
    setVersion(undefined);
    if (session && config?.configured) {
      const userId = session.user.id;
      void request<ModelSettings>('/model-config')
        .then((settings) => {
          if (cancelled) return;
          setUserModel({ userId, settings });
          if (!settings.configured) setModelDialog(true);
        })
        .catch((error) => {
          if (!cancelled) setNotice((error as Error).message);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [session?.user.id, config?.configured]);
  const load = useCallback(async (id: string, select = false) => {
    if (select) selectedProject.current = id;
    if (selectedProject.current !== id) return;
    const generation = ++loadGeneration.current;
    const next = id.startsWith('demo-') ? demoDetail(id) : await detail(id);
    if (selectedProject.current === id && loadGeneration.current === generation)
      setCurrent(next);
  }, []);
  useEffect(() => {
    setVersion(current?.project.current_version_id || undefined);
  }, [currentId, current?.project.current_version_id]);
  const open = async (id: string) => {
    try {
      setBusy(true);
      setTab('preview');
      if (currentId !== id) setView(undefined);
      setReply('');
      await load(id, true);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!currentId || isDemo) return;
    const controller = new AbortController();
    let inFlight = false;
    const refresh = () => {
      if (inFlight) return;
      inFlight = true;
      void load(currentId)
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    };
    void listen(currentId, refresh, controller.signal);
    const timer = setInterval(refresh, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [currentId, isDemo, load]);
  useEffect(() => {
    if (!currentId || !version) {
      setView(undefined);
      return;
    }
    let cancelled = false;
    void (isDemo ? Promise.resolve(demoSnapshot(currentId)) : snapshot(currentId, version))
      .then((value) => {
        if (!cancelled && selectedProject.current === currentId) {
          setView(value);
          setCodeFile(Object.keys(value.files)[0]);
        }
      })
      .catch((error) => setNotice(error.message));
    return () => {
      cancelled = true;
    };
  }, [currentId, version, isDemo]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [current?.messages.length, active?.status]);
  useEffect(() => {
    if (!currentId) return;
    const bridge = async (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'atom:records')
        return;
      const { id, operation, collection, record_id, data } = event.data;
      if (
        typeof id !== 'string' ||
        !['list', 'put', 'delete'].includes(operation) ||
        typeof collection !== 'string' ||
        !/^[-\w]{1,48}$/.test(collection)
      )
        return;
      try {
        let result: unknown;
        if (isDemo) {
          const key = `atoms-demo:${currentId}:${collection}`;
          const records: Record<string, Record<string, unknown>> = JSON.parse(
            localStorage.getItem(key) || '{}',
          );
          if (operation === 'put') {
            if (typeof record_id !== 'string' || !data || JSON.stringify(data).length > 20000)
              throw new Error('记录无效');
            records[record_id] = data;
          }
          if (operation === 'delete') delete records[record_id];
          if (operation !== 'list') localStorage.setItem(key, JSON.stringify(records));
          result = Object.entries(records).map(([record_id, data]) => ({ record_id, data }));
        } else
          result = await request(`/projects/${currentId}/records`, {
            operation,
            collection,
            record_id,
            data,
          });
        if (event.source === frame.current?.contentWindow)
          frame.current?.contentWindow?.postMessage({ type: 'atom:result', id, result }, '*');
      } catch (error) {
        if (event.source === frame.current?.contentWindow)
          frame.current?.contentWindow?.postMessage(
            { type: 'atom:result', id, error: (error as Error).message },
            '*',
          );
      }
    };
    window.addEventListener('message', bridge);
    return () => window.removeEventListener('message', bridge);
  }, [currentId, isDemo]);
  const execute = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      requestKey.current = { key: '', id: '' };
      if (currentId && !isDemo) await load(currentId);
    } catch (error) {
      if (error instanceof ApiError && error.status === 428) {
        setUserModel(undefined);
        setModelDialog(true);
      }
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const ready = () => {
    if (!session) {
      setLogin(true);
      return false;
    }
    if (!config?.configured) {
      setNotice('真实开发需要连接 Supabase 和后台 Worker。你可以先体验示例项目。');
      return false;
    }
    if (userModel?.userId !== session.user.id || !userModel.settings.configured) {
      setModelDialog(true);
      return false;
    }
    return true;
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim() || !ready()) return;
    await execute(async () => {
      const project = await request<Project>('/projects', {
        input,
        mode,
        request_id: tokenId(`create:${mode}:${input}`),
      });
      await load(project.id, true);
      setInput('');
      setTab(mode === 'brainstorm' ? 'spec' : 'preview');
      setProjects(await listProjects());
    });
  };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!reply.trim()) return;
    if (isDemo) {
      setNotice('当前是预先准备的示例。登录并连接后台后，可以使用真实 Agent 修改项目。');
      return;
    }
    if (!ready()) return;
    await execute(async () => {
      if (pending && active)
        await request(`/runs/${active.id}/answer`, { answer: reply, question_id: pending.id });
      else
        await request(`/projects/${currentId}/messages`, {
          input: reply,
          request_id: tokenId(`message:${currentId}:${reply}`),
        });
      setReply('');
    });
  };
  const answer = (value: string) => {
    if (active && pending && ready())
      void execute(() =>
        request(`/runs/${active.id}/answer`, { answer: value, question_id: pending.id }),
      );
  };
  const home = () => {
    selectedProject.current = undefined;
    loadGeneration.current++;
    setCurrent(undefined);
    setView(undefined);
    setVersion(undefined);
    setReply('');
  };
  const download = () => {
    if (!view) return;
    const bytes = zipSync(
      Object.fromEntries(
        Object.entries(view.files).map(([path, content]) => [path, strToU8(content)]),
      ),
    );
    const blob = new Blob([bytes as BlobPart], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${current!.project.name.replace(/[^\w\u4e00-\u9fa5-]/g, '-')}-source.zip`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const shownProjects = session && config?.configured ? projects : demoProjects;
  return (
    <div className={`app ${sidebar ? '' : 'sidebar-hidden'}`}>
      <aside className="sidebar">
        <button className="brand-button" onClick={home} aria-label="返回首页">
          <Logo />
        </button>
        <button className="new-project" onClick={home}>
          <Plus size={17} />
          新建项目<span>⌘ K</span>
        </button>
        <nav>
          <button className={!current ? 'selected' : ''} onClick={home}>
            <Home size={17} />
            工作空间
          </button>
          <button
            onClick={() => {
              home();
              document.querySelector('#examples')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            <LayoutGrid size={17} />
            灵感与示例
            <ArrowUpRight size={14} />
          </button>
        </nav>
        <div className="sidebar-section">
          <span>{session && config?.configured ? '我的项目' : '体验项目'}</span>
          <button onClick={home} aria-label="新建项目">
            <Plus size={15} />
          </button>
        </div>
        <div className="project-list">
          {shownProjects.map((p) => (
            <button
              key={p.id}
              className={currentId === p.id ? 'selected' : ''}
              onClick={() => void open(p.id)}
            >
              <MessageSquare size={15} />
              <span>{p.name}</span>
              {currentId === p.id && <span className="project-dot" />}
            </button>
          ))}
          {session && config?.configured && !projects.length && (
            <p className="empty-projects">
              你的第一个想法
              <br />
              会从这里开始。
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          {session && (
            <button className="model-settings-entry" onClick={() => setModelDialog(true)}>
              <Cpu size={16} />
              <span>
                模型配置
                <small>
                  {userModel?.settings.configured
                    ? userModel.settings.modelName
                    : '配置后开始开发'}
                </small>
              </span>
              <span
                className={userModel?.settings.configured ? 'online-dot' : 'offline-dot'}
              />
            </button>
          )}
          <a href={repo} target="_blank" rel="noreferrer">
            <Github size={16} />
            GitHub 开源项目
            <ArrowUpRight size={14} />
          </a>
          <div className="cloud-state">
            <span className={config?.configured ? 'online-dot' : 'offline-dot'} />
            {config?.configured
              ? '项目数据已连接'
              : auth
                ? '账户已连接 · 示例可用'
                : '云端待连接 · 示例可用'}
          </div>
          <button
            className="profile"
            onClick={() => (session ? setAccount(!account) : setLogin(true))}
          >
            <span className="avatar">{session?.user.email?.[0]?.toUpperCase() || '访'}</span>
            <span>
              <b>
                {session?.user.user_metadata.display_name ||
                  session?.user.email?.split('@')[0] ||
                  '访客工作空间'}
              </b>
              <small>{session ? '个人账户' : '登录以保存你的项目'}</small>
            </span>
            <ChevronDown size={14} />
          </button>
          {account && (
            <div className="account-popover">
              <p>{session?.user.email}</p>
              <button
                onClick={() => {
                  setAccount(false);
                  setModelDialog(true);
                }}
              >
                <Cpu size={15} />
                模型配置
              </button>
              <button
                onClick={() =>
                  void execute(async () => {
                    await auth?.auth.signOut();
                    setAccount(false);
                    home();
                  })
                }
              >
                <LogOut size={15} />
                退出登录
              </button>
            </div>
          )}
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="icon-button"
              onClick={() => setSidebar(!sidebar)}
              aria-label="切换侧边栏"
            >
              <PanelLeftClose size={18} />
            </button>
            <span className="breadcrumb">工作空间</span>
            {current && (
              <>
                <ChevronRight size={14} />
                <strong>{current.project.name}</strong>
              </>
            )}
          </div>
          <div>
            {current && isDemo && <span className="demo-badge">示例模式</span>}
            <a className="github-link" href={repo} target="_blank" rel="noreferrer">
              <Github size={15} />
              <span>Star on GitHub</span>
            </a>
            {!session && (
              <button className="login-button" onClick={() => setLogin(true)}>
                登录 / 注册
                <ArrowUpRight size={13} />
              </button>
            )}
          </div>
        </header>
        {!current ? (
          <div className="home-page">
            <div className="home-eyebrow">
              <span className="online-dot" /> YOUR NEXT IDEA STARTS HERE
            </div>
            <h1>
              让想法，有个<span>可以运行的样子。</span>
            </h1>
            <p className="home-subtitle">和 AI 一起明确需求、构建应用，再把它变得更好。</p>
            <form className="prompt-box" onSubmit={create}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="想做一个什么样的应用？从一句话开始…"
                aria-label="项目需求"
                maxLength={12000}
              />
              <div className="prompt-footer">
                <div className="mode-switch">
                  <button
                    type="button"
                    className={mode === 'brainstorm' ? 'active' : ''}
                    onClick={() => setMode('brainstorm')}
                  >
                    <Sparkles size={15} />
                    需求共创
                  </button>
                  <button
                    type="button"
                    className={mode === 'build' ? 'active' : ''}
                    onClick={() => setMode('build')}
                  >
                    <Zap size={15} />
                    直接开发
                  </button>
                </div>
                <button
                  className="submit-prompt"
                  disabled={busy || !input.trim()}
                  aria-label="开始创建项目"
                >
                  {busy ? <LoaderCircle className="spin" size={19} /> : <ArrowUp size={20} />}
                </button>
              </div>
            </form>
            <div className="prompt-hint">
              <CircleHelp size={13} />
              {mode === 'brainstorm'
                ? '想法还不清晰？AI 会一次问一个关键问题，陪你理清。'
                : '需求已经明确？直接进入开发，尽快看到第一版。'}
            </div>
            <div className="suggestions">
              {['个人任务管理', '阅读收藏空间', '轻量专注计时'].map((text, i) => (
                <button key={text} onClick={() => setInput(demos[i].prompt)}>
                  {i === 0 ? (
                    <ListChecks size={13} />
                  ) : i === 1 ? (
                    <BookOpen size={13} />
                  ) : (
                    <Timer size={13} />
                  )}{' '}
                  {text}
                  <Plus size={12} />
                </button>
              ))}
            </div>
            <section className="examples" id="examples">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">A LITTLE INSPIRATION</span>
                  <h2>从一个小作品开始</h2>
                </div>
                <span>
                  预先准备的可交互示例 <ArrowUpRight size={14} />
                </span>
              </div>
              <div className="example-grid">
                {demos.map((item, i) => (
                  <button
                    className="example-card"
                    key={item.id}
                    onClick={() => void open(item.id)}
                  >
                    <div className={`example-art ${item.color}`}>
                      {i === 0 ? (
                        <div className="mini-task">
                          <div className="mini-brand">
                            ✳ Task Garden <span>⌘</span>
                          </div>
                          <h3>
                            A little progress,
                            <br />
                            every day.
                          </h3>
                          <div className="mini-stats">
                            <span>
                              8<small>Tasks</small>
                            </span>
                            <span>
                              5<small>Done</small>
                            </span>
                            <span>
                              62%<small>Progress</small>
                            </span>
                          </div>
                          <div className="mini-row">
                            <i />
                            Make room for a good idea<span>Today</span>
                          </div>
                          <div className="mini-row done">
                            <i>✓</i>Take a small first step
                          </div>
                        </div>
                      ) : i === 1 ? (
                        <div className="mini-reading">
                          <span>◉ orbit</span>
                          <h3>
                            Ideas worth
                            <br />
                            keeping.
                          </h3>
                          <div className="book-covers">
                            <div>
                              THE
                              <br />
                              CREATIVE
                              <br />
                              <b>ACT</b>
                            </div>
                            <div>
                              A<br />
                              GOOD
                              <br />
                              <b>IDEA.</b>
                            </div>
                            <div>
                              BUILD
                              <br />
                              WITH
                              <br />
                              <b>AI</b>
                            </div>
                          </div>
                          <small>YOUR PERSONAL LIBRARY →</small>
                        </div>
                      ) : (
                        <div className="mini-focus">
                          <span>still.</span>
                          <div className="focus-ring">
                            <span>
                              25:00<small>ONE THING AT A TIME</small>
                            </span>
                          </div>
                          <div className="mini-focus-button">Begin a little focus →</div>
                        </div>
                      )}
                    </div>
                    <div className="example-info">
                      <div>
                        <h3>{item.name}</h3>
                        <p>{item.description}</p>
                      </div>
                      <ArrowUpRight size={19} />
                    </div>
                    <div className="example-tags">
                      <span>{item.category}</span>
                      <span>可交互示例</span>
                    </div>
                  </button>
                ))}
              </div>
            </section>
            <footer className="home-footer">
              <span>
                <span className="footer-star">✳</span> 小步开始，持续迭代。
              </span>
              <span>Open source. Yours to build.</span>
            </footer>
          </div>
        ) : (
          <div className="workbench">
            <section className="chat-panel">
              <div className="chat-header">
                <div>
                  <Sparkles size={17} />
                  <strong>一起构建</strong>
                </div>
                <span className="agent-status">
                  <span className={active ? 'online-dot' : 'idle-dot'} />
                  {active ? '正在协作' : '准备就绪'}
                </span>
              </div>
              <div className="chat-messages">
                <div className="project-intro">
                  <span className="intro-icon">
                    <WandSparkles size={21} />
                  </span>
                  <h2>{current.project.name}</h2>
                  <p>{current.project.description}</p>
                </div>
                {current.messages.map((message) => (
                  <div key={message.id} className={`message ${message.role}`}>
                    <div className="message-label">
                      {message.role === 'user' ? (
                        '你'
                      ) : (
                        <>
                          <span className="tiny-logo">✳</span>Atoms Agent
                        </>
                      )}
                    </div>
                    <div className={`message-body ${message.kind}`}>
                      <Markdown content={message.content} />
                      {message.kind === 'version' && (
                        <button
                          className="version-chip"
                          onClick={() => {
                            setTab('preview');
                            setVersion(message.metadata.version_id as string);
                          }}
                        >
                          <CheckCircle2 size={14} />
                          {isDemo ? '查看示例' : '查看这个版本'}
                          <ArrowUpRight size={13} />
                        </button>
                      )}
                      {message.kind === 'spec' && (
                        <button className="inline-action" onClick={() => setTab('spec')}>
                          <ListChecks size={14} />
                          查看需求简报
                          <ArrowUpRight size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {active && (
                  <div className="run-card">
                    <div>
                      <LoaderCircle
                        size={15}
                        className={active.status === 'running' ? 'spin' : ''}
                      />
                      <span>{active.phase}</span>
                      <button
                        className="icon-button"
                        onClick={() => setActivity(!activity)}
                        aria-label="展开执行记录"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>
                    {activity && (
                      <ol>
                        {current.events
                          .filter((e) => e.run_id === active.id)
                          .map((event) => (
                            <li key={event.id}>
                              <Check size={12} />
                              {event.summary}
                            </li>
                          ))}
                      </ol>
                    )}
                  </div>
                )}
                {pending && (
                  <div className="question-card">
                    <span>
                      <CircleHelp size={15} />
                      一个关键问题
                    </span>
                    <h3>{pending.text}</h3>
                    {pending.options?.map((option) => (
                      <button key={option} disabled={busy} onClick={() => answer(option)}>
                        {option}
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                    <small>也可以在下方用自己的话回答。</small>
                  </div>
                )}
                {!active &&
                  current.runs[0] &&
                  ['failed', 'interrupted'].includes(current.runs[0].status) && (
                    <div className="failure-card">
                      <AlertCircle size={16} />
                      <p>{current.runs[0].error}</p>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void execute(() =>
                            request(`/runs/${current.runs[0].id}/retry`, {
                              request_id: tokenId(`retry:${current.runs[0].id}`),
                            }),
                          )
                        }
                      >
                        从检查点重试
                      </button>
                    </div>
                  )}
                <div ref={bottom} />
              </div>
              <form className="reply-box" onSubmit={send}>
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={pending ? '说说你的想法…' : '继续描述想调整的地方…'}
                  aria-label="对话输入"
                  maxLength={12000}
                />
                <div>
                  <span>
                    {isDemo
                      ? '示例 · 不会调用模型'
                      : pending
                        ? '回答后继续'
                        : '在现有项目上继续迭代'}
                  </span>
                  {active && (
                    <button
                      type="button"
                      className="stop-button"
                      disabled={busy}
                      onClick={() =>
                        void execute(() => request(`/runs/${active.id}/cancel`, {}))
                      }
                    >
                      <Square size={11} />
                      停止
                    </button>
                  )}
                  <button
                    className="reply-send"
                    disabled={busy || !reply.trim() || (!pending && Boolean(active))}
                    aria-label="发送消息"
                  >
                    {busy ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : (
                      <ArrowUp size={17} />
                    )}
                  </button>
                </div>
              </form>
            </section>
            <section className="project-panel">
              <div className="panel-toolbar">
                <div className="tabs">
                  {tabs.map((item) => (
                    <button
                      key={item.id}
                      className={tab === item.id ? 'active' : ''}
                      onClick={() => setTab(item.id)}
                    >
                      <item.icon size={15} />
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="preview-tools">
                  {tab === 'preview' && (
                    <>
                      <button
                        className={!mobile ? 'active' : ''}
                        onClick={() => setMobile(false)}
                        aria-label="桌面预览"
                      >
                        <Monitor size={16} />
                      </button>
                      <button
                        className={mobile ? 'active' : ''}
                        onClick={() => setMobile(true)}
                        aria-label="手机预览"
                      >
                        <Smartphone size={16} />
                      </button>
                      <i />
                      <button
                        onClick={() => {
                          if (view) setView({ ...view });
                          if (frame.current) {
                            frame.current.srcdoc = view?.html || '';
                          }
                        }}
                        aria-label="刷新预览"
                      >
                        <RefreshCw size={15} />
                      </button>
                    </>
                  )}
                  <button onClick={download} disabled={!view} aria-label="下载源代码">
                    <Download size={16} />
                  </button>
                </div>
              </div>
              {tab === 'preview' ? (
                <div className={`preview-area ${mobile ? 'mobile-preview' : ''}`}>
                  <div className="preview-address">
                    <span className="address-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>
                      {isDemo ? 'example / ' : ''}
                      {current.project.name.toLowerCase().replace(/\s/g, '-')}
                    </span>
                    <span className="address-badge">
                      {isDemo ? '示例' : version ? '已构建' : '等待构建'}
                    </span>
                  </div>
                  {view ? (
                    <iframe
                      key={`${currentId}:${version}`}
                      ref={frame}
                      srcDoc={view.html}
                      title="应用预览"
                      sandbox="allow-scripts allow-forms"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="preview-placeholder">
                      <span className="placeholder-symbol">✳</span>
                      <h2>
                        {active?.kind === 'brainstorm'
                          ? '好作品，从好问题开始。'
                          : active
                            ? '正在把想法变成应用。'
                            : '这里会是你的应用。'}
                      </h2>
                      <p>
                        {active?.kind === 'brainstorm'
                          ? '先一起理清需求，确认后开始开发。'
                          : active
                            ? '你可以在左侧跟进真实的开发进度。'
                            : '完成需求确认后，Agent 会开始构建。'}
                      </p>
                      <div className="placeholder-steps">
                        <span className={latestSpec ? 'complete' : 'current'}>
                          <ListChecks size={15} />
                          明确需求
                        </span>
                        <ChevronRight size={12} />
                        <span>
                          <Code2 size={15} />
                          生成代码
                        </span>
                        <ChevronRight size={12} />
                        <span>
                          <Monitor size={15} />
                          运行预览
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="preview-caption">
                    <span className={isDemo ? 'offline-dot' : 'online-dot'} />
                    {isDemo
                      ? '预先准备的示例，数据保存在本地浏览器'
                      : '隔离预览 · 应用记录通过项目专属接口保存'}
                  </div>
                </div>
              ) : tab === 'spec' ? (
                <div className="spec-panel">
                  {latestSpec ? (
                    <>
                      <div className="spec-heading">
                        <span className="section-kicker">PROJECT BRIEF</span>
                        <span className="pill">
                          {latestSpec.confirmed_at ? '已确认' : '待确认'}
                        </span>
                      </div>
                      <Markdown content={latestSpec.content} />
                      {!latestSpec.confirmed_at && !isDemo && (
                        <button
                          className="primary-button confirm-button"
                          disabled={busy || Boolean(active)}
                          onClick={() =>
                            void execute(() =>
                              request(`/projects/${currentId}/confirm`, {
                                spec_id: latestSpec.id,
                                request_id: tokenId(`confirm:${latestSpec.id}`),
                              }),
                            )
                          }
                        >
                          <Check size={16} />
                          确认需求并开始开发
                          <ArrowUpRight size={16} />
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="tab-empty">
                      <ListChecks size={28} />
                      <h3>需求简报会在这里成形</h3>
                      <p>回答左侧问题，帮助 AI 理解你真正想做的事。</p>
                    </div>
                  )}
                </div>
              ) : tab === 'code' ? (
                <div className="code-panel">
                  {view ? (
                    <>
                      <div className="file-tree">
                        <span>项目文件</span>
                        {Object.keys(view.files).map((path) => (
                          <button
                            key={path}
                            className={codeFile === path ? 'active' : ''}
                            onClick={() => setCodeFile(path)}
                          >
                            <FileCode2 size={14} />
                            {path}
                          </button>
                        ))}
                      </div>
                      <div className="code-content">
                        <div>
                          <Code2 size={14} />
                          {codeFile}
                          <span>只读 · 通过对话修改</span>
                        </div>
                        <pre>{view.files[codeFile]}</pre>
                      </div>
                    </>
                  ) : (
                    <div className="tab-empty">
                      <Code2 size={28} />
                      <h3>构建完成后可以查看源码</h3>
                    </div>
                  )}
                </div>
              ) : (
                <div className="versions-panel">
                  <div className="section-kicker">PROJECT HISTORY</div>
                  <h2>每一次进步，都有迹可循。</h2>
                  <p>查看历史交付，恢复代码版本。业务数据独立保存。</p>
                  {current.versions.map((item, i) => (
                    <div className="version-row" key={item.id}>
                      <span className="version-number">{current.versions.length - i}</span>
                      <div>
                        <h3>{item.summary}</h3>
                        <span>
                          {new Date(item.created_at).toLocaleString('zh-CN')} ·{' '}
                          {isDemo ? '示例产物' : '类型检查与构建通过'}
                        </span>
                      </div>
                      {current.project.current_version_id === item.id ? (
                        <span className="pill">当前版本</span>
                      ) : (
                        <button
                          disabled={busy || Boolean(active)}
                          onClick={() =>
                            void execute(() =>
                              request(`/projects/${currentId}/restore`, {
                                version_id: item.id,
                              }),
                            )
                          }
                        >
                          恢复
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setVersion(item.id);
                          setTab('preview');
                        }}
                      >
                        查看
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                  ))}
                  {!current.versions.length && (
                    <div className="tab-empty">
                      <History size={28} />
                      <h3>第一份交付正在路上</h3>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
      {notice && (
        <div role="status" className="toast">
          <AlertCircle size={17} />
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="关闭提示">
            <X size={15} />
          </button>
        </div>
      )}
      {login && (
        <AuthDialog
          configured={Boolean(auth)}
          recovery={recovery}
          onClose={() => {
            setLogin(false);
            setRecovery(false);
          }}
          onMessage={setNotice}
        />
      )}
      {session && modelDialog && !login && (
        <ModelSettingsDialog
          key={session.user.id}
          initial={userModel?.settings}
          onClose={() => setModelDialog(false)}
          onSaved={(settings) => {
            setUserModel({ userId: session.user.id, settings });
            if (settings.configured) setNotice('模型配置已保存，新的任务会使用你的模型。');
          }}
        />
      )}
    </div>
  );
}
function AuthDialog({
  configured,
  recovery,
  onClose,
  onMessage,
}: {
  configured: boolean;
  recovery: boolean;
  onClose: () => void;
  onMessage: (value: string) => void;
}) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'reset'>(
    recovery ? 'reset' : 'login',
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth) return;
    setBusy(true);
    setFeedback('');
    try {
      if (mode === 'login') {
        const { error } = await auth.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setPassword('');
        onClose();
      }
      if (mode === 'signup') {
        const { data, error } = await auth.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: name },
            emailRedirectTo: window.location.href.split('?')[0].split('#')[0],
          },
        });
        if (error) throw error;
        setPassword('');
        if (data.session) onClose();
        else setFeedback('请查看邮箱中的确认邮件。确认后回到这里登录。');
      }
      if (mode === 'forgot') {
        const { error } = await auth.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.href.split('?')[0].split('#')[0],
        });
        if (error) throw error;
        setFeedback('如果该邮箱已注册，我们会发送重置链接。');
      }
      if (mode === 'reset') {
        const { error } = await auth.auth.updateUser({ password });
        if (error) throw error;
        setPassword('');
        onMessage('密码已更新。');
        onClose();
      }
    } catch (error) {
      setFeedback((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="auth-modal" role="dialog" aria-modal="true" aria-label="账户登录">
        <button className="modal-close" onClick={onClose} aria-label="关闭登录">
          <X size={18} />
        </button>
        <Logo />
        <span className="section-kicker">YOUR IDEAS, YOUR WORKSPACE</span>
        <h2>
          {mode === 'signup'
            ? '给你的想法，一个家。'
            : mode === 'forgot'
              ? '找回你的工作空间。'
              : mode === 'reset'
                ? '设置新的密码。'
                : '欢迎回来，继续创造。'}
        </h2>
        <p>使用 Supabase 账户保存项目与每一次迭代。</p>
        {!configured && (
          <div className="config-note">
            Supabase 尚未连接，注册登录暂不可用。你可以关闭窗口，先体验示例项目。
          </div>
        )}
        <form onSubmit={submit}>
          {mode === 'signup' && (
            <label>
              你的名字
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                maxLength={50}
                placeholder="怎么称呼你？"
              />
            </label>
          )}
          {mode !== 'reset' && (
            <label>
              邮箱
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </label>
          )}
          {mode !== 'forgot' && (
            <label>
              密码
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
                minLength={mode === 'login' ? 1 : 8}
                placeholder={mode === 'login' ? '输入你的密码' : '至少 8 个字符'}
              />
            </label>
          )}
          {feedback && (
            <div className="auth-feedback" role="status">
              {feedback}
            </div>
          )}
          <button className="primary-button" disabled={busy || !configured}>
            {busy ? <LoaderCircle size={16} className="spin" /> : null}
            {mode === 'login'
              ? '登录'
              : mode === 'signup'
                ? '创建账户'
                : mode === 'forgot'
                  ? '发送重置邮件'
                  : '更新密码'}
            <ArrowUpRight size={15} />
          </button>
        </form>
        <div className="auth-links">
          {mode === 'login' ? (
            <>
              <span>
                还没有账户？
                <button
                  onClick={() => {
                    setMode('signup');
                    setFeedback('');
                  }}
                >
                  注册
                </button>
              </span>
              <button
                onClick={() => {
                  setMode('forgot');
                  setFeedback('');
                }}
              >
                忘记密码
              </button>
            </>
          ) : (
            <button
              onClick={() => {
                setMode('login');
                setFeedback('');
              }}
            >
              返回登录
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
