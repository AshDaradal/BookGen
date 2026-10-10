import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import {
  COVER_IMAGE_STYLE,
  FIRST_API_CALL,
  PAGE_IMAGE_STYLE,
  REVISE_BOOK_CALL,
  REVISE_PAGE_CALL,
  SECOND_API_CALL,
} from "./prompts.ts";

const BGAPI = Deno.env.get("BGAPI") ?? "";
const API_BASE = "https://apimaster.ai";
const TEXT_MODEL = "claude-fable-5-1";
const MAX_ATTEMPTS = 3;
const MAX_TEXT_JOBS = 2;
const TEXT_JOB_TYPES = ["concepts", "book_spec", "revise_book", "revise_page"];
const TEXT_TIMEOUT_MS = 120_000;
const BOOK_SPEC_TIMEOUT_MS = 380_000;
const BOOK_SPEC_MAX_TOKENS = 16_000;
const PAGE_COUNT = 30;
const IMAGE_MODEL = "gpt-image-2.5-sunburst";
const IMAGE_SIZE = "1536x2172";
const IMAGE_JOB_TYPES = ["cover_image", "page_image"];
const MAX_IMAGE_TASKS = 3;
const IMAGE_BUCKET = "book-images";
const POLL_INTERVAL_MS = 3_000;
const RUN_WINDOW_MS = 48_000; // each run stops polling after this, so runs never overlap
const CLAIM_MIN_LEFT_MS = 15_000; // do not submit new tasks this close to the end of the window
const IMAGE_GIVE_UP_MS = 10 * 60_000; // a task still not done after this is failed (and resubmitted)

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

type Job = {
  id: string;
  campaign_id: string;
  job_type: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
};

// An error that carries the raw API response so it can be stored on the job.
class JobError extends Error {
  constructor(message: string, public raw: string | null = null) {
    super(message);
  }
}

const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/{{(\w+)}}/g, (m, key) => (key in vars ? String(vars[key]) : m));

// Remove every single quote / apostrophe from all string values (done after parsing).
function stripApostrophes<T>(value: T): T {
  if (typeof value === "string") return value.replace(/['\u2018\u2019]/g, "") as T;
  if (Array.isArray(value)) return value.map(stripApostrophes) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, stripApostrophes(v)]),
    ) as T;
  }
  return value;
}

const TEXT_URL = `${API_BASE}/v1/messages`;
const TEXT_HEADERS = {
  "x-api-key": BGAPI,
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
};
const textBody = (prompt: string, maxTokens: number) => ({
  model: TEXT_MODEL,
  max_tokens: maxTokens,
  messages: [{ role: "user", content: prompt }],
});

