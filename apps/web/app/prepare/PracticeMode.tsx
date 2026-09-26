'use client';

import { useMemo, useState } from 'react';

type Flashcard = { id: string; front: string; back: string };
type Confidence = 'low' | 'medium' | 'high';
type RecordEntry = { confidence: Confidence; attempts: number; lastPracticedAt?: string; firstPracticedAt?: string };

const confidenceOrder: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const buttonClass = 'rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50';

export default function PracticeMode({ flashcards, progress, onRecordConfidence }: {
  flashcards: Flashcard[];
  progress: Record<string, RecordEntry>;
  onRecordConfidence: (flashcardId: string, confidence: Confidence) => Promise<void>;
}) {
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const cardsById = useMemo(() => new Map(flashcards.map((card) => [card.id, card])), [flashcards]);
  const sessionCards = sessionIds.flatMap((id) => {
    const card = cardsById.get(id);
    return card ? [card] : [];
  });
  const coveredCount = flashcards.filter((card) => Boolean(progress[card.id]?.confidence)).length;
  const uncoveredCount = flashcards.length - coveredCount;
  const current = sessionCards[activeIndex];

  function startSession() {
    const originalOrder = new Map(flashcards.map((card, index) => [card.id, index]));
    const ordered = [...flashcards].sort((a, b) => {
      const aConfidence = progress[a.id]?.confidence;
      const bConfidence = progress[b.id]?.confidence;
      // Unseen cards sort ahead of practiced cards; ties retain the kit's current card order.
      const aRank = aConfidence ? confidenceOrder[aConfidence] : -1;
      const bRank = bConfidence ? confidenceOrder[bConfidence] : -1;
      return aRank - bRank || (originalOrder.get(a.id)! - originalOrder.get(b.id)!);
    });
    setSessionIds(ordered.map((card) => card.id));
    setActiveIndex(0);
    setRevealed(false);
    setError('');
    setMessage('Session ordered with unseen and lowest-confidence cards first.');
  }

  function moveTo(index: number) {
    setActiveIndex(index);
    setRevealed(false);
    setError('');
    setMessage('');
  }

  async function record(confidence: Confidence) {
    if (!current) return;
    setSaving(true);
    setError('');
    try {
      await onRecordConfidence(current.id, confidence);
      setMessage(`Saved ${confidence} confidence.`);
      setRevealed(false);
      setActiveIndex((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save practice progress.');
    } finally {
      setSaving(false);
    }
  }

  return <section className="rounded-2xl border border-[var(--line)] bg-[#f7f8f5] p-5 md:p-7" aria-labelledby="practice-heading">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--green)]">Practice</p><h3 id="practice-heading" className="mt-1 text-xl font-semibold">Flashcard session</h3><p className="mt-1 text-sm text-stone-500">Recall the answer first, then rate how confident you felt.</p></div>
      <button type="button" className={buttonClass} disabled={!flashcards.length || saving} onClick={startSession}>{sessionCards.length && activeIndex < sessionCards.length ? 'Restart · weakest first' : 'Start next session · weakest first'}</button>
    </div>

    <div className="mt-5">
      <div className="flex items-center justify-between gap-3 text-sm"><p><strong>{coveredCount}</strong> covered <span className="px-1 text-stone-300">·</span><strong>{uncoveredCount}</strong> not yet covered</p><p className="text-stone-500">{flashcards.length} total</p></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-label="Flashcards covered" aria-valuemin={0} aria-valuemax={flashcards.length} aria-valuenow={coveredCount}><div className="h-full rounded-full bg-[var(--green)] transition-all" style={{ width: `${flashcards.length ? (coveredCount / flashcards.length) * 100 : 0}%` }}/></div>
    </div>

    {!flashcards.length ? <p className="mt-5 rounded-xl border border-dashed border-stone-300 p-5 text-sm text-stone-500">Add a flashcard to start practicing.</p>
      : !sessionCards.length || activeIndex >= sessionCards.length ? <div className="mt-5 rounded-xl border border-[var(--line)] bg-white p-5">
        <p className="font-medium">{sessionCards.length ? 'Session complete.' : 'Ready when you are.'}</p>
        <p className="mt-1 text-sm text-stone-500">{sessionCards.length ? 'Your confidence ratings are saved. Start another session to bring the least-confident cards back first.' : 'Start a session to practice these cards.'}</p>
      </div> : <article className="mt-5 rounded-xl border border-[var(--line)] bg-white p-5 md:p-6" aria-live="polite">
        <div className="flex items-center justify-between gap-2 text-xs text-stone-400"><span>Card {activeIndex + 1} of {sessionCards.length}</span>{progress[current.id]?.confidence && <span className="rounded-full bg-[#f0f5f1] px-2.5 py-1 text-[var(--green)]">Last time: {progress[current.id].confidence} confidence</span>}</div>
        <p className="mt-5 whitespace-pre-line text-lg font-medium leading-7 text-stone-800">{current.front}</p>
        {revealed ? <div className="mt-5 rounded-lg bg-[#f5f7f3] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--green)]">Answer</p><p className="mt-2 whitespace-pre-line text-sm leading-6 text-stone-700">{current.back}</p>
          <fieldset className="mt-5" disabled={saving}><legend className="text-sm font-medium">How confident did you feel?</legend><div className="mt-2 flex flex-wrap gap-2">{(['low', 'medium', 'high'] as const).map((level) => <button key={level} type="button" className={`${buttonClass} capitalize`} disabled={saving} onClick={() => void record(level)}>{saving ? 'Saving…' : `${level} confidence`}</button>)}</div></fieldset>
        </div> : <button type="button" className="mt-5 rounded-lg bg-[var(--deep)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#205548]" onClick={() => { setRevealed(true); setError(''); }}>Reveal answer</button>}
        <div className="mt-5 flex justify-between gap-3 border-t border-[var(--line)] pt-4"><button type="button" className={buttonClass} disabled={activeIndex === 0 || saving} onClick={() => moveTo(activeIndex - 1)}>Previous</button><button type="button" className={buttonClass} disabled={saving} onClick={() => moveTo(activeIndex + 1)}>{activeIndex + 1 === sessionCards.length ? 'Finish session' : 'Skip card'}</button></div>
      </article>}

    {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}{message && <p className="mt-3 text-sm text-stone-500" role="status">{message}</p>}
    {!!flashcards.length && <details className="mt-5"><summary className="cursor-pointer text-sm font-medium text-stone-600">Card coverage details</summary><ul className="mt-3 divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-white">{flashcards.map((card) => {
      const entry = progress[card.id];
      return <li key={card.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"><span className="min-w-0 flex-1 truncate">{card.front}</span><span className={entry ? 'text-xs capitalize text-[var(--green)]' : 'text-xs text-stone-400'}>{entry ? `Covered · ${entry.confidence} confidence · ${entry.attempts} ${entry.attempts === 1 ? 'attempt' : 'attempts'}` : 'Not yet covered'}</span></li>;
    })}</ul></details>}
  </section>;
}
