# Trao Interview Prep

Current implementation: account registration/login, MongoDB-backed server sessions, a protected dashboard, job-description/company URL/day input, private history, background research and kit generation, and a structured kit viewer.

## Stack

- Next.js + Tailwind CSS for the web UI
- Node.js + Express + TypeScript for the API
- MongoDB + Mongoose for users, kits, and server sessions
- `express-session` with `connect-mongo`; the browser receives only an HttpOnly session cookie
- `bcryptjs` for password hashing and `zod` for request validation

## Run locally

1. Install Node.js and start MongoDB.
2. Copy `.env.example` to `.env` and set a unique `SESSION_SECRET` (at least 32 characters).
   Add `GROQ_API_KEY` for generation and `TAVILY_API_KEY` for public interview-discussion search. Groq uses `openai/gpt-oss-20b` by default; set `GROQ_MODEL` to override it.
3. Run `npm install` and then `npm run dev`.
4. Open http://localhost:3000.

The API runs at http://localhost:4000. Register using full name, email and password. A user's history is always queried with their authenticated user id.

### Run the batch evaluator

Create a UTF-8 JSON file containing an array of cases. Each case has a unique caller-provided `id`, pasted `jd`, `company_url`, and integer `days` from 1 to 60. Then run this exact assessment entry point from the repository root:

```sh
npm run evaluate -- --input ./cases.json --output ./kits.json
```

The evaluator loads the same root `.env` as the API and calls the same `generateKit` pipeline, including retrieval, generation, retry/backoff, deterministic coverage repair, schedule allocation, and Zod structure validation. It processes cases sequentially to share the process-wide Groq token gate and reduce bursts against free-tier rate limits. Progress is written to stderr; the output file contains one result for every input case and stays valid when individual cases fail. Invalid cases are recorded as `failed` with `INVALID_CASE`; pipeline failures include a structured error code/message. A partially researched but generated kit remains `ok`, with retrieval gaps in the `kit.source_gaps` extension. The command writes `{ "version": "1.0", "generated_at": "<ISO timestamp>", "kits": [...] }` and continues after case failures.

Example input:

```json
[
  {
    "id": "case-01",
    "jd": "Senior Backend Engineer\n\nWe are looking for ...",
    "company_url": "http://localhost:8099/acme/",
    "days": 5
  }
]
```

## Current behavior

- Email addresses are normalized and unique in MongoDB; duplicate registration returns a useful conflict error.
- Passwords are hashed with bcrypt before storage.
- Session IDs are regenerated on successful login and registration, and invalidated on logout.
- Protected API routes reject missing sessions. The frontend returns signed-out users to the login screen.
- The dashboard saves a job title, company website, pasted job description and 1–60 day preparation window, then starts generation in the background.
- History shows generation progress and failures. A ready kit includes the company brief, role requirements, questions, flashcards, schedule, deterministic coverage result, and research gaps.

## Assessment implementation plan

1. **Foundation and authentication (current):** app skeleton, registration/login/logout, sessions, protected dashboard shell, per-user history.
2. **Kit input and persistence (in progress):** validate job description, company URL and days; persist a private draft. Generation state and progress are next.
3. **Research and first generation slice (implemented):** bounded company-site crawl, ranked same-site links, robots.txt checks, optional public interview-discussion search, progress, and source-gap recording.
4. **Structured generation (implemented):** separate role extraction, company brief, and question-category calls; Zod kit validation; flashcards; and an Appendix A shape.
5. **Deterministic quality loop (implemented):** code checks requirement links, generates a second pass for gaps, closes remaining must-have gaps with a transparent deterministic prompt/outline, and allocates integer-minute study days with must-have/harder topics earlier.
6. **Builder and practice (implemented):** inline edits, reorder/add/delete, safe section regeneration, flashcard practice, saved confidence and weakest-first sessions.
7. **Batch evaluator (implemented) and finish:** exact `npm run evaluate -- --input <cases.json> --output <kits.json>`; targeted schedule/coverage/schema tests, deployment and walkthrough remain.

