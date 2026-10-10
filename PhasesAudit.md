# BookGen - Phases Audit

Source of truth for the pipeline: `agentprompts/PipelineExplanation.txt`.
Every phase is tested on 3 points before it is marked complete:
1. The API call is successful
2. The API responded successfully (valid, parseable response)
3. The database was populated with the required data

| Phase | Name | Status |
|---|---|---|
| 0 | Foundation | COMPLETE (confirmed by user) |
| 1 | Call 1 - book concepts worker | COMPLETE (confirmed by user) |
| 2 | Call 2 - book spec per book | COMPLETE (confirmed by user) |
| 3 | Call 3 - images (submit, poll, storage) | COMPLETE (confirmed by user) |
| 4 | UI wiring (realtime, spinners) | COMPLETE (confirmed by user) |
| 5 | Revise page / revise book / add more books | Local UI mock-tested; worker v10 deployed and RPC existence verified; live end-to-end verification pending |
| 6 | Download Book (A4 PDFs + ZIP) | Not started |

---

## Key decisions and facts

- Internal tool, no login for now (RLS policies allow `anon`). Moving to Supabase Pro.
- Supabase project: `https://rmwverpmqedqijxymjvi.supabase.co`
- `BGAPI` is kept as an Edge Function secret and is never in the browser. Call 2 passes it to pg_net as a request header (see Phase 2).
- Browser uses the publishable key from `.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, gitignored).
- Text API: `POST https://apimaster.ai/v1/messages` (verified in Phase 0; `/messages` returns 404).
  - Headers: `x-api-key`, `anthropic-version: 2023-06-01`. Model `claude-fable-5-1`.
  - `max_tokens`: about 16000 for Call 2, about 2000 for the others.
  - Treat `stop_reason === "max_tokens"` as a failure (truncated JSON).
  - Timeout: 120 seconds (380 seconds for Call 2). A timeout counts as one retry.
- Image API: `POST https://apimaster.ai/v1/images/generations/async`, `Authorization: Bearer`.
  - Body: `{"model":"gpt-image-2.5-sunburst","prompt":...,"n":1,"size":"1536x2172"}`.
  - Size `1536x2172` matches the A4 ratio (user-requested; changed from `1536x2048`, briefly `1024x1448`). Verified on worker v8: a generated page image measured exactly 1536x2172.
  - The response contains `data[0].task_id`.
  - Poll `GET /v1/tasks/{task_id}?model=gpt-image-2.5-sunburst` every 3 seconds.
  - Task status:
    - `succeeded` / `success` / `completed`: read `data.result.images[].url`.
    - `failed` / `error` / `cancelled`: stop.
    - Anything else: keep polling.
  - Never resubmit a job that already has a `task_id`. Download result URLs promptly because they expire.
- JSON handling: validate every text response, retry up to 3 times, then strip all `'` from string values after parsing.
- Job system: `generation_jobs` table is the queue.
  - Claim jobs with `SELECT ... FOR UPDATE SKIP LOCKED`.
  - `pg_cron` runs every 1 minute and only invokes the worker when jobs are queued or pending.
  - Each worker run stops after about 50 seconds so runs never overlap.
  - Concurrency: about 3 image tasks and about 2 text calls at once.
  - `pgmq` was intentionally NOT installed because the jobs table is the queue.
- Images: store full resolution in bucket `book-images`. The UI shows a compressed version via Supabase image transformations (Pro). Delete the old file when a page or book is revised.
- Downloads: built in the browser (jsPDF + JSZip). Each image fills an A4 portrait page. The cover is page 0. "Download Kindle" stays a placeholder.
- Prompt files (`agentprompts/`):

  | File | Type | Purpose |
  |---|---|---|
  | `firstapicall.txt` | text | Concepts. Includes `{{EXISTING_BOOKS}}` ("None" for a new campaign). |
  | `secondapicall.txt` | text | Cover prompt and pages for one book. |
  | `thirdapicall.txt` | image | Line 1 = page style, line 3 = cover style. |
  | `revisebookcall.txt` | text | Replaces one book concept. Uses `{{OTHER_BOOKS}}`. |
  | `revisepagecall.txt` | text | Replaces one page. Uses `{{OTHER_PAGES}}`. |

