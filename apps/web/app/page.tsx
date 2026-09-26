'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import KitEditor from './prepare/KitEditor';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
type User = { id: string; fullName: string; email: string };
type Kit = { _id: string; title: string; companyUrl: string; jobDescription?: string; daysAvailable: number; status: string; generationProgress?: string; generationError?: string; sourceGaps?: Array<{ source: string; reason: string }>; generatedKit?: any; practiceProgress?: Record<string, { confidence: 'low' | 'medium' | 'high'; attempts: number; firstPracticedAt?: string; lastPracticedAt?: string }>; regeneration?: { status?: string; section?: string; category?: string; progress?: string; error?: string }; createdAt: string };
type PreparationFields = { title: string; companyUrl: string; daysAvailable: string; jobDescription: string };
const emptyPreparation: PreparationFields = { title: '', companyUrl: '', daysAvailable: '5', jobDescription: '' };

async function request(path: string, init?: RequestInit) {
  let response: Response;
  try { response = await fetch(`${API}${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init?.headers } }); }
  catch (error) {
    if (error instanceof TypeError) throw new Error(`Could not reach the Trao API at ${API}. Check that the API server is running and that its allowed web origin matches this app.`);
    throw error;
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.message || 'Something went wrong.'), { status: response.status, data });
  return data;
}

export default function Home() {
  const pathname = usePathname();
  const router = useRouter();
  const routeKitId = pathname.startsWith('/prepare/') ? pathname.slice('/prepare/'.length).split('/')[0] : '';
  const [user, setUser] = useState<User | null>(null);
  const [kits, setKits] = useState<Kit[]>([]);
  const [activeKit, setActiveKit] = useState<Kit | null>(null);
  const [activeKitId, setActiveKitId] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preparationFields, setPreparationFields] = useState<PreparationFields>(emptyPreparation);

  const load = useCallback(async () => {
    try {
      const me = await request('/auth/me');
      setUser(me.user);
      const history = await request('/kits');
      setKits(history.kits);
    } catch (e: any) {
      if (e.status === 401) setUser(null);
      else setError(e.message || 'Could not load your workspace.');
    }
    finally { setChecking(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (user && pathname === '/') router.replace('/prepare');
  }, [user, pathname, router]);
  useEffect(() => {
    let alive = true;
    setActiveKitId(routeKitId);
    if (pathname === '/prepare' && routeKitId === '') {
      setActiveKit(null); setPreparationFields(emptyPreparation); setError(''); setNotice(''); setBusy(false);
      return () => { alive = false; };
    }
    if (routeKitId) {
      setError(''); setNotice('');
      void request(`/kits/${routeKitId}`).then((result) => {
        if (!alive) return;
        const kit = result.kit;
        setActiveKit(kit);
        setPreparationFields({ title: kit.title || '', companyUrl: kit.companyUrl || '', daysAvailable: String(kit.daysAvailable || 5), jobDescription: kit.jobDescription || '' });
        setBusy(kit.status === 'generating');
      }).catch((e: any) => { if (alive) { setActiveKit(null); setBusy(false); setError(e.message); } });
    }
    return () => { alive = false; };
  }, [pathname, routeKitId]);
  useEffect(() => {
    if (!kits.some((kit) => kit.status === 'generating')) return;
    const timer = window.setInterval(() => { void load(); }, 2500);
    return () => window.clearInterval(timer);
  }, [kits, load]);
  useEffect(() => {
    if (!activeKitId || (activeKit && activeKit.status !== 'generating' && activeKit.regeneration?.status !== 'generating')) return;
    let alive = true;
    const refresh = async () => {
      try {
        const result = await request(`/kits/${activeKitId}`);
        if (alive) {
          setActiveKit(result.kit);
          if (result.kit.status !== 'generating') setBusy(false);
        }
      }
      catch (e: any) { if (alive) { setActiveKit(null); setBusy(false); setError(e.message); } }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    return () => { alive = false; window.clearInterval(timer); };
  }, [activeKitId, activeKit?.status, activeKit?.regeneration?.status]);

  async function authenticate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const payload: Record<string, string> = { email: String(form.get('email') || ''), password: String(form.get('password') || '') };
    if (mode === 'register') payload.fullName = String(form.get('fullName') || '');
    try { await request(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) }); await load(); router.replace('/prepare'); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function createKit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = await request('/kits', { method: 'POST', body: JSON.stringify({ ...preparationFields, daysAvailable: Number(preparationFields.daysAvailable) }) });
      setActiveKitId(result.kit.id);
      setActiveKit({ _id: result.kit.id, ...preparationFields, daysAvailable: Number(preparationFields.daysAvailable), status: 'generating', generationProgress: result.kit.generationProgress, createdAt: new Date().toISOString() });
      setNotice('Your preparation is underway. We’ll show research and generation progress here.');
      await load();
    } catch (e: any) { setError(e.message); setBusy(false); }
  }

  async function openKit(kitId: string) {
    setActiveKitId(kitId); setError(''); setNotice(''); router.push(`/prepare/${kitId}`);
    try {
      const result = await request(`/kits/${kitId}`);
      const kit = result.kit;
      setActiveKit(kit);
      setPreparationFields({ title: kit.title || '', companyUrl: kit.companyUrl || '', daysAvailable: String(kit.daysAvailable || 5), jobDescription: kit.jobDescription || '' });
      setBusy(kit.status === 'generating');
    } catch (e: any) { setError(e.message); setBusy(false); }
  }

  async function updateKitContent(path: string, payload: unknown) {
    if (!activeKitId) throw new Error('Open a preparation before editing it.');
    const result = await request(`/kits/${activeKitId}${path}`, { method: 'PATCH', body: JSON.stringify(payload) });
    setActiveKit(result.kit);
  }

  async function regenerateSection(section: 'company_brief' | 'questions' | 'schedule', category?: 'technical' | 'behavioural' | 'system-design' | 'company-fit') {
    if (!activeKitId) throw new Error('Open a preparation before regenerating a section.');
    const result = await request(`/kits/${activeKitId}/regenerate`, { method: 'POST', body: JSON.stringify({ section, ...(category ? { category } : {}) }) });
    setActiveKit(result.kit);
  }

  async function recordPracticeConfidence(flashcardId: string, confidence: 'low' | 'medium' | 'high') {
    if (!activeKitId) throw new Error('Open a preparation before saving practice progress.');
    const result = await request(`/kits/${activeKitId}/practice/${encodeURIComponent(flashcardId)}`, { method: 'PATCH', body: JSON.stringify({ confidence }) });
    setActiveKit(result.kit);
  }

  function startNewPreparation() {
    setActiveKitId(''); setActiveKit(null); setPreparationFields(emptyPreparation); setError(''); setNotice(''); setBusy(false); router.push('/prepare');
  }

  async function logout() { await request('/auth/logout', { method: 'POST' }).catch(() => undefined); setUser(null); setKits([]); setActiveKit(null); setActiveKitId(''); router.replace('/'); }

  if (checking) return <main className="grid min-h-screen place-items-center text-sm text-stone-500">Opening your workspace…</main>;
  if (!user) return <AuthScreen mode={mode} setMode={setMode} onSubmit={authenticate} error={error} busy={busy} />;

  return <><main className="min-h-screen md:flex">
    <aside className="flex w-full flex-col border-r border-[var(--line)] bg-white md:fixed md:inset-y-0 md:w-[272px]">
      <div className="flex items-center gap-3 px-6 py-7"><div className="grid size-9 place-items-center rounded-xl bg-[var(--deep)] text-sm font-bold text-white">t.</div><span className="text-[19px] font-semibold tracking-tight">trao</span></div>
      <div className="px-4"><button type="button" onClick={startNewPreparation} disabled={busy} className="flex w-full items-center gap-3 rounded-lg bg-[var(--deep)] px-4 py-3 text-left text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"><span className="text-lg">＋</span> New preparation</button></div>
      <div className="mt-8 flex min-h-0 flex-1 flex-col px-4"><p className="shrink-0 px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-stone-400">Your history</p>
        <div className="sidebar-history-scroll mt-3 min-h-0 flex-1 overflow-y-auto overscroll-y-contain scroll-smooth pr-1">{kits.length ? <div className="space-y-1">{kits.map((kit) => <button key={kit._id} onClick={() => void openKit(kit._id)} className={`w-full truncate rounded-lg px-3 py-2.5 text-left text-sm ${activeKitId === kit._id ? 'bg-[#f0f5f1] text-[var(--deep)]' : 'text-stone-600 hover:bg-stone-50'}`}><span className="mr-2 text-stone-300">{kit.status === 'generating' ? '◌' : kit.status === 'ready' ? '✓' : kit.status === 'failed' ? '!' : '◷'}</span>{kit.title}<span className="mt-1 block truncate pl-6 text-[11px] text-stone-400">{kit.status === 'generating' ? kit.generationProgress || 'Starting…' : kit.status === 'ready' ? 'Ready' : kit.status === 'failed' ? 'Needs attention' : 'Draft'}</span></button>)}</div> : <p className="px-3 py-3 text-xs leading-5 text-stone-400">Your saved preparations will appear here.</p>}</div>
      </div>
      <div className="flex items-center gap-3 border-t border-[var(--line)] px-5 py-4"><div className="grid size-9 place-items-center rounded-full bg-[#e7efe9] text-sm font-semibold text-[var(--deep)]">{user.fullName.charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{user.fullName}</p><p className="truncate text-xs text-stone-400">{user.email}</p></div><button onClick={logout} aria-label="Sign out" title="Sign out" className="rounded-md px-2 py-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700">↗</button></div>
    </aside>
    <section className="w-full px-5 pb-14 pt-10 md:ml-[272px] md:px-12 md:pt-14 lg:px-20">
      <div className="mx-auto max-w-[790px]"><p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--green)]">A clearer way to prepare</p><h1 className="mt-3 text-3xl font-medium tracking-[-.04em] md:text-[42px]">Make your next interview<br className="hidden md:block"/> feel more familiar.</h1><p className="mt-4 max-w-lg text-[15px] leading-7 text-stone-500">Start with a role you’re interested in. We’ll turn the details into a focused preparation plan.</p>
        <form onSubmit={createKit} className="mt-10 rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[0_8px_30px_rgba(34,52,43,.035)] md:p-8">
          <div className="mb-7 flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Start a preparation</h2><p className="mt-1 text-sm text-stone-400">Add role details and we’ll research the company and build your kit.</p></div><span className="rounded-full bg-[#f0f5f1] px-3 py-1.5 text-[11px] font-medium text-[var(--green)]">RESEARCH + GENERATION</span></div>
          <label className="mb-2 block text-sm font-medium">Role title</label><input name="title" value={preparationFields.title} onChange={(event) => setPreparationFields({ ...preparationFields, title: event.target.value })} required minLength={2} maxLength={120} placeholder="e.g. Senior Product Designer" className="mb-5 w-full rounded-lg border border-[var(--line)] px-4 py-3 text-sm outline-none transition focus:border-[var(--green)] focus:ring-2 focus:ring-green-100" />
          <label className="mb-2 block text-sm font-medium">Company website</label><input name="companyUrl" value={preparationFields.companyUrl} onChange={(event) => setPreparationFields({ ...preparationFields, companyUrl: event.target.value })} required type="url" placeholder="https://company.com" className="mb-5 w-full rounded-lg border border-[var(--line)] px-4 py-3 text-sm outline-none transition focus:border-[var(--green)] focus:ring-2 focus:ring-green-100" />
          <label className="mb-2 block text-sm font-medium">Days until your interview</label><input name="daysAvailable" value={preparationFields.daysAvailable} onChange={(event) => setPreparationFields({ ...preparationFields, daysAvailable: event.target.value })} required type="number" min={1} max={60} step={1} className="mb-5 w-full rounded-lg border border-[var(--line)] px-4 py-3 text-sm outline-none transition focus:border-[var(--green)] focus:ring-2 focus:ring-green-100" />
          <div className="mb-2 flex items-center justify-between"><label className="text-sm font-medium">Job description</label><span className="text-xs text-stone-400">Paste the full description</span></div><textarea name="jobDescription" value={preparationFields.jobDescription} onChange={(event) => setPreparationFields({ ...preparationFields, jobDescription: event.target.value })} required minLength={20} maxLength={30000} rows={8} placeholder="Paste the job description here…" className="w-full resize-y rounded-lg border border-[var(--line)] px-4 py-3 text-sm leading-6 outline-none transition placeholder:text-stone-300 focus:border-[var(--green)] focus:ring-2 focus:ring-green-100" />
          {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{notice}</p>}
          <div className="mt-6 flex flex-col items-start justify-between gap-4 border-t border-[var(--line)] pt-5 sm:flex-row sm:items-center"><p className="text-xs text-stone-400">Your draft is private to your account.</p><button type="submit" disabled={busy} className="w-full rounded-lg bg-[var(--deep)] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#205548] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">{busy ? activeKit?.generationProgress || 'Preparing kit…' : 'Prepare kit'} <span className="ml-2">→</span></button></div>
        </form>
        {activeKit && <KitEditor kit={activeKit}
          onQuestionOperation={(operation) => updateKitContent('/questions', operation)}
          onFlashcardOperation={(operation) => updateKitContent('/flashcards', operation)}
          onSaveBrief={(summary, what_they_do) => updateKitContent('/company-brief', { summary, what_they_do })}
          onRegenerate={regenerateSection}
          onRecordPracticeConfidence={recordPracticeConfidence}
        />}
        <div className="mt-7 flex gap-3 rounded-xl border border-[#e9eee9] bg-[#f1f5f1] p-4"><span className="text-lg">✳</span><p className="text-xs leading-5 text-stone-500"><strong className="font-medium text-stone-700">A note on privacy</strong><br/>Your role details and saved preparations are only visible to you.</p></div>
      </div>
    </section>
  </main></>;
}

function AuthScreen({ mode, setMode, onSubmit, error, busy }: { mode: 'login' | 'register'; setMode: (value: 'login' | 'register') => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; error: string; busy: boolean }) {
  const registering = mode === 'register';
  return <main className="grid min-h-screen lg:grid-cols-[1.05fr_.95fr]">
    <section className="relative hidden overflow-hidden bg-[var(--deep)] p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16"><div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-white/10 font-bold">t.</div><span className="text-xl font-semibold">trao</span></div><div className="relative z-10 max-w-lg"><p className="text-xs font-semibold uppercase tracking-[.2em] text-[#a6d3bd]">Prepare with purpose</p><h1 className="mt-5 text-5xl font-medium leading-[1.12] tracking-[-.045em]">Show up ready<br/>to be yourself.</h1><p className="mt-6 max-w-md text-base leading-7 text-white/65">A little clarity before the conversation can change how you walk into it.</p><div className="mt-12 flex gap-2"><span className="h-1 w-10 rounded-full bg-[#a6d3bd]"/><span className="h-1 w-5 rounded-full bg-white/25"/><span className="h-1 w-5 rounded-full bg-white/25"/></div></div><p className="text-xs text-white/40">Thoughtful preparation for what comes next.</p><div className="pointer-events-none absolute -bottom-48 -right-32 size-[520px] rounded-full border border-white/10"/><div className="pointer-events-none absolute -bottom-32 -right-16 size-[380px] rounded-full border border-white/10"/></section>
    <section className="flex min-h-screen items-center justify-center px-6 py-12"><div className="w-full max-w-[410px]"><div className="mb-10 flex items-center gap-3 lg:hidden"><div className="grid size-9 place-items-center rounded-xl bg-[var(--deep)] font-bold text-white">t.</div><span className="text-lg font-semibold">trao</span></div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--green)]">Your next chapter starts here</p><h2 className="mt-3 text-3xl font-semibold tracking-[-.04em]">{registering ? 'Create your account' : 'Welcome back'}</h2><p className="mt-2 text-sm text-stone-500">{registering ? 'Set up your private interview prep workspace.' : 'Sign in to pick up where you left off.'}</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-5">{registering && <div><label className="mb-2 block text-sm font-medium">Full name</label><input autoComplete="name" name="fullName" required minLength={2} maxLength={80} placeholder="Your name" className="w-full rounded-lg border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--green)] focus:ring-2 focus:ring-green-100"/></div>}<div><label className="mb-2 block text-sm font-medium">Email address</label><input autoComplete="email" name="email" required type="email" maxLength={254} placeholder="you@example.com" className="w-full rounded-lg border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--green)] focus:ring-2 focus:ring-green-100"/></div><div><label className="mb-2 block text-sm font-medium">Password</label><input autoComplete={registering ? 'new-password' : 'current-password'} name="password" required type="password" minLength={registering ? 8 : 1} maxLength={72} placeholder={registering ? 'At least 8 characters' : 'Enter your password'} className="w-full rounded-lg border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none focus:border-[var(--green)] focus:ring-2 focus:ring-green-100"/></div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}<button disabled={busy} className="w-full rounded-lg bg-[var(--deep)] px-5 py-3.5 text-sm font-medium text-white transition hover:bg-[#205548] disabled:opacity-60">{busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'} <span className="ml-1">→</span></button></form>
      <p className="mt-6 text-center text-sm text-stone-500">{registering ? 'Already have an account?' : 'New to Trao?'} <button onClick={() => { setMode(registering ? 'login' : 'register'); }} className="font-semibold text-[var(--green)] hover:underline">{registering ? 'Sign in' : 'Create an account'}</button></p><p className="mt-10 text-center text-xs leading-5 text-stone-400">By continuing, you agree to keep your preparation thoughtful<br className="hidden sm:block"/> and your account credentials private.</p>
    </div></section>
  </main>;
}