// Calls the text API directly (short calls only) and returns the parsed JSON the model produced.
async function callTextJson(prompt: string, maxTokens: number, timeoutMs: number) {
  let res: Response;
  try {
    res = await fetch(TEXT_URL, {
      method: "POST",
      headers: TEXT_HEADERS,
      body: JSON.stringify(textBody(prompt, maxTokens)),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    throw new JobError(timedOut ? `Text API timed out after ${timeoutMs / 1000}s` : `Text API request failed: ${e}`);
  }
  return parseTextReply(res.status, await res.text());
}

// Turns a text API HTTP response into the parsed JSON the model produced.
function parseTextReply(status: number, raw: string) {
  if (status < 200 || status >= 300) throw new JobError(`Text API HTTP ${status}`, raw);

  let body: { content?: { type: string; text?: string }[]; stop_reason?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    throw new JobError("Text API returned a non-JSON body", raw);
  }
  if (body.stop_reason === "max_tokens") throw new JobError("Response truncated (stop_reason max_tokens)", raw);

  const text = (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return { raw, data: JSON.parse(unfenced) as unknown };
  } catch {
    throw new JobError("Model reply is not valid JSON", raw);
  }
}

type Concept = { book_number: number; title: string; description: string };

function validateConcepts(data: unknown, count: number, raw: string): Concept[] {
  const books = (data as { books?: unknown })?.books;
  if (!Array.isArray(books)) throw new JobError("Reply has no books array", raw);
  if (books.length !== count) throw new JobError(`Expected ${count} books, got ${books.length}`, raw);
  books.forEach((b, i) => {
    if (b?.book_number !== i + 1) throw new JobError(`Book ${i + 1} has book_number ${b?.book_number}`, raw);
    for (const field of ["title", "description"]) {
      if (typeof b[field] !== "string" || !b[field].trim()) {
        throw new JobError(`Book ${i + 1} is missing ${field}`, raw);
      }
    }
  });
  return books as Concept[];
}

// Call 1: generate book concepts for a campaign and insert them as books.
async function processConcepts(job: Job) {
  const { data: campaign, error } = await db.from("campaigns").select("*").eq("id", job.campaign_id).single();
  if (error) throw new JobError(`Campaign not found: ${error.message}`);
  await db.from("campaigns").update({ status: "processing" }).eq("id", campaign.id);

  const { data: existing } = await db
    .from("books")
    .select("book_number, title, description")
    .eq("campaign_id", campaign.id)
    .order("book_number");
  const existingBooks = existing?.length
    ? existing.map((b) => `${b.book_number}. ${b.title} - ${b.description}`).join("\n")
    : "None";

  // "Add more Books" jobs carry their own count; the first job uses the campaign's.
  const count = Number(job.payload?.count ?? campaign.book_count);
  const prompt = fill(FIRST_API_CALL, {
    BOOK_COUNT: count,
    CATEGORY: campaign.category,
    THEME: campaign.theme,
    AGE_RANGE: campaign.age_range,
    EXISTING_BOOKS: existingBooks,
  });

  // About 2000 tokens, scaled up for large campaigns so the JSON is not truncated.
  const maxTokens = Math.max(2000, count * 150);
  const { raw, data } = await callTextJson(prompt, maxTokens, TEXT_TIMEOUT_MS);
  const books = stripApostrophes(validateConcepts(data, count, raw));

  const { data: inserted, error: finishError } = await db.rpc("finish_concepts_job", {
    p_job_id: job.id,
    p_books: books,
    p_raw: raw,
  });
  if (finishError) throw new JobError(`Saving books failed: ${finishError.message}`, raw);
  console.log(`concepts job ${job.id}: inserted ${inserted} books`);
}

const isText = (v: unknown) => typeof v === "string" && v.trim().length > 0;

type PageSpec = { page_number: number; title: string; description: string; image_prompt: string };

function validateBookSpec(data: unknown, raw: string) {
  const { book, pages } = (data ?? {}) as { book?: Record<string, unknown>; pages?: unknown };
  if (!book || typeof book !== "object") throw new JobError("Reply has no book object", raw);
  if (!isText(book.cover_image_prompt)) throw new JobError("Book is missing cover_image_prompt", raw);
  if (!Array.isArray(pages)) throw new JobError("Reply has no pages array", raw);
  if (pages.length !== PAGE_COUNT) throw new JobError(`Expected ${PAGE_COUNT} pages, got ${pages.length}`, raw);
  pages.forEach((p, i) => {
    if (p?.page_number !== i + 1) throw new JobError(`Page ${i + 1} has page_number ${p?.page_number}`, raw);
    for (const field of ["title", "description", "image_prompt"]) {
      if (!isText(p[field])) throw new JobError(`Page ${i + 1} is missing ${field}`, raw);
    }
  });
  return { coverPrompt: book.cover_image_prompt as string, pages: pages as PageSpec[] };
}

// Call 2 (start): build the prompt and hand the request to pg_net, which can wait the
// full timeout without being bound by the Edge Function wall-clock limit.
async function startBookSpec(job: Job) {
  const { data: book, error } = await db
    .from("books")
    .select("id, title, description, campaigns(category, theme, age_range)")
    .eq("id", job.target_id)
    .single();
  if (error) throw new JobError(`Book not found: ${error.message}`);
  await db.from("books").update({ status: "processing" }).eq("id", book.id);

  const campaign = book.campaigns as unknown as { category: string; theme: string; age_range: string };
  const prompt = fill(SECOND_API_CALL, {
    CATEGORY: campaign.category,
    THEME: campaign.theme,
    AGE_RANGE: campaign.age_range,
    PAGE_COUNT,
    BOOK_TITLE: book.title,
    BOOK_DESCRIPTION: book.description,
  });

  const { error: startError } = await db.rpc("start_http_job", {
    p_job_id: job.id,
    p_url: TEXT_URL,
    p_headers: TEXT_HEADERS,
    p_body: textBody(prompt, BOOK_SPEC_MAX_TOKENS),
    p_timeout_ms: BOOK_SPEC_TIMEOUT_MS,
  });
  if (startError) throw new JobError(`Sending Call 2 failed: ${startError.message}`);
  console.log(`book_spec job ${job.id}: request sent`);
}

// Call 2 (finish): validate the pg_net response and save the cover prompt and pages.
async function finishBookSpec(job: CollectedJob) {
  if (!job.has_response) throw new JobError(`Text API gave no response after ${job.waited_seconds}s`);
  if (job.timed_out) throw new JobError(`Text API timed out after ${BOOK_SPEC_TIMEOUT_MS / 1000}s`);
  if (job.error_msg && !job.status_code) throw new JobError(`Text API request failed: ${job.error_msg}`);

  const { raw, data } = parseTextReply(job.status_code ?? 0, job.content ?? "");
  const spec = stripApostrophes(validateBookSpec(data, raw));

  const { data: inserted, error: finishError } = await db.rpc("finish_book_spec_job", {
    p_job_id: job.id,
    p_cover_prompt: spec.coverPrompt,
    p_pages: spec.pages,
    p_raw: raw,
  });
  if (finishError) throw new JobError(`Saving pages failed: ${finishError.message}`, raw);
  console.log(`book_spec job ${job.id}: call took about ${job.waited_seconds}s, inserted ${inserted} pages`);
}

type Campaign = { category: string; theme: string; age_range: string };

// Revise whole book (step 1): new title + description, then the DB drops the old
// cover/pages and queues Call 2. The old image files are deleted here.
async function processReviseBook(job: Job) {
  const { data: book, error } = await db
    .from("books")
    .select("id, campaign_id, title, description, campaigns(category, theme, age_range)")
    .eq("id", job.target_id)
    .single();
  if (error) throw new JobError(`Book not found: ${error.message}`);
  const { data: others } = await db
    .from("books")
    .select("book_number, title, description")
    .eq("campaign_id", book.campaign_id)
    .neq("id", book.id)
    .order("book_number");

  const campaign = book.campaigns as unknown as Campaign;
  const prompt = fill(REVISE_BOOK_CALL, {
    CATEGORY: campaign.category,
    THEME: campaign.theme,
    AGE_RANGE: campaign.age_range,
    CURRENT_BOOK_TITLE: book.title,
    CURRENT_BOOK_DESCRIPTION: book.description,
    OTHER_BOOKS: others?.length
      ? others.map((b) => `${b.book_number}. ${b.title} - ${b.description}`).join("\n")
      : "None",
  });

  const { raw, data } = await callTextJson(prompt, 2000, TEXT_TIMEOUT_MS);
  const revised = (data as { book?: Record<string, unknown> })?.book;
  if (!revised || !isText(revised.title) || !isText(revised.description)) {
    throw new JobError("Reply has no book with title and description", raw);
  }
  const { title, description } = stripApostrophes(revised as { title: string; description: string });

  const { data: oldPaths, error: finishError } = await db.rpc("finish_revise_book_job", {
    p_job_id: job.id,
    p_title: title,
    p_description: description,
    p_raw: raw,
  });
  if (finishError) throw new JobError(`Saving revised book failed: ${finishError.message}`, raw);
  await removeFiles(job, oldPaths as string[]);
  console.log(`revise_book job ${job.id}: new title "${title}", deleted ${(oldPaths as string[]).length} old files`);
}

// Revise page (step 1): new title, description and image prompt, then the DB queues the image.
// The old image file is deleted when the new one is saved (finish_image_job returns it).
async function processRevisePage(job: Job) {
  const { data: page, error } = await db
    .from("pages")
    .select("id, book_id, page_number, title, description, books(title, description, campaigns(category, theme, age_range))")
    .eq("id", job.target_id)
    .single();
  if (error) throw new JobError(`Page not found: ${error.message}`);
  const { data: others } = await db
    .from("pages")
    .select("page_number, title, description")
    .eq("book_id", page.book_id)
    .neq("id", page.id)
    .order("page_number");

  const book = page.books as unknown as { title: string; description: string; campaigns: Campaign };
  const prompt = fill(REVISE_PAGE_CALL, {
    CATEGORY: book.campaigns.category,
    THEME: book.campaigns.theme,
    AGE_RANGE: book.campaigns.age_range,
    BOOK_TITLE: book.title,
    BOOK_DESCRIPTION: book.description,
    PAGE_NUMBER: page.page_number,
    CURRENT_PAGE_TITLE: page.title,
    CURRENT_PAGE_DESCRIPTION: page.description,
    OTHER_PAGES: others?.length
      ? others.map((p) => `${p.page_number}. ${p.title} - ${p.description}`).join("\n")
      : "None",
  });

  const { raw, data } = await callTextJson(prompt, 2000, TEXT_TIMEOUT_MS);
  const revised = (data as { page?: Record<string, unknown> })?.page;
  if (!revised || typeof revised !== "object") throw new JobError("Reply has no page object", raw);
  if (revised.page_number !== page.page_number) {
    throw new JobError(`Expected page_number ${page.page_number}, got ${revised.page_number}`, raw);
  }
  for (const field of ["title", "description", "image_prompt"]) {
    if (!isText(revised[field])) throw new JobError(`Page is missing ${field}`, raw);
  }
  const spec = stripApostrophes(revised as PageSpec);

  const { error: finishError } = await db.rpc("finish_revise_page_job", {
    p_job_id: job.id,
    p_title: spec.title,
    p_description: spec.description,
    p_image_prompt: spec.image_prompt,
    p_raw: raw,
  });
  if (finishError) throw new JobError(`Saving revised page failed: ${finishError.message}`, raw);
  console.log(`revise_page job ${job.id}: page ${page.page_number} -> "${spec.title}"`);
}

async function removeFiles(job: Job, paths: string[]) {
  if (!paths.length) return;
  const { error } = await db.storage.from(IMAGE_BUCKET).remove(paths);
  if (error) console.error(`job ${job.id}: deleting old files failed: ${error.message}`);
}

type CollectedJob = Job & {
  has_response: boolean;
  status_code: number | null;
  content: string | null;
  timed_out: boolean | null;
  error_msg: string | null;
  waited_seconds: number;
};

async function failJob(job: Job, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  const raw = e instanceof JobError ? e.raw : null;
  const { data: status } = await db.rpc("fail_job", {
    p_job_id: job.id,
    p_error: message,
    p_raw: raw,
    p_max_attempts: MAX_ATTEMPTS,
  });
  console.error(`job ${job.id} (${job.job_type}) attempt ${job.attempts} failed -> ${status}: ${message}`);
}

async function runJob(job: Job) {
  try {
    if (job.attempts > MAX_ATTEMPTS) throw new JobError("Worker stopped before the job finished");
    switch (job.job_type) {
      case "concepts":
        await processConcepts(job);
        break;
      case "book_spec":
        await startBookSpec(job);
        break;
      case "revise_book":
        await processReviseBook(job);
        break;
      case "revise_page":
        await processRevisePage(job);
        break;
      default:
        throw new JobError(`Unsupported job type ${job.job_type}`);
    }
  } catch (e) {
    await failJob(job, e);
  }
}

async function finishCollected(job: CollectedJob) {
  try {
    if (job.job_type !== "book_spec") throw new JobError(`Unsupported collected job type ${job.job_type}`);
    await finishBookSpec(job);
  } catch (e) {
    await failJob(job, e);
  }
}

async function runText() {
  // First finish any pg_net calls whose responses have arrived.
  const { data: collected, error: collectError } = await db.rpc("collect_http_jobs");
  if (collectError) console.error(`collect_http_jobs failed: ${collectError.message}`);
  else await Promise.allSettled((collected as CollectedJob[]).map(finishCollected));

  // Text jobs are claimed once per run; the DB caps how many run at once across all runs.
  const { data: jobs, error } = await db.rpc("claim_jobs", {
    p_job_types: TEXT_JOB_TYPES,
    p_max_running: MAX_TEXT_JOBS,
  });
  if (error) {
    console.error(`claim_jobs failed: ${error.message}`);
    return;
  }
  await Promise.allSettled((jobs as Job[]).map(runJob));
}

// ---------- Call 3: images ----------

type ImageJob = Job & { task_id: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const IMAGE_AUTH = { authorization: `Bearer ${BGAPI}` };

// Stored prompt + the matching style line from thirdapicall.txt.
async function imagePrompt(job: Job) {
  if (job.job_type === "cover_image") {
    const { data, error } = await db.from("books").select("cover_image_prompt").eq("id", job.target_id).single();
    if (error) throw new JobError(`Book not found: ${error.message}`);
    if (!isText(data.cover_image_prompt)) throw new JobError("Book has no cover_image_prompt");
    return `${data.cover_image_prompt} ${COVER_IMAGE_STYLE}`;
  }
  const { data: page, error } = await db.from("pages").select("image_prompt").eq("id", job.target_id).single();
  if (error) throw new JobError(`Page not found: ${error.message}`);
  if (!isText(page.image_prompt)) throw new JobError("Page has no image_prompt");
  const { data: campaign, error: campaignError } = await db
    .from("campaigns")
    .select("age_range")
    .eq("id", job.campaign_id)
    .single();
  if (campaignError) throw new JobError(`Campaign not found: ${campaignError.message}`);
  return `${page.image_prompt} ${fill(PAGE_IMAGE_STYLE, { AGE_RANGE: campaign.age_range })}`;
}

// Submits one image task and stores its task_id (status awaiting_task). Returns null on failure.
async function submitImage(job: Job): Promise<ImageJob | null> {
  try {
    if (job.attempts > MAX_ATTEMPTS) throw new JobError("Worker stopped before the image was submitted");
    const prompt = await imagePrompt(job);

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/v1/images/generations/async`, {
        method: "POST",
        headers: { ...IMAGE_AUTH, "content-type": "application/json" },
        body: JSON.stringify({ model: IMAGE_MODEL, prompt, n: 1, size: IMAGE_SIZE }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new JobError(`Image submit request failed: ${e}`);
    }
    const raw = await res.text();
    if (!res.ok) throw new JobError(`Image submit HTTP ${res.status}`, raw);
    let taskId: string | undefined;
    try {
      taskId = JSON.parse(raw)?.data?.[0]?.task_id;
    } catch { /* handled below */ }
    if (!taskId) throw new JobError("Image submit returned no task_id", raw);

    const { error } = await db.rpc("start_image_task", { p_job_id: job.id, p_task_id: taskId });
    if (error) throw new JobError(`Saving task_id failed: ${error.message}`, raw);
    console.log(`${job.job_type} job ${job.id}: submitted task ${taskId}`);
    return { ...job, task_id: taskId, payload: { ...job.payload, submitted_at: new Date().toISOString() } };
  } catch (e) {
    await failJob(job, e);
    return null;
  }
}

// Storage path without extension, e.g. {campaign}/{book}/cover or {campaign}/{book}/page-07.
async function imageBasePath(job: Job) {
  if (job.job_type === "cover_image") return `${job.campaign_id}/${job.target_id}/cover`;
  const { data, error } = await db.from("pages").select("book_id, page_number").eq("id", job.target_id).single();
  if (error) throw new JobError(`Page not found: ${error.message}`);
  return `${job.campaign_id}/${data.book_id}/page-${String(data.page_number).padStart(2, "0")}`;
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// Downloads the result (URLs expire), uploads it to the bucket, saves the path, deletes the old file.
async function saveImage(job: ImageJob, url: string, raw: string) {
  let img: Response;
  try {
    img = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new JobError(`Image download failed: ${e}`, raw);
  }
  if (!img.ok) throw new JobError(`Image download HTTP ${img.status}`, raw);
  const contentType = img.headers.get("content-type")?.split(";")[0].trim() || "image/png";
  const path = `${await imageBasePath(job)}-${job.id}.${EXTENSIONS[contentType] ?? "png"}`;

  const bucket = db.storage.from(IMAGE_BUCKET);
  const { error: uploadError } = await bucket.upload(path, await img.arrayBuffer(), { contentType, upsert: true });
  if (uploadError) throw new JobError(`Upload failed: ${uploadError.message}`, raw);

  const { data: oldPath, error } = await db.rpc("finish_image_job", { p_job_id: job.id, p_path: path, p_raw: raw });
  if (error) {
    await bucket.remove([path]);
    throw new JobError(`Saving image path failed: ${error.message}`, raw);
  }
  if (oldPath && oldPath !== path) {
    const { error: removeError } = await bucket.remove([oldPath as string]);
    if (removeError) console.error(`job ${job.id}: deleting old file ${oldPath} failed: ${removeError.message}`);
  }
  console.log(`${job.job_type} job ${job.id}: saved ${path}`);
}

// Polls one task. Returns true when the job is finished (saved or failed), false to keep polling.
async function pollImage(job: ImageJob): Promise<boolean> {
  try {
    const submittedAt = Date.parse(String(job.payload?.submitted_at ?? ""));
    if (Date.now() - submittedAt > IMAGE_GIVE_UP_MS) {
      throw new JobError(`Image task ${job.task_id} not done after ${IMAGE_GIVE_UP_MS / 60_000} minutes`);
    }

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/v1/tasks/${job.task_id}?model=${IMAGE_MODEL}`, {
        headers: IMAGE_AUTH,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      console.warn(`job ${job.id}: poll request failed, will retry: ${e}`);
      return false;
    }
    const raw = await res.text();
    // Poll errors are treated as transient; the give-up timeout handles persistent ones.
    if (!res.ok) {
      console.warn(`job ${job.id}: poll HTTP ${res.status}, will retry`);
      return false;
    }
    let data: { status?: string; result?: { images?: { url?: string }[] } } | undefined;
    try {
      data = JSON.parse(raw)?.data;
    } catch {
      return false;
    }
    const status = String(data?.status ?? "").toLowerCase();
    if (["failed", "error", "cancelled"].includes(status)) throw new JobError(`Image task ${status}`, raw);
    if (!["succeeded", "success", "completed"].includes(status)) return false;

    const url = data?.result?.images?.[0]?.url;
    if (!url) throw new JobError("Image task succeeded without an image URL", raw);
    await saveImage(job, url, raw);
    return true;
  } catch (e) {
    await failJob(job, e);
    return true;
  }
}

// Keeps up to MAX_IMAGE_TASKS tasks in flight and polls them every 3 s until the window ends.
async function runImages(deadline: number) {
  const active = new Map<string, ImageJob>();
  // Tasks submitted by earlier runs that are still waiting.
  const { data: leased, error: leaseError } = await db.rpc("lease_image_tasks");
  if (leaseError) console.error(`lease_image_tasks failed: ${leaseError.message}`);
  for (const job of (leased ?? []) as ImageJob[]) active.set(job.id, job);

  let claimMore = true;
  try {
    while (true) {
      if (claimMore && deadline - Date.now() > CLAIM_MIN_LEFT_MS) {
        claimMore = false;
        const { data: jobs, error } = await db.rpc("claim_jobs", {
          p_job_types: IMAGE_JOB_TYPES,
          p_max_running: MAX_IMAGE_TASKS,
        });
        if (error) console.error(`claim_jobs (images) failed: ${error.message}`);
        const submitted = await Promise.all(((jobs ?? []) as Job[]).map(submitImage));
        for (const job of submitted) if (job) active.set(job.id, job);
      }
      if (active.size === 0 || Date.now() + POLL_INTERVAL_MS > deadline) break;

      await sleep(POLL_INTERVAL_MS);
      const results = await Promise.all([...active.values()].map(async (job) => [job.id, await pollImage(job)] as const));
      for (const [id, finished] of results) {
        if (finished) {
          active.delete(id);
          claimMore = true; // a slot freed up
        }
      }
    }
  } finally {
    // Unfinished tasks go back to the pool for the next run.
    if (active.size) {
      const { error } = await db.rpc("release_image_tasks", { p_job_ids: [...active.keys()] });
      if (error) console.error(`release_image_tasks failed: ${error.message}`);
    }
  }
}

async function runWorker() {
  const deadline = Date.now() + RUN_WINDOW_MS;
  await Promise.allSettled([runText(), runImages(deadline)]);
}

Deno.serve(async (req) => {
  const { data: ok } = await db.rpc("worker_secret_ok", { p_secret: req.headers.get("x-worker-secret") ?? "" });
  if (!ok) return new Response("Unauthorized", { status: 401 });

  EdgeRuntime.waitUntil(runWorker());
  return new Response(JSON.stringify({ started: true }), {
    status: 202,
    headers: { "content-type": "application/json" },
  });
});