## Button flows

| Button | Flow |
|---|---|
| Create campaign | `firstapicall` → `secondapicall` (per book) → `thirdapicall` (cover + pages) |
| Revise whole book | `revisebookcall` → `secondapicall` → `thirdapicall` |
| Revise Page only | `revisepagecall` → `thirdapicall` |
| Add more books | `firstapicall` (with `{{EXISTING_BOOKS}}`) → `secondapicall` → `thirdapicall` |

New books from "Add more books" continue numbering after the last existing book.

---

## Phase 0 - Foundation (COMPLETE)

**Built**
- Extensions: `pg_cron`, and `pg_net` (in schema `extensions`).
- Tables, all with RLS enabled, cascading deletes, and realtime publication:
  - `campaigns`: name, category, theme, age_range, book_count (1-100), status
  - `books`: campaign_id, book_number, title, description, cover_image_prompt, cover_image_path, status
  - `pages`: book_id, page_number, title, description, image_prompt, image_path, status
  - `generation_jobs`: campaign_id, job_type, target_id, payload, status, attempts, task_id, raw_response, last_error, locked_at
- Statuses:
  - Rows: `queued` / `processing` / `succeeded` / `failed`
  - Jobs: the same, plus `awaiting_task`
- Job types: `concepts`, `book_spec`, `cover_image`, `page_image`, `revise_page`, `revise_book`.
- `anon` permissions:
  - `campaigns`: select, insert, delete
  - `books` and `pages`: select, update
  - `generation_jobs`: select only. Inserts are blocked by RLS (verified).
- Trigger `campaigns_enqueue_concepts`: inserting a campaign queues a `concepts` job.
- Storage bucket `book-images` (public).
- App:
  - `@supabase/supabase-js@2.117.3` (pinned).
  - `src/lib/supabase.js` provides the client and the `toCampaign` row mapper.
  - `src/App.jsx` loads, creates, and deletes campaigns in the DB.
- Visual tests (`tests/visual.spec.js`) mock `/rest/v1/campaigns` in memory, so tests never touch the real DB or trigger paid AI jobs.
- Test Edge Function `phase0-ping`:
  - Body `{"only":"text"}`: text API check.
  - Body `{"only":"image"}`: image API check. This generates one real image (costs credits).
  - Body `{}`: both checks.

**Test results**

| Test | Result |
|---|---|
| Text API | `/v1/messages` returned 200, `stop_reason` was `end_turn`, and the reply `{"ok":true}` parsed as JSON. |
| Image API | Submit returned 200 with a `task_id`. Poll returned 200 with status `succeeded` and an image URL. Size `1536x2048` was accepted. |
| Database | Inserting with the publishable key created the campaign row, and the trigger queued the `concepts` job. Anon job insert was rejected by RLS. Deleting the campaign cascaded to the job. |
| Advisors | Security: clean (`pg_net` was moved out of `public`). Performance: only "unused index" notes, which is expected on empty tables. |
| Visual | 30/30 screenshots passed with no visual change. |

---

## Phase 1 - Call 1: book concepts worker (COMPLETE)

**Plan**
- Edge Function `worker` claims queued `concepts` jobs with `FOR UPDATE SKIP LOCKED`.
- Fill `firstapicall.txt` with the campaign data (`{{EXISTING_BOOKS}}` = "None" for a new campaign).
- Call `/v1/messages` with a 120-second timeout and `max_tokens` 2000.
- Validate the response:
  - it is valid JSON;
  - it is not truncated;
  - the book count equals `book_count`.
  Retry up to 3 times, then strip `'` from all string values.
- Insert one `books` row per concept (book_number, title, description).
- Store `raw_response` on the job. Set the job and campaign status to `succeeded` or `failed`.
- `pg_cron` runs every minute and invokes the worker only when jobs are queued.

**Tests**
1. Create a small campaign (2 books).
2. API call: the job reaches `succeeded`.
3. API response: `raw_response` is stored and parsed correctly.
4. Database: `books` has 2 rows with titles and descriptions.

