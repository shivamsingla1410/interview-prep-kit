'use client';

import { useEffect, useState } from 'react';
import PracticeMode from './PracticeMode';

const categories = ['technical', 'behavioural', 'system-design', 'company-fit'] as const;
type Category = typeof categories[number];
type Question = { id: string; requirement_ids: string[]; category: Category; prompt: string; answer_outline: string; difficulty: number; origin?: 'generated' | 'manual'; edited?: boolean; pinned?: boolean };
type Flashcard = { id: string; front: string; back: string; requirement_ids: string[]; origin?: 'generated' | 'manual'; edited?: boolean; pinned?: boolean };
type Kit = { _id: string; title: string; status: string; generationProgress?: string; generationError?: string; sourceGaps?: Array<{ source: string; reason: string }>; generatedKit?: any; practiceProgress?: Record<string, { confidence: 'low' | 'medium' | 'high'; attempts: number; firstPracticedAt?: string; lastPracticedAt?: string }>; regeneration?: { status?: string; section?: string; category?: string; progress?: string; error?: string } };
type QuestionOperation = { operation: 'edit'; id: string; prompt?: string; answer_outline?: string; difficulty?: number } | { operation: 'move'; id: string; category: Category } | { operation: 'pin'; id: string; pinned: boolean } | { operation: 'delete'; id: string } | { operation: 'add'; prompt: string; answer_outline: string; difficulty: number; category: Category } | { operation: 'reorder'; ids: string[] };
type FlashcardOperation = { operation: 'edit'; id: string; front?: string; back?: string } | { operation: 'pin'; id: string; pinned: boolean } | { operation: 'delete'; id: string } | { operation: 'add'; front: string; back: string };
type Props = {
  kit: Kit;
  onQuestionOperation: (operation: QuestionOperation) => Promise<void>;
  onFlashcardOperation: (operation: FlashcardOperation) => Promise<void>;
  onSaveBrief: (summary: string, whatTheyDo: string) => Promise<void>;
  onRegenerate: (section: 'company_brief' | 'questions' | 'schedule', category?: Category) => Promise<void>;
  onRecordPracticeConfidence: (flashcardId: string, confidence: 'low' | 'medium' | 'high') => Promise<void>;
};

const inputClass = 'w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm leading-6 outline-none transition focus:border-[var(--green)] focus:ring-2 focus:ring-green-100';
const buttonClass = 'rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-medium text-stone-600 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50';