Protect the exact Appendix A names and Appendix B batch command early because the evaluator depends on them. Keep the fourth day as submission slack; the optional feature comes after required behavior.

## Appendix B batch schema

Input is a JSON array. Each case has a caller-provided `id`, pasted `jd`, `company_url`, and integer `days`.

```json
[{"id":"case-01","jd":"Senior Backend Engineer\\n...","company_url":"http://localhost:8099/acme/","days":5}]
```

Output is one JSON object with `version`, ISO timestamp `generated_at`, and `kits`. There is one result per input case: `{id,status,kit,error}`. `status` is `ok` or `failed`; partial research remains `ok` with gaps recorded in the kit. A fully failed case uses `kit: null` and a structured `{code,message}` error. The command must continue after a failed case.

## Appendix A kit schema walkthrough

- `source`: company and URL, role/location, JD character count, research timestamp and pages used.
- `company_brief`: honest summary and what the company does, with source URLs.
- `role`: title, seniority, responsibilities, and requirements. Each requirement has a stable `id`, `text`, `kind` (`technical`, `behavioural`, `domain`) and `priority` (`must`, `nice`).
- `questions`: stable question `id`, linked `requirement_ids`, category, prompt, answer outline and difficulty 1–3.
- `flashcards`: stable `id`, `front`, `back`, and related requirement IDs.
- `schedule`: requested `days_available` and exactly that many day entries; each has day number, focus, question IDs and integer minutes.
- `coverage`: `uncovered_requirement_ids` and number of passes. Every scheduled question ID must exist, and no must requirement should remain uncovered.

These schemas are exact contracts from the assessment, not instructions to make the current login screen generate kits yet.

## Research and generation pipeline

The protected `POST /api/kits` route validates input, persists a `generating` record, and returns immediately. A background task updates a progress string in MongoDB. `GET /api/kits/:id` is scoped to the signed-in user and returns progress, failure details, source gaps, or the generated kit. The dashboard polls while work is active.

The pipeline first reads `robots.txt`, then fetches up to six pages from the supplied origin. It scores discovered links for careers, hiring, about, culture, engineering and handbook content; uses request timeouts, a 500 KB response limit, content-type checks, and a short redirect limit; and records blocked/unavailable sources instead of failing the whole kit. Production rejects private and loopback destinations. Development permits local HTTP sites for fixtures. Public interview discussion uses Tavily when `TAVILY_API_KEY` is set; otherwise the kit records that search gap. These sources are passed to the model as untrusted evidence.

Generation uses the Groq OpenAI-compatible Chat Completions API. The sequence is: extract role requirements from the pasted JD; summarize company facts from retrieved pages; generate technical, behavioural, system-design and company-fit question categories in separate calls; compare question requirement IDs in application code; make one gap-repair pass; create flashcards; allocate the schedule in code; and validate the assembled Appendix A kit with Zod before it is stored. Groq strict JSON Schema mode constrains each model response to the stage's expected shape. A process-wide request gate serializes all Groq calls, uses Groq's token remaining/reset headers to wait for capacity, and retries 429s using `Retry-After`, the reset header, or the retry interval in the provider message. Stage-specific completion limits, requirement batches, and compact evidence keep each request smaller; long job descriptions are extracted in bounded segments. The dashboard reports when it is waiting for provider capacity. A missing Groq key results in a visible failed state, not a fabricated result.

The current allocator sorts must-have topics and harder questions first, then spreads them across exactly the requested number of days. Each question appears in one day; each day receives an integer-minute estimate and has at least 30 minutes. The gap repair is bounded to one model pass; a deterministic question is added for any still-uncovered must-have requirement. Thin postings may yield zero requirements and a correspondingly sparse kit.

### Current limitations

