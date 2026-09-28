# Trao Interview Prep

Current implementation: account registration/login, MongoDB-backed server sessions, a protected dashboard, single and Excel workbook batch job-description/company input, private history, background research and kit generation, an editable kit builder, and flashcard practice.

## Stack

- Next.js + Tailwind CSS for the web UI
- Node.js + Express + TypeScript for the API
- MongoDB + Mongoose for users, kits, and server sessions
- `express-session` with `connect-mongo`; the browser receives only an HttpOnly session cookie
- `bcryptjs` for password hashing and `zod` for request validation

## Project overview and architecture

Trao turns a job description and company website into a private, editable interview-preparation kit. Users can refine the kit, regenerate one section at a time, and practice with confidence-tracked flashcards. The Excel uploader can create several role kits from one workbook.

The selected stack follows the assignment's Next.js, Express, TypeScript, and MongoDB direction. Next.js and Tailwind provide the browser UI; a same-origin `/api/*` rewrite forwards requests to the Express API. The API owns authentication, validation, kit persistence, and generation orchestration. MongoDB stores users, kits, practice progress, and server sessions. Generation runs as a background task in the API process and calls the research providers and Groq before saving the validated result. Keeping Express long-running made it practical to preserve that background flow; the trade-off is documented under limitations.

```text
Browser (Next.js + Tailwind)
  └─ /api/* rewrite → Express + TypeScript API
                         ├─ MongoDB: users, kits, practice, sessions
                         ├─ Company websites + Tavily: research evidence
                         └─ Groq: structured draft generation
```

The model provider is Groq's OpenAI-compatible Chat Completions API. The model used is `openai/gpt-oss-20b` by default; `GROQ_MODEL` can override it.

## Run locally

1. Install Node.js and start MongoDB.
2. Copy `.env.example` to `.env` and set a unique `SESSION_SECRET` (at least 32 characters).
   Add `GROQ_API_KEY` for generation. `TAVILY_API_KEY` enables interview-discussion search and retrieval fallbacks. Groq uses `openai/gpt-oss-20b` by default; set `GROQ_MODEL` to override it.
3. From the repository root, install dependencies and start both workspaces:
   ```sh
   npm ci
   npm run dev
   ```
4. Open http://localhost:3000.

The API runs at http://localhost:4000. Register using full name, email and password. A user's history is always queried with their authenticated user id.

## Public deployment (Vercel + Render + MongoDB Atlas)