**Built**
- Migration `phase1_worker_queue`:
  - Vault secret `worker_secret` (random). The worker requires it in the `x-worker-secret` header.
  - Schema `private` (no access for `public` / `anon` / `authenticated`).
  - RPCs (EXECUTE granted to `service_role` only):
    - `claim_jobs(job_types, max_running, stale = 6 min)`: advisory lock + `FOR UPDATE SKIP LOCKED`. Respects the concurrency cap, reclaims stale `processing` jobs, and increments `attempts`.
    - `fail_job(job_id, error, raw, max_attempts = 3)`: re-queues until 3 attempts, then `failed`. A failed `concepts` job also fails the campaign.
    - `finish_concepts_job(job_id, books, raw)`: inserts books (numbering continues after the last existing book), stores `raw_response`, and sets the job and campaign to `succeeded`.
    - `worker_secret_ok(secret)`: checks the header against Vault.
  - `private.invoke_worker()`: does nothing unless a job is `queued`, `awaiting_task`, or stale `processing`. Otherwise `net.http_post` to the worker.
  - Cron job `bookgen-worker`: `* * * * *` → `select private.invoke_worker()`.
- Edge Function `worker` (`verify_jwt` off, secret header instead):
  - `supabase/functions/worker/index.ts`: claims up to 2 text jobs, returns 202, and runs them in the background (`EdgeRuntime.waitUntil`).
  - `supabase/functions/worker/prompts.ts`: copy of `agentprompts/firstapicall.txt`. Keep in sync when the prompt changes.
  - Concepts job: fills the prompt (`{{EXISTING_BOOKS}}` = "None" or the current list), calls `/v1/messages` (120 s timeout, `max_tokens` = max(2000, 150 × books)), strips code fences, and validates the JSON, the book count, sequential numbers, and non-empty title/description. Then strips apostrophes (`'`, `‘`, `’`).

**Test results**

| Test | Result |
|---|---|
| Auth | POST with a wrong secret returned 401. |
| API call | Cron invoked the worker (pg_net 202). The job reached `succeeded` on attempt 1 with no `last_error`. |
| API response | `raw_response` was stored (5180 chars) and parsed into 2 valid concepts. No apostrophes remain. |
| Database | Campaign "Phase 1 Test" (2 books) has status `succeeded`. `books` has 2 rows: #1 "Coral City Clean-Up Crew", #2 "The Deep-Sea Lantern Parade", both with descriptions and status `queued`. |
| Advisors | Security: clean. Performance: only an "unused index" note on `pages_book_id_idx` (expected until Phase 2). |

## Phase 2 - Call 2: book spec per book (COMPLETE)
- For each book, queue a `book_spec` job.
- Fill `secondapicall.txt`, then call with a 300-second timeout and `max_tokens` 16000.
- Validate, retry, and strip apostrophes.
- Save `cover_image_prompt` on the book and insert the `pages` rows.
- Measure the real Call 2 duration and adjust the timeout if needed.
- **Tests:** the job succeeds, the JSON is valid, and the book has a cover prompt plus `PAGE_COUNT` pages.

**Built**
- Why pg_net: Free-plan Edge Functions are stopped after about 150 s, and Call 2 takes about 250-300 s. So the worker builds the request and the database makes the call.
- Migration `phase2_pg_net_text_calls`:
  - `start_http_job(job_id, url, headers, body, timeout_ms)`: `net.http_post`, stores the request id in `task_id`, and sets the status to `awaiting_task`.
  - `claim_jobs` counts `awaiting_task` jobs toward the cap of 2.
- Migration `phase2_book_spec`:
  - `finish_concepts_job` also queues one `book_spec` job per new book.
  - `finish_book_spec_job(job_id, cover_prompt, pages, raw)`: saves `cover_image_prompt`, inserts 30 `pages` rows, and sets the job and book to `succeeded`.
  - `fail_job` handles `book_spec`: after 3 attempts the book is set to `failed`.
  - `private.refresh_campaign_status`.
- Migration `phase2_collect_queue_aware`, `collect_http_jobs(lost_after = 7 min)`:
  - Picks up `awaiting_task` jobs whose pg_net response has arrived.
  - Treats a job as lost only if it is older than 7 minutes **and** no longer in `net.http_request_queue`.