- The crawl uses a small built-in HTML text/link cleaner rather than a browser renderer; JavaScript-only sites may return little useful text.
- Generation runs in the API process rather than a durable queue. Restarting the API during a run can leave a record in `generating`; a persistent job worker/retry button belongs in a follow-up slice.
- Groq call serialization is process-local. If the API is scaled to multiple worker processes, replace it with a shared MongoDB/Redis limiter so all workers coordinate against the organization-wide token budget.
- Progress is recorded when the user rates confidence after revealing a flashcard answer; merely opening or skipping a card does not mark it covered.

## Editable kit state and section regeneration

The editable `generatedKit` remains the canonical persisted kit document. Questions are stored in their displayed array order, so a reorder is a reorder of that array; category is an independent field, so moving a question does not change its identity or its position relative to other questions.

Questions and flashcards carry three provenance fields:

- `origin` is `generated` or `manual`. A hand-added item uses `manual` and starts pinned.
- `edited` becomes true after a user changes generated content. A category move also marks the question edited.
- `pinned` is an explicit user protection for otherwise generated content. Users can pin or unpin an item; manual questions remain protected by their `origin` even if unpinned.

Regeneration writes only its requested section. A question-category regeneration replaces only generated, unedited, unpinned questions in that category. It retains manual, edited, and pinned questions, and leaves all questions in other categories in place. Fresh questions are inserted where the replaced category questions began. Brief regeneration replaces only `company_brief` and its related source list/gaps; schedule regeneration replaces only `schedule`.

Edits use operation-based API requests (edit, move, pin, add, delete, reorder) against the latest MongoDB document. Content updates compare the document version and retry on a concurrent change. A regeneration job stores its own progress/status separately from the kit's ready status, computes model output from a snapshot, then merges that output with the latest kit using the same version check. This prevents an edit made while regeneration is running from being overwritten. If regeneration fails, the last saved section remains intact and the error is recorded separately.

The kit detail endpoint returns the persisted content and regeneration state. The dashboard polls only while initial generation or section regeneration is active. Existing kits created before provenance fields were added receive `generated`, `edited: false`, and `pinned: false` defaults when they are edited, so their existing content remains usable.

### Flashcard practice and progress

Practice progress is persisted separately from `generatedKit`, keyed by flashcard ID, so recording study activity never modifies the kit content. A card becomes covered after the user reveals its answer and saves a low, medium, or high confidence rating. Each record stores the latest confidence, attempt count, and first/most recent practice timestamps. Coverage counts are derived from the current flashcards, so deleted cards do not inflate progress. A new session orders unseen cards first, then low-, medium-, and high-confidence cards; ties preserve the card order in the kit. This transparent confidence-weighted sort is intentionally simpler than spaced repetition and makes the next session easy to explain.

### Provider and retrieval references

- Groq OpenAI-compatible API: https://console.groq.com/docs/openai
- Groq models and rate limits: https://console.groq.com/docs/models and https://console.groq.com/docs/rate-limits
- Tavily Search endpoint: https://docs.tavily.com/documentation/api-reference/endpoint/search

## Auth design rationale

Use an opaque, server-side session stored in MongoDB. It is straightforward to revoke at logout, keeps auth decisions server-controlled, and suits a same-origin web application. Cookies use `HttpOnly`, `SameSite=Lax`, and `Secure` in production. If the frontend/API are deployed on separate sites, cookie and CORS settings must be configured deliberately. Add CSRF protection before enabling cross-site cookie use. Session-backed user identity is checked on every protected API request.

## Design decisions to explain

- The model drafts content; application code validates structure, checks requirement coverage and allocates schedule time.
- Requirements and questions use stable IDs so coverage is machine-checkable.
- Store edit provenance (generated/edited/pinned) per item so section regeneration replaces only generated items and preserves user changes.
- Treat crawled pages as untrusted content, apply URL/content limits, and never treat page text as model instructions.
- For thin postings or missing sources, return a sparse, explicit result rather than inventing facts.

## Current tests

Run `npm test` for API validation and auth behavior checks. Full browser/database end-to-end coverage will be expanded alongside the remaining application slices.