The live web app is [interview-prep-kit-web-gamma.vercel.app](https://interview-prep-kit-web-gamma.vercel.app/); its proxied [API health check](https://interview-prep-kit-web-gamma.vercel.app/api/health) confirms the frontend-to-API route. The web app is a Next.js workspace and the API is a long-running Express server. Deploy the web workspace to Vercel and the API workspace as a Render Web Service; use MongoDB Atlas for both kit data and MongoDB-backed sessions. This avoids adapting the Express API and its in-process generation flow to a serverless runtime.

1. Create an Atlas database user and database, then copy the Node.js connection URI. Add the deployment host's outbound IPs to the Atlas IP access list. Use a least-privilege database user and keep the URI private.
2. Create a Render Web Service from the repository root. Build with `npm ci --include=dev && npm run build --workspace @trao/api`; start with `npm run start --workspace @trao/api`; set health check path to `/api/health`. The explicit dev-dependency install is required because TypeScript and Node.js type definitions are build dependencies, even when `NODE_ENV=production` is configured for the service.
3. Add these API service variables in Render: `NODE_ENV=production`, `MONGODB_URI`, a unique random `SESSION_SECRET` (at least 32 characters), `GROQ_API_KEY`, `GROQ_MODEL=openai/gpt-oss-20b`, `TAVILY_API_KEY`, and `WEB_ORIGIN=https://interview-prep-kit-web-gamma.vercel.app`. Render supplies `PORT`.
4. Create a Vercel project from the same repository with Root Directory `apps/web` and the Next.js framework preset. Add `NEXT_PUBLIC_API_URL=/api` and `API_PROXY_TARGET` set to the Render API origin only (for example, `https://trao-api.onrender.com`, without `/api`). The Next.js rewrite proxies `/api/*` to the Express service so browser requests and the HttpOnly session cookie stay on the frontend origin.
5. Deploy both services, then open the Vercel URL and verify `/api/health` through the frontend domain, registration/login, creating a kit, and revisiting history after signing out and back in.

Render's free web services spin down after 15 minutes without inbound traffic and can take about a minute to wake. That can make the first request slow and makes long background generations vulnerable if the UI stops polling; use an always-on instance for a more reliable public demo. Keep all secrets in provider environment settings, never in Git.

### Run the batch evaluator

Create a UTF-8 JSON file containing an array of cases. Each case has a unique caller-provided `id`, pasted `jd`, `company_url`, and integer `days` from 1 to 60. Then run this exact assessment entry point from the repository root:

```sh
npm run evaluate -- --input ./cases.json --output ./kits.json
```

The evaluator loads the same root `.env` as the API and calls the same `generateKit` pipeline, including retrieval, generation, retry/backoff, deterministic coverage repair, schedule allocation, and Zod structure validation. It processes cases sequentially to share the process-wide Groq token gate and reduce bursts against free-tier rate limits. Progress is written to stderr; the output file contains one result for every input case and stays valid when individual cases fail. Invalid cases are recorded as `failed` with `INVALID_CASE`; pipeline failures include a structured error code/message. A partially researched but generated kit remains `ok`, with retrieval gaps in the `kit.source_gaps` extension. The command writes `{ "version": "1.0", "generated_at": "<ISO timestamp>", "kits": [...] }` and continues after case failures.

The dashboard batch uploader accepts an Excel `.xlsx` workbook with one role per row. Its `Roles` worksheet uses `Role title`, `Company website`, `Job description`, and optional `Days until interview (optional)` columns. Long and multi-line descriptions can be pasted into one cell. Blank rows are ignored, each non-empty row is validated and previewed before submission, and optional day values fall back to the dashboard's default-day setting. Uploads support up to 10 roles and 5 MB. Download the user template at `apps/web/public/batch-template.xlsx`. This UI file format is separate from the JSON format required by the evaluator CLI above.

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
- Users can also upload an Excel workbook with up to 10 job description/company pairs; each row creates a separate private kit and may specify its own preparation days.
- History shows generation progress and failures. A ready kit includes the company brief, role requirements, questions, flashcards, schedule, deterministic coverage result, and research gaps.

## Implemented assessment requirements

1. **Foundation and authentication (implemented):** app skeleton, registration/login/logout, sessions, protected dashboard shell, per-user history.
2. **Kit input and persistence (implemented):** validate job description, company URL and days; persist private drafts; upload up to 10 role/company pairs from an Excel workbook; show generation state and progress.
3. **Research and first generation slice (implemented):** bounded company-site crawl, ranked same-site links, robots.txt checks, optional public interview-discussion search, progress, and source-gap recording.
4. **Structured generation (implemented):** separate role extraction, company brief, and question-category calls; Zod kit validation; flashcards; and an Appendix A shape.
5. **Deterministic quality loop (implemented):** code checks requirement links, generates a second pass for gaps, closes remaining must-have gaps with a transparent deterministic prompt/outline, and allocates integer-minute study days with must-have/harder topics earlier.
6. **Builder and practice (implemented):** inline edits, reorder/add/delete, safe section regeneration, flashcard practice, saved confidence and weakest-first sessions.
7. **Batch evaluator and targeted quality tests (implemented):** exact `npm run evaluate -- --input <cases.json> --output <kits.json>`; schedule allocation, coverage checking, and Appendix A validation have focused automated tests. Public deployment is live; the walkthrough video remains as a submission artifact.

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

These schemas are the application's persisted kit contract and the batch evaluator's output contract; keep generated and edited kit data aligned with them.

## Research and generation pipeline

The protected `POST /api/kits` route validates input, persists a `generating` record, and returns immediately. A background task updates a progress string in MongoDB. `GET /api/kits/:id` is scoped to the signed-in user and returns progress, failure details, source gaps, or the generated kit. The dashboard polls while work is active.

The retrieval sources are the user's pasted job description, the supplied company's public website, and (when configured) Tavily Search results for company-specific interview discussions. The crawler reads `robots.txt`, then retrieves up to six same-site pages, prioritizing careers, hiring, about, culture, engineering, and handbook links. If direct access is blocked or times out, or content exceeds the 500 KB read cap, it can use Tavily Extract; a site-restricted Tavily Search is also used as a fallback for inaccessible company homepages. Requests have timeouts, content-type and redirect checks, and production rejects private/loopback destinations. Unavailable sources are recorded as research gaps. Retrieved text is treated as untrusted evidence, never as model instructions.

The research and generation stages run in this order:

1. **Create the draft:** validate the title, company URL, job description, and preparation days; store a `generating` kit and return it to the UI so progress can be polled.
2. **Research:** retrieve company pages and interview discussions, recording source URLs and gaps.
3. **Extract role requirements:** use Groq to identify responsibilities and must-have/nice-to-have requirements from the job description. Long descriptions are split into bounded segments; the API assigns stable requirement IDs.
4. **Write the company brief:** summarize only facts supported by the retrieved company evidence.
5. **Generate question categories:** make separate technical, behavioural, system-design, and company-fit calls as applicable, linking every question to known requirement IDs.
6. **Check and repair coverage:** application code finds uncovered requirements; Groq gets one bounded repair pass, then a deterministic question outline covers any remaining must-have requirement.
7. **Create flashcards and allocate the schedule:** derive cards from requirements/questions and run the deterministic allocator described below.
8. **Validate and save:** Zod validates the assembled Appendix A structure before it is persisted as ready.

Groq strict JSON Schema mode constrains each model response to its stage's expected shape. A process-wide request gate serializes Groq calls, checks provider token-capacity headers, and retries rate limits. Bounded batches and stage-specific completion limits reduce oversized requests. The dashboard reports when it is waiting for provider capacity. A missing Groq key results in a visible failed state rather than fabricated output.

The schedule allocator sorts questions so those linked to must-have requirements come first, then orders by difficulty (harder first) and stable ID. It distributes the sorted questions round-robin across exactly the requested number of days. Each day's minutes are estimated as 20 + 10 × difficulty for each assigned question, with a 30-minute minimum for an empty or short day. This is deterministic and easy to audit; it does not model a user's calendar or vary study time by individual availability. The gap-repair pass is bounded to one model pass; deterministic questions cover remaining must-have requirements. Thin postings may yield zero requirements and a sparse kit.

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

### Creative feature: confidence-weighted practice

The practice session adapts the next review order using the learner's own confidence: unseen cards appear first, followed by cards rated low, medium, then high. Ratings and attempts persist independently of the generated kit, so study progress survives kit edits and does not get overwritten by section regeneration. This adds a repeatable learning loop to the generated content without claiming to implement a full spaced-repetition algorithm.

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

Run `npm test` for API tests, including schedule allocation (exact day count, integer durations, question assignment and priority ordering), requirement coverage checking, Appendix A kit structure and cross-reference validation, research behavior, rate limiting, and auth behavior. Full browser/database end-to-end coverage remains outside this focused suite.