- Worker v4:
  - Each run collects finished calls first, then claims `concepts` and `book_spec` jobs.
  - Call 2 runs with a **380 s** timeout (raised from the spec's 300 s, user decision) and `max_tokens` 16000.
  - The reply is validated: valid JSON, a cover prompt, 30 pages numbered in order, and non-empty fields. Apostrophes are stripped.
  - Timeouts, HTTP errors, truncation, and invalid JSON each use one of the 3 attempts.
- Known trade-offs (user chose to keep them):
  - pg_net works in batches. While a long Call 2 is in flight, the cron's worker calls wait behind it.
  - `BGAPI` is passed as a request header through pg_net, so it sits briefly in `net.http_request_queue`, which only the service role can read. It is still never in the browser.

**Test results**

| Test | Result |
|---|---|
| API call | Campaign "Phase 2 Test" (2 books): both `book_spec` jobs reached `succeeded`, each on attempt 2. |
| Retries | Book 2's attempt 1 hit the old 300 s timeout. Book 1's attempt 1 returned HTTP 200, but the model's JSON was invalid (unquoted key). Both retries succeeded. |
| API response | Valid JSON: 28373 bytes and 22887 bytes. About 8.5k output tokens, `stop_reason` `end_turn`. |
| Database | Both books are `succeeded`, each with a `cover_image_prompt` and 30 `pages` rows. The campaign is `succeeded` and the pg_net queue is empty. |
| Duration | About 250 s and about 272 s for the successful calls. One call went over 300 s, so the timeout was raised to 380 s. |
| Advisors | Security and performance: clean. |

## Phase 3 - Call 3: images
- Queue `cover_image` and `page_image` jobs. The prompt is the line from `thirdapicall.txt` plus the stored prompt.
- Submit, then store `task_id` with status `awaiting_task`.
- Poll every 3 seconds within the 50-second worker window.
- On success, download the image and upload it to `book-images`, then set `image_path` / `cover_image_path`.
- Concurrency cap: about 3 image tasks at once.
- **Tests:** submit 200, poll `succeeded`, the file exists in the bucket, and the path is saved on the row.

**Built**
- Migration `phase3_image_jobs`:
  - `finish_book_spec_job` now also queues 1 `cover_image` job (queued first) and 30 `page_image` jobs.
  - `start_image_task(job_id, task_id)`: stores `task_id` and sets `awaiting_task`.
  - `lease_image_tasks(lease = 55 s)` / `release_image_tasks(job_ids)`: hand in-flight tasks from one worker run to the next without double polling.
  - `finish_image_job(job_id, path, raw)`: sets `cover_image_path` / `image_path` and the job to `succeeded`. Returns the old path so the file can be deleted.
  - `fail_job` clears `task_id`, so a retry submits a new task.
  - `private.refresh_book_status`: book and campaign status come from their job states.
  - `collect_http_jobs` is limited to `book_spec` jobs. Index `generation_jobs_target_id_idx` was added.
- Migration `grant_private_helpers_to_service_role`: the service role can run `private.refresh_book_status` and `private.job_book_id`. The `private` schema is not exposed through the API.
- Worker v6:
  - Text and image work run side by side in each run.
  - Prompt = stored prompt + `thirdapicall.txt` style line. The page style has `{{AGE_RANGE}}` filled from the campaign.
  - Up to 3 image tasks in flight. Submit timeout is 60 s (it was 30 s, which timed out).
  - Each task is polled every 3 s inside a 48 s window. No new submits are sent in the last 15 s. Unfinished tasks are released to the next run.
  - A task is given up after 10 minutes.
  - On success, the image is downloaded and uploaded to `book-images/{campaign}/{book}/cover-{job}.png` or `page-NN-{job}.png`. The path is then saved and any old file is deleted.

**Test results** (1 cover + pages 1-2 of "Phase 2 Test" book 1, queued manually)

| Test | Result |
|---|---|
| Attempt 1 | Two submits hit the old 30 s timeout. One image was generated, but saving its path failed (`permission denied for function refresh_book_status`) and the uploaded file was removed. After the grant, attempt 2 passed (still on worker v5). The submit timeout was raised to 60 s in v6 to avoid the 30 s timeouts; this has not been tested yet. |
| Submit | Attempt 2: all 3 submits returned 200 and a `task_id` was stored on each job. |
| Poll | All 3 tasks reached `succeeded` within the same run, and each job is `succeeded`. |
| Storage | 3 PNGs are in `book-images`: cover 7.2 MB, page 1 3.5 MB, page 2 3.2 MB. The cover was checked visually: full-color cartoon with clear space for the title. |
| Database | `cover_image_path` and both `image_path` values point to the stored files. Book and campaign status are `succeeded`. |
| Advisors | Security and performance: clean. |

## Phase 4 - UI wiring
- `CampaignPage` reads books and pages from the DB, with Realtime status updates and spinners.
- Books are listed in the right sidebar and pages in the bottom carousel. The first book and first page are selected by default.
- Compressed previews come from image transformations.
- Title edits save to the DB.
- **Tests:** visual workflow screenshots for each new state, with the API mocked.

### Built
- `src/lib/supabase.js`: `imageUrl(path, width)` returns a transformed (`/render/image/`, quality 70) URL from `book-images`; `upsertRow` merges a Realtime row into a sorted list.
- `src/components/CampaignPage.jsx`:
  - Loads campaign status and books (ordered by `book_number`); one Realtime channel per campaign for `campaigns` UPDATE and `books` changes.
  - Loads pages of the selected book (ordered by `page_number`); one Realtime channel per selected book for `pages` changes.
  - The carousel shows the cover first, then the pages. The first book and its cover are selected on load and whenever a book is clicked.
  - Previews use 900 px images, thumbnails 300 px (lazy loaded).
  - Spinners: "Generating book concepts..." (no books yet), "Writing pages..." (book pending, no pages), "Generating illustration..." (item pending), and on pending book status badges. Failed states show "Could not generate book concepts.", "Page generation failed.", or "Failed".
  - Book and page title/description edits save on blur, sending only changed fields. Realtime updates do not overwrite the field being edited.
  - The page editor is disabled on the cover (the cover uses the book title).
- `src/components/CampaignPage.css`: spinner, image fill, label overlays, gallery header note, disabled inputs.
- `tests/visual.spec.js`: mocks `books`, `pages`, the campaign `.single()` lookup, storage render URLs (generated SVGs), and the Realtime socket.

### Test results
| Test | Result |
|---|---|
| Visual states | New screenshots: concepts generating, concepts failed, writing pages, book mode, illustrations generating, book ready with page 2 selected (incl. a failed page), failed book selected. All 5 projects (desktop Chromium/Firefox/WebKit, mobile Chromium/WebKit). Reviewed; no layout issues. |
| Title save | Editing the middle book title and blurring sends one PATCH `{ title }` for that book; the sidebar updates. |
| Suite | 60/60 passed. |

## Phase 5 - Revise page / revise book / add more books

### Local implementation (2026-10-10)
- Referenced `agentprompts/PipelineExplanation.txt`, `revisebookcall.txt`, and `revisepagecall.txt`. No relevant BookGen PDF was found in the project or its parent code directory; unrelated PDFs were not used as specifications.
- Read the worker directory and both local deployment files before assessing deployment. Existing `supabase/functions/worker/index.ts` and `prompts.ts` contain whole-book/page revision handlers and concepts `payload.count` handling. These files were left unchanged.
- Whole-book handling calls `finish_revise_book_job` and removes returned old image paths. Page revision calls `finish_revise_page_job`; successful image replacement calls `finish_image_job` and removes the old path. Storage cleanup failures are logged; actual cleanup was not tested in this pass.
- `src/components/CampaignPage.jsx` now calls `request_revise_book(p_book_id)`, `request_revise_page(p_page_id)`, and `request_add_books(p_campaign_id, p_count)`.
- A synchronous request guard prevents duplicate in-flight submissions. Controls show requesting text and `aria-busy`, then reflect queued status after acceptance. Pending targets disable revision, and the cover cannot be revised as a page. Errors use the existing alert convention and allow retry.
- Add-book count is normalized to an integer from 1 to 100. Disabled controls use the existing design with reduced opacity.

### Verification

| Check | Result |
|---|---|
| Production build | `npm run build` passed. |
| Mocked RPC flows | Six new tests across five projects (30 cases) verify RPC names/arguments, cover disabling, count normalization, in-flight/queued disabling, one request after repeated clicks, error alerts, and successful retry. Other-book title remains visible; this does not prove database target isolation. |
| Initial visual run | `npm run test:visual`: 74 passed, 16 failed; new baselines were missing and two mobile WebKit tests timed out. |
| Baseline update | `npm run test:visual:update -- --workers=4`: 90 passed. |
| Final visual comparison | `npm run test:visual -- --workers=4`: 90 passed (1.3 minutes). |
| Screenshot inspection | Reviewed all 65 campaign screenshots: seven existing states and six new submitting/queued states across desktop Chromium/Firefox/WebKit and mobile Chromium/WebKit. No clipping, overflow, alignment, or mobile layout issues found; desktop revision labels wrap within their buttons and mobile galleries remain horizontally scrollable. |
| Lint | `npm run lint`: 0 errors, 1 existing `react(set-state-in-effect)` warning for `setPages([])` in the selected-book effect. |
| UI detector | No findings for the changed component and stylesheet. |
| Paid generation / committed jobs | None invoked or enqueued. Browser tests mock API, storage, and Realtime requests. |

### Worker deployment and remote checks (2026-10-10)
- Supabase MCP was available. Used `deploy_edge_function` through `functions.run_mcp`; no CLI deployment was attempted in this pass.
- The first deployment returned ACTIVE v9 but mistakenly contained a shortened implementation and prompts, rather than the requested exact local files. It was immediately superseded by a corrective deployment containing the full unchanged local `supabase/functions/worker/index.ts` and `prompts.ts` contents. Final deployment returned ACTIVE v10, entrypoint `index.ts`, `verify_jwt: false`, bundle SHA-256 `57253ba696eae73964a440a31e023bd7a89ee7f628d9e791871f0ca78f68f4e2`.
- `list_edge_functions` independently confirmed worker ACTIVE v10 with `verify_jwt: false`. `get_edge_function` also returned v10 and source contents, although its tool output was truncated; no complete byte-for-byte retrieval comparison is claimed. Custom `worker_secret_ok` authentication remains in the deployed entrypoint. No authenticated worker invocation was made.
- Read-only `execute_sql` against `pg_proc`/`pg_namespace` verified all three public RPCs exist: `request_revise_book(p_book_id uuid)`, `request_revise_page(p_page_id uuid)`, and `request_add_books(p_campaign_id uuid, p_count integer)`. This verifies existence/signatures, not execution or migration history.
- `get_advisors(type: security)` returned two WARN categories with three findings each (six findings total): all three request RPCs are executable as `SECURITY DEFINER` by both `anon` and `authenticated`. The existing no-login internal-tool decision explains intended anon access, but the warnings remain unresolved. Database permissions/schema were not changed.
  - [Anon SECURITY DEFINER remediation](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
  - [Authenticated SECURITY DEFINER remediation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- No paid AI calls, generation requests, or committed jobs were initiated by this pass. Existing cron activity during the brief incorrect v9 deployment was not checked, so no claim about its effects is made.
- Deployment and the requested read-only remote checks are complete. Phase 5 live end-to-end verification remains pending: worker processing, database target isolation, appended numbering, and actual old/new storage file behavior have not been tested here. No rollback SQL or paid end-to-end tests are claimed.
- No rendered UI or worker source files were changed locally in this pass; the prior 90/90 mocked visual result and production build result above were not rerun.

## Phase 6 - Download Book
- Build in the browser with jsPDF and JSZip: one A4 portrait PDF per book, with the cover as page 0 and each image filling the page.
- The ZIP is used for the "All Books" scope.
- Download Kindle remains a placeholder.
- **Tests:** the ZIP/PDF opens, the page count is cover + pages, and the images fill A4 portrait.
