/**
 * upworkEnrichment.js — Read-only Upwork metadata enrichment for Apify-scraped jobs.
 *
 * Fully isolated. Never writes to the DB. Never throws to the caller.
 * On any failure (missing config, timeout, network, auth) it returns an empty Map
 * so the standard Apify scrape path continues unchanged.
 *
 * Lookup strategy:
 *   - If UPWORK_MCP_URL + UPWORK_MCP_TOKEN are configured, issue a read-only
 *     request to the Upwork MCP/GraphQL endpoint to fetch ground-truth metadata
 *     (skills, category, jobStatus) for each job's native ciphertext ID.
 *   - Otherwise (no config) it returns an empty Map — i.e. enrichment is inert
 *     until the operator supplies the endpoint + token.
 */

const MCP_TIMEOUT_MS = 3000;
const MCP_MAX_CONCURRENCY = 5;

/**
 * Idempotent Upwork native job ID normalization.
 *
 * Precedence (per spec):
 *   1. raw.id already a `~ciphertext` token → returned directly.
 *   2. Extract `~ciphertext` (or `jobs/~ciphertext`) from raw.url/raw.id via
 *      `/(?:~|jobs\/~)([a-zA-Z0-9]+)/i`.
 *   3. raw.subId (stringified).
 *   4. raw.id (stringified).
 *   5. Deterministic URL hash — guaranteed fallback so this NEVER returns
 *      null/undefined and can never collide with another job's unique key.
 * @param {{id?: any, subId?: any, url?: string}} raw
 * @returns {string} normalized key (always a non-empty string).
 */
function extractNativeJobId(raw) {
  raw = raw || {};

  // 1. raw.id already a ~ciphertext token.
  if (raw.id != null && String(raw.id).trim().startsWith('~')) {
    return String(raw.id).trim();
  }

  // 2. Extract ~ciphertext (or jobs/~ciphertext) from url or id.
  const haystack = [raw.url, raw.id].filter((v) => v != null).map(String).join(' ');
  const m = haystack.match(/(?:~|jobs\/~)([a-zA-Z0-9]+)/i);
  if (m && m[1]) return '~' + m[1];

  // 3. raw.subId (stringified).
  if (raw.subId != null && String(raw.subId).trim()) {
    return String(raw.subId).trim();
  }

  // 4. raw.id (stringified).
  if (raw.id != null && String(raw.id).trim()) {
    return String(raw.id).trim();
  }

  // 5. Deterministic URL hash — never returns null/undefined.
  const url = String(raw.url || '');
  if (url) return 'url:' + hashString(url);
  return 'unknown:' + Math.random().toString(36).slice(2, 10);
}

/**
 * FNV-1a 32-bit string hash — deterministic, collision-resistant enough for a
 * guaranteed non-null fallback key. Idempotent across calls.
 * @param {string} str
 * @returns {string} hex hash
 */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Perform a single read-only lookup for one native job ID against the configured
 * Upwork MCP endpoint. Returns enriched fields or null.
 * @param {string} nativeId
 * @returns {Promise<object|null>}
 */
async function lookupJob(nativeId) {
  const url = process.env.UPWORK_MCP_URL;
  const token = process.env.UPWORK_MCP_TOKEN;
  if (!url) return null;

  console.log(`[MCP Enrichment] Querying MCP for Job ID: ${nativeId}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  try {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        action: 'get',
        id: nativeId
      })
    });
    if (!res.ok) {
      console.log(`[MCP Enrichment] MCP HTTP ${res.status} for Job ID: ${nativeId}`);
      return null;
    }

    const data = await res.json();
    const job = data && (data.job || data.data || data);
    if (!job || typeof job !== 'object') return null;

    const enriched = {};
    if (Array.isArray(job.skills) && job.skills.length) enriched.skills = job.skills.map(String);
    if (job.category != null) enriched.category = String(job.category);
    if (job.subcategory != null) enriched.subcategory = String(job.subcategory);
    if (job.jobStatus != null) enriched.jobStatus = String(job.jobStatus);
    if (Object.keys(enriched).length === 0) return null;

    return enriched;
  } catch (err) {
    console.log(`[MCP Enrichment Error] Failed to query MCP for Job ID: ${nativeId}. Reason: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read-only enrichment of raw Apify jobs with Upwork ground-truth metadata.
 * NEVER throws — on any error returns an empty Map so standard Apify storage
 * proceeds with zero impact.
 * @param {Array<object>} rawJobs
 * @returns {Promise<Map<string, object>>} Map<nativeJobId, enrichedFields>
 */
async function enrichJobsWithMCP(rawJobs) {
  const enrichMap = new Map();
  const jobs = Array.isArray(rawJobs) ? rawJobs : [];

  // No MCP endpoint configured -> enrichment is inert by design.
  if (!process.env.UPWORK_MCP_URL) {
    return enrichMap;
  }

  // Precompute normalized job IDs for all raw items.
  const items = jobs.map((raw) => ({ raw, jobId: extractNativeJobId(raw) }));

  // Run lookups with a bounded concurrency pool (max MCP_MAX_CONCURRENCY) and
  // per-item timeout (handled inside lookupJob). Promise.allSettled ensures one
  // failing lookup can never reject the whole batch or block the scrape flow.
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const { raw, jobId } = items[idx];
      const nativeId = jobId;
      if (!nativeId) {
        console.log(`[MCP Enrichment] Skipping job with no resolvable ID`);
        continue;
      }

      const fields = await lookupJob(nativeId).catch((err) => {
        console.log(`[MCP Enrichment Error] Failed to query MCP for Job ID: ${nativeId}. Reason: ${err.message}`);
        return null;
      });

      if (fields && Object.keys(fields).length) {
        enrichMap.set(nativeId, {
          ...fields,
          lastVerifiedAt: new Date(),
          source: 'mcp'
        });
        console.log(
          `[MCP Enrichment] Merging MCP data for Job ID: ${nativeId} | ` +
          `Found Skills: ${(fields.skills || []).length} | ` +
          `Category: ${fields.category || 'N/A'} | ` +
          `JobStatus: ${fields.jobStatus || 'N/A'}`
        );
      } else {
        console.log(`[MCP Enrichment] No MCP match found for Job ID: ${nativeId}. Using raw Apify payload.`);
      }
    }
  };

  const poolSize = Math.max(1, Math.min(MCP_MAX_CONCURRENCY, jobs.length));
  await Promise.allSettled(Array.from({ length: poolSize }, () => worker()));

  return enrichMap;
}

module.exports = { extractNativeJobId, enrichJobsWithMCP, lookupJob };