export default function KitEditor({ kit, onQuestionOperation, onFlashcardOperation, onSaveBrief, onRegenerate, onRecordPracticeConfidence }: Props) {
  const data = kit.generatedKit;
  const questions: Question[] = data?.questions || [];
  const flashcards: Flashcard[] = data?.flashcards || [];
  const [busyAction, setBusyAction] = useState('');
  const [message, setMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, Pick<Question, 'prompt' | 'answer_outline'>>>({});
  const [brief, setBrief] = useState({ summary: data?.company_brief?.summary || '', whatTheyDo: data?.company_brief?.what_they_do || '' });
  const [newQuestionOpen, setNewQuestionOpen] = useState(false);
  const [newQuestion, setNewQuestion] = useState({ prompt: '', answer_outline: '', category: 'technical' as Category, difficulty: 2 });
  const [newFlashcardOpen, setNewFlashcardOpen] = useState(false);
  const [newFlashcard, setNewFlashcard] = useState({ front: '', back: '' });
  const [regenerateCategory, setRegenerateCategory] = useState<Category>('technical');

  useEffect(() => {
    setBrief({ summary: data?.company_brief?.summary || '', whatTheyDo: data?.company_brief?.what_they_do || '' });
  }, [data?.company_brief?.summary, data?.company_brief?.what_they_do]);

  async function perform(key: string, action: () => Promise<void>, successMessage: string) {
    setBusyAction(key); setActionError(''); setMessage('');
    try { await action(); setMessage(successMessage); }
    catch (error) { setActionError(error instanceof Error ? error.message : 'Could not save this change.'); }
    finally { setBusyAction(''); }
  }

  function reorder(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    const ids = questions.map((question) => question.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void perform('reorder', () => onQuestionOperation({ operation: 'reorder', ids }), 'Question order saved.');
  }

  const regenerating = kit.regeneration?.status === 'generating';

  return <section className="mt-7 rounded-2xl border border-[var(--line)] bg-white p-5 md:p-8" aria-live="polite">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--green)]">{kit.status === 'generating' ? 'In progress' : kit.status === 'failed' ? 'Generation stopped' : 'Preparation kit'}</p><h2 className="mt-2 text-2xl font-semibold">{kit.title}</h2><p className="mt-1 text-sm text-stone-500">{kit.generationProgress}</p></div><span className="rounded-full bg-[#f0f5f1] px-3 py-1 text-xs text-[var(--green)]">{kit.status}</span></div>
    {kit.status === 'failed' && <p role="alert" className="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">{kit.generationError}</p>}
    {!!kit.sourceGaps?.length && <div className="mt-5 rounded-lg bg-amber-50 p-4"><h3 className="text-sm font-semibold text-amber-900">Research gaps</h3><ul className="mt-2 space-y-1 text-xs leading-5 text-amber-900">{kit.sourceGaps.map((gap, i) => <li key={`${gap.source}-${i}`}><strong>{gap.source}:</strong> {gap.reason}</li>)}</ul></div>}
    {regenerating && <p role="status" className="mt-5 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900">{kit.regeneration?.progress || 'Regenerating section…'} Your other edits remain available.</p>}
    {kit.regeneration?.status === 'idle' && kit.regeneration.progress === 'Section regenerated' && <p role="status" className="mt-5 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Section regenerated successfully.</p>}
    {kit.regeneration?.status === 'failed' && <p role="alert" className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{kit.regeneration.error || 'Section regeneration failed.'}</p>}
    {message && <p role="status" className="mt-4 text-sm text-emerald-800">{message}</p>}{actionError && <p role="alert" className="mt-4 text-sm text-red-700">{actionError}</p>}
    {data && <div className="mt-7 space-y-9">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Company brief</h3><button className={buttonClass} disabled={regenerating || busyAction !== ''} onClick={() => void perform('brief-regenerate', () => onRegenerate('company_brief'), 'Regeneration started.')}>{busyAction === 'brief-regenerate' || kit.regeneration?.section === 'company_brief' && regenerating ? 'Regenerating…' : 'Regenerate brief'}</button></div>
        <label className="mt-3 block text-xs font-medium text-stone-500">Summary</label><textarea className={`${inputClass} mt-1`} rows={3} value={brief.summary} onChange={(event) => setBrief({ ...brief, summary: event.target.value })}/>
        <label className="mt-3 block text-xs font-medium text-stone-500">What the company does</label><textarea className={`${inputClass} mt-1`} rows={3} value={brief.whatTheyDo} onChange={(event) => setBrief({ ...brief, whatTheyDo: event.target.value })}/>
        <button className={`${buttonClass} mt-3`} disabled={busyAction !== ''} onClick={() => void perform('brief-save', () => onSaveBrief(brief.summary, brief.whatTheyDo), 'Company brief saved.')}>Save brief</button>{data.company_brief.edited && <span className="ml-2 text-xs text-stone-400">Edited by you</span>}
        {!!data.company_brief.sources?.length && <p className="mt-2 text-xs text-stone-400">Sources: {data.company_brief.sources.join(' · ')}</p>}
      </section>

      <section><h3 className="text-lg font-semibold">Role breakdown</h3><p className="mt-2 text-sm text-stone-600">{data.role.title} · {data.role.seniority} · {data.source.location}</p><ul className="mt-3 space-y-2">{data.role.requirements.map((requirement: any) => <li key={requirement.id} className="rounded-lg bg-stone-50 p-3 text-sm"><span className="mr-2 text-xs uppercase text-stone-400">{requirement.priority}</span>{requirement.text}</li>)}</ul></section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Question bank <span className="ml-1 text-sm font-normal text-stone-400">({questions.length})</span></h3><div className="flex flex-wrap items-center gap-2"><select aria-label="Question category to regenerate" value={regenerateCategory} onChange={(event) => setRegenerateCategory(event.target.value as Category)} className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-xs">{categories.map((value) => <option key={value} value={value}>{value.replace('-', ' ')}</option>)}</select><button className={buttonClass} disabled={regenerating || busyAction !== ''} onClick={() => void perform('questions-regenerate', () => onRegenerate('questions', regenerateCategory), 'Regeneration started.')}>{busyAction === 'questions-regenerate' || kit.regeneration?.section === 'questions' && regenerating ? 'Regenerating…' : 'Regenerate category'}</button><button className={buttonClass} onClick={() => setNewQuestionOpen(!newQuestionOpen)}>{newQuestionOpen ? 'Close' : '+ Add question'}</button></div></div>
        {newQuestionOpen && <form className="mt-4 space-y-3 rounded-xl bg-stone-50 p-4" onSubmit={(event) => { event.preventDefault(); void perform('question-add', async () => { await onQuestionOperation({ operation: 'add', ...newQuestion }); setNewQuestion({ prompt: '', answer_outline: '', category: 'technical', difficulty: 2 }); setNewQuestionOpen(false); }, 'Question added.'); }}>
          <input required maxLength={600} placeholder="Question prompt" className={inputClass} value={newQuestion.prompt} onChange={(event) => setNewQuestion({ ...newQuestion, prompt: event.target.value })}/><textarea required maxLength={1600} rows={3} placeholder="Answer outline" className={inputClass} value={newQuestion.answer_outline} onChange={(event) => setNewQuestion({ ...newQuestion, answer_outline: event.target.value })}/><div className="flex flex-wrap gap-2"><select value={newQuestion.category} onChange={(event) => setNewQuestion({ ...newQuestion, category: event.target.value as Category })} className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm">{categories.map((value) => <option key={value} value={value}>{value.replace('-', ' ')}</option>)}</select><select aria-label="Difficulty" value={newQuestion.difficulty} onChange={(event) => setNewQuestion({ ...newQuestion, difficulty: Number(event.target.value) })} className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"><option value={1}>Difficulty 1</option><option value={2}>Difficulty 2</option><option value={3}>Difficulty 3</option></select><button className={buttonClass} disabled={busyAction !== ''} type="submit">Add question</button></div>
        </form>}
        <div className="mt-4 space-y-3">{questions.map((question, index) => {
          const draft = questionDrafts[question.id] || { prompt: question.prompt, answer_outline: question.answer_outline };
          return <article key={question.id} className="rounded-xl border border-[var(--line)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><select aria-label="Question category" value={question.category} disabled={busyAction !== ''} onChange={(event) => void perform(`move-${question.id}`, () => onQuestionOperation({ operation: 'move', id: question.id, category: event.target.value as Category }), 'Question category updated.')} className="rounded-md border border-[var(--line)] bg-white px-2 py-1 text-xs">{categories.map((value) => <option key={value} value={value}>{value.replace('-', ' ')}</option>)}</select><select aria-label="Question difficulty" value={question.difficulty} disabled={busyAction !== ''} onChange={(event) => void perform(`difficulty-${question.id}`, () => onQuestionOperation({ operation: 'edit', id: question.id, difficulty: Number(event.target.value) }), 'Question difficulty updated.')} className="rounded-md border border-[var(--line)] bg-white px-2 py-1 text-xs">{[1, 2, 3].map((value) => <option key={value} value={value}>Difficulty {value}</option>)}</select>{question.origin === 'manual' && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] text-blue-700">Handwritten</span>}{question.edited && <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] text-amber-800">Edited</span>}</div>
              <div className="flex gap-1"><button className={buttonClass} disabled={index === 0 || busyAction !== ''} aria-label="Move question up" onClick={() => reorder(index, -1)}>↑</button><button className={buttonClass} disabled={index === questions.length - 1 || busyAction !== ''} aria-label="Move question down" onClick={() => reorder(index, 1)}>↓</button><button className={buttonClass} disabled={busyAction !== ''} onClick={() => void perform(`pin-${question.id}`, () => onQuestionOperation({ operation: 'pin', id: question.id, pinned: !question.pinned }), question.pinned ? 'Question unpinned.' : 'Question pinned.')}>{question.pinned ? 'Unpin' : 'Pin'}</button><button className="rounded-lg border border-red-100 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50" disabled={busyAction !== ''} onClick={() => void perform(`delete-${question.id}`, () => onQuestionOperation({ operation: 'delete', id: question.id }), 'Question deleted.')}>Delete</button></div></div>
            <input aria-label="Question prompt" className={`${inputClass} mt-3 font-medium`} value={draft.prompt} onChange={(event) => setQuestionDrafts({ ...questionDrafts, [question.id]: { ...draft, prompt: event.target.value } })}/><textarea aria-label="Answer outline" rows={4} className={`${inputClass} mt-2 whitespace-pre-line`} value={draft.answer_outline} onChange={(event) => setQuestionDrafts({ ...questionDrafts, [question.id]: { ...draft, answer_outline: event.target.value } })}/>
            {(draft.prompt !== question.prompt || draft.answer_outline !== question.answer_outline) && <button className={`${buttonClass} mt-2`} disabled={busyAction !== ''} onClick={() => void perform(`question-save-${question.id}`, async () => { await onQuestionOperation({ operation: 'edit', id: question.id, ...draft }); setQuestionDrafts(({ [question.id]: _saved, ...rest }) => rest); }, 'Question saved.')}>Save question</button>}
          </article>;
        })}</div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Study schedule</h3><button className={buttonClass} disabled={regenerating || busyAction !== ''} onClick={() => void perform('schedule-regenerate', () => onRegenerate('schedule'), 'Regeneration started.')}>{busyAction === 'schedule-regenerate' || kit.regeneration?.section === 'schedule' && regenerating ? 'Regenerating…' : 'Regenerate schedule'}</button></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{data.schedule.days.map((day: any) => <article key={day.day} className="rounded-lg bg-[#f5f7f3] p-4"><p className="text-xs font-semibold uppercase text-[var(--green)]">Day {day.day} · {day.minutes} min</p><p className="mt-2 text-sm font-medium">{day.focus}</p><p className="mt-1 text-xs text-stone-500">{day.question_ids.length} questions</p></article>)}</div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Flashcards <span className="ml-1 text-sm font-normal text-stone-400">({flashcards.length})</span></h3><button className={buttonClass} onClick={() => setNewFlashcardOpen(!newFlashcardOpen)}>{newFlashcardOpen ? 'Close' : '+ Add flashcard'}</button></div>
        {newFlashcardOpen && <form className="mt-4 space-y-3 rounded-xl bg-stone-50 p-4" onSubmit={(event) => { event.preventDefault(); void perform('flashcard-add', async () => { await onFlashcardOperation({ operation: 'add', ...newFlashcard }); setNewFlashcard({ front: '', back: '' }); setNewFlashcardOpen(false); }, 'Flashcard added.'); }}><input required maxLength={500} placeholder="Flashcard front" className={inputClass} value={newFlashcard.front} onChange={(event) => setNewFlashcard({ ...newFlashcard, front: event.target.value })}/><textarea required maxLength={1600} rows={3} placeholder="Flashcard back" className={inputClass} value={newFlashcard.back} onChange={(event) => setNewFlashcard({ ...newFlashcard, back: event.target.value })}/><button className={buttonClass} disabled={busyAction !== ''} type="submit">Add flashcard</button></form>}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{flashcards.map((card: Flashcard) => <FlashcardItem key={card.id} card={card} busy={busyAction !== ''} onSave={(front, back) => perform(`flashcard-save-${card.id}`, () => onFlashcardOperation({ operation: 'edit', id: card.id, front, back }), 'Flashcard saved.')} onPin={() => void perform(`flashcard-pin-${card.id}`, () => onFlashcardOperation({ operation: 'pin', id: card.id, pinned: !card.pinned }), card.pinned ? 'Flashcard unpinned.' : 'Flashcard pinned.')} onDelete={() => void perform(`flashcard-delete-${card.id}`, () => onFlashcardOperation({ operation: 'delete', id: card.id }), 'Flashcard deleted.')}/> )}</div>
      </section>

      <PracticeMode flashcards={flashcards} progress={kit.practiceProgress || {}} onRecordConfidence={onRecordPracticeConfidence}/>
      <p className="text-xs text-stone-400">Coverage: {data.coverage.uncovered_requirement_ids.length ? `${data.coverage.uncovered_requirement_ids.length} requirements uncovered` : 'all extracted requirements have questions'} · {data.coverage.passes} passes</p>
      <p className="text-xs leading-5 text-stone-400">Handwritten and edited questions are protected from category regeneration. Pin generated questions to protect them too.</p>
    </div>}
  </section>;
}

function FlashcardItem({ card, busy, onSave, onPin, onDelete }: { card: Flashcard; busy: boolean; onSave: (front: string, back: string) => Promise<void>; onPin: () => void; onDelete: () => void }) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  useEffect(() => { setFront(card.front); setBack(card.back); }, [card.front, card.back]);
  const changed = front !== card.front || back !== card.back;
  return <article className="rounded-xl border border-[var(--line)] p-4"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="flex gap-2">{card.origin === 'manual' && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] text-blue-700">Handwritten</span>}{card.edited && <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] text-amber-800">Edited</span>}</div><div className="flex gap-1"><button className={buttonClass} disabled={busy} onClick={onPin}>{card.pinned ? 'Unpin' : 'Pin'}</button><button className="rounded-lg border border-red-100 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50" disabled={busy} onClick={onDelete}>Delete</button></div></div><input aria-label="Flashcard front" className={`${inputClass} font-medium`} value={front} onChange={(event) => setFront(event.target.value)}/><textarea aria-label="Flashcard back" rows={3} className={`${inputClass} mt-2`} value={back} onChange={(event) => setBack(event.target.value)}/>{changed && <button className={`${buttonClass} mt-2`} disabled={busy} onClick={() => void onSave(front, back)}>Save flashcard</button>}</article>;
}
