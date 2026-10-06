const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractNativeJobId } = require('./upworkEnrichment');

const DEFAULT_MCP_URL = 'https://mcp.upwork.com/mcp';
const DEFAULT_ORG_UID = '2091895146228151233';
const MCP_PROTOCOL_VERSION = '2025-03-26';
const MCP_CLIENT_NAME = 'backend-scraper';
const MCP_CLIENT_VERSION = '1.0';
const MCP_TIMEOUT_MS = 30000;
const MCP_SEARCH_PAGE_LIMIT = 10;
const RECENCY_MAX_MS = 24 * 60 * 60 * 1000;
const RECENCY_MIN_MS = 60 * 1000;

const FIND_JOBS_SEARCH_KEYS = [
  'query',
  'job_type',
  'experience_level',
  'budget_min',
  'budget_max',
  'workload',
  'duration',
  'verified_payment_only',
  'proposals_min',
  'proposals_max',
  'client_hires_min',
  'client_hires_max',
  'sort',
  'timezone',
  'location',
  'limit'
];

function opencodeMCPAuthPath() {
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'mcp-auth.json');
}

function readLocalOpencodeToken() {
  try {
    const data = JSON.parse(fs.readFileSync(opencodeMCPAuthPath(), 'utf8'));
    const token = data && data.upwork && data.upwork.tokens && data.upwork.tokens.accessToken;
    return typeof token === 'string' && token.trim() ? token.trim() : null;
  } catch (err) {
    return null;
  }
}

function resolveToken(brand) {
  const mcpConfig = (brand && brand.apify && brand.apify.mcpConfig) || {};
  if (mcpConfig.token) {
    console.log('[Upwork MCP] Token resolved from brand config');
    return mcpConfig.token;
  }
  if (process.env.UPWORK_MCP_TOKEN) {
    console.log('[Upwork MCP] Token resolved from ENV (UPWORK_MCP_TOKEN)');
    return process.env.UPWORK_MCP_TOKEN;
  }
  const token = readLocalOpencodeToken();
  if (token) console.log('[Upwork MCP] Token resolved from local mcp-auth.json');
  return token;
}

function resolveMCPConfig(brand) {
  const mcpConfig = (brand && brand.apify && brand.apify.mcpConfig) || {};
  const url = mcpConfig.url || process.env.UPWORK_MCP_URL || DEFAULT_MCP_URL;
  const token = resolveToken(brand);
  const orgUid = mcpConfig.orgUid || process.env.UPWORK_ORG_UID || DEFAULT_ORG_UID;
  return { url, token, orgUid };
}

function buildSearchArgs(brand, input) {
  const merged = {
    ...((brand && brand.apify && brand.apify.defaultInput) || {}),
    ...(input || {})
  };
  const args = {};
  for (const key of FIND_JOBS_SEARCH_KEYS) {
    if (merged[key] !== undefined && merged[key] !== null && merged[key] !== '') args[key] = merged[key];
  }
  if (!args.query) args.query = 'developer';
  if (!args.sort) args.sort = 'recency';
  if (args.verified_payment_only === undefined) args.verified_payment_only = true;
  const limit = parseInt(args.limit, 10);
  args.limit = Number.isFinite(limit) ? Math.min(10, Math.max(1, limit)) : MCP_SEARCH_PAGE_LIMIT;
  if (Array.isArray(args.location)) args.location = args.location[0];
  if (typeof args.location !== 'string' || !args.location.trim()) delete args.location;
  return args;
}

async function postMCP(url, token, body, extraHeaders = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  try {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream'
    };
    if (token) headers.authorization = `Bearer ${token}`;
    for (const [k, v] of Object.entries(extraHeaders)) headers[k.toLowerCase()] = v;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(body)
    });
    const sessionId = res.headers.get('mcp-session-id');
    const text = await res.text();
    if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);

    let data;
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) {
      data = JSON.parse(trimmed);
    } else {
      const dataLines = trimmed
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .filter(Boolean);
      data = dataLines
        .map((l) => { try { return JSON.parse(l); } catch (err) { return null; } })
        .filter(Boolean)
        .pop() || {};
    }
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return { data, sessionId };
  } finally {
    clearTimeout(timer);
  }
}

async function createMCPSession(url, token) {
  const init = await postMCP(url, token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION }
    }
  });
  if (!init.sessionId) throw new Error('MCP server did not return mcp-session-id');
  return init.sessionId;
}

function extractToolResult(result) {
  if (Array.isArray(result.content)) {
    const textItem = result.content.find((c) => c && c.type === 'text' && c.text);
    if (textItem) {
      try {
        const parsed = JSON.parse(textItem.text);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (err) {
        throw new Error('MCP returned non-JSON text content');
      }
    }
  }
  if (result.structuredContent) return result.structuredContent;
  return result;
}

async function callFindJobsSearch(url, token, sessionId, orgUid, args) {
  const { data } = await postMCP(
    url,
    token,
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'upwork__find_jobs',
        arguments: { action: 'search', org_uid: orgUid, params: args }
      }
    },
    { 'mcp-session-id': sessionId }
  );
  const result = data.result || {};
  if (result.isError) throw new Error(result.error || 'MCP tool returned an error');
  return extractToolResult(result);
}

async function callFindJobsGet(url, token, sessionId, orgUid, jobId) {
  const { data } = await postMCP(
    url,
    token,
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'upwork__find_jobs',
        arguments: { action: 'get', org_uid: orgUid, params: { id: jobId } }
      }
    },
    { 'mcp-session-id': sessionId }
  );
  const result = data.result || {};
  if (result.isError) throw new Error(result.error || 'MCP tool returned an error');
  return extractToolResult(result);
}

function extractJobDetail(payload) {
  if (payload && payload.data && payload.data.marketplaceJobPosting) return payload.data.marketplaceJobPosting;
  if (payload && payload.data && payload.data.job) return payload.data.job;
  if (payload && payload.data && Array.isArray(payload.data.jobs) && payload.data.jobs.length) return payload.data.jobs[0];
  if (payload && payload.job) return payload.job;
  if (payload && Array.isArray(payload.jobs) && payload.jobs.length) return payload.jobs[0];
  return null;
}

function parseJobDate(job) {
  const raw = job.date_created || job.published_date || job.created_date || job.dateCreated || job.created || job.posted || job.postedDate || job.posting_date;
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') {
    const d = new Date(raw > 1e12 ? raw : raw * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function isWithinRecencyWindow(job) {
  const d = parseJobDate(job);
  if (!d) return false;
  const age = Date.now() - d.getTime();
  return age >= RECENCY_MIN_MS && age <= RECENCY_MAX_MS;
}

function extractJobs(payload) {
  if (payload && Array.isArray(payload.data && payload.data.jobs)) return payload.data.jobs;
  if (payload && Array.isArray(payload.jobs)) return payload.jobs;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

function isPaymentVerified(job) {
  const client = job.client || {};
  const flags = [
    job.payment_verified,
    job.paymentVerified,
    job.is_payment_verified,
    job.verified_payment,
    client.payment_verified,
    client.verified
  ];
  const hasValue = flags.some((v) => v !== undefined && v !== null && v !== '');
  if (!hasValue) return true;
  return flags.some((v) => v === true || (typeof v === 'string' && v.toLowerCase() === 'true'));
}

function isIndiaJob(job) {
  const client = job.client || {};
  const values = [client.country, client.location, job.location].filter((v) => typeof v === 'string' && v.trim());
  return values.some((v) => {
    const n = v.trim().toUpperCase();
    return n === 'INDIA' || n === 'IN';
  });
}

function resolveJobToken(job) {
  if (job.ciphertext && String(job.ciphertext).trim()) return String(job.ciphertext).trim();
  if (job.job_ciphertext && String(job.job_ciphertext).trim()) return String(job.job_ciphertext).trim();
  if (job.opening_id != null && String(job.opening_id).trim()) return String(job.opening_id).trim();
  if (job.id != null && String(job.id).trim()) return String(job.id).trim();
  return '';
}

function mergeJobDetail(job, detail) {
  if (!detail || typeof detail !== 'object') return job;
  const merged = { ...job, ...detail };
  if (detail.client) merged.client = { ...(job.client || {}), ...detail.client };
  const detailDesc = detail.description || (detail.job && detail.job.description) || (detail.content && detail.content.description) || (detail.details && detail.details.description);
  if (detailDesc) merged.description = detailDesc;
  return merged;
}

async function searchUpworkJobsViaMCP(brand, input = {}) {
  const { url, token, orgUid } = resolveMCPConfig(brand);
  if (!url) {
    throw new Error('No Upwork MCP URL configured. Set brand apify.mcpConfig.url or UPWORK_MCP_URL in .env.');
  }
  if (!token) {
    throw new Error(
      'No Upwork MCP token configured. Set brand apify.mcpConfig.token, UPWORK_MCP_TOKEN, or ensure OpenCode mcp-auth.json contains upwork.tokens.accessToken.'
    );
  }

  console.log('[Upwork MCP] Initializing MCP session...');
  const sessionId = await createMCPSession(url, token);
  console.log(`[Upwork MCP] Session initialized. Session ID: ${sessionId}`);

  const baseArgs = buildSearchArgs(brand, input);
  baseArgs.limit = 10;

  console.log('[Upwork MCP] Executing upwork__find_jobs (Page 1)...');
  const payload = await callFindJobsSearch(url, token, sessionId, orgUid, baseArgs);
  const jobs = extractJobs(payload);
  console.log(`[Upwork MCP] Received ${jobs.length} raw jobs from Upwork.`);

  const fresh = jobs.filter(isWithinRecencyWindow);
  const retained = fresh.filter((job) => isPaymentVerified(job) && !isIndiaJob(job));
  console.log(`[Upwork MCP] Raw fetched: ${jobs.length}/10. Retained after recency (1m-24h) & location/payment filters: ${retained.length} jobs.`);

  const enriched = [];
  for (const job of retained) {
    const getToken = resolveJobToken(job) || extractNativeJobId(job);
    try {
      const detailPayload = await callFindJobsGet(url, token, sessionId, orgUid, getToken);
      console.log('[MCP DEBUG] Raw detail payload for job:', JSON.stringify(detailPayload, null, 2));
      const detail = extractJobDetail(detailPayload);
      enriched.push(mergeJobDetail(job, detail));
    } catch (err) {
      console.error(`[Upwork MCP] Detail fetch failed for ${getToken}: ${err.message}`);
      enriched.push(job);
    }
  }

  const items = enriched.map(mapMCPJobToUpworkJob);
  return { scraped: items.length, items, rawCount: jobs.length, hasMore: false };
}

function toNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildUpworkJobUrl(job) {
  let token = job.ciphertext || job.job_ciphertext || job.opening_id || '';
  if (!token) {
    const strId = String(job.id || '').trim();
    token = /^\d+$/.test(strId) ? `~02${strId}` : strId;
  }
  token = String(token).trim();
  if (token && !token.startsWith('~')) token = `~${token}`;
  const titleSlug = (job.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  if (token && titleSlug) {
    return `https://www.upwork.com/freelance-jobs/apply/${titleSlug}_${token}?referrer_url_path=%2Fnx%2Fsearch%2Fjobs%2F`;
  }
  return job.url || job.link || '';
}

function sanitizeDescription(value) {
  return String(value || '')
    .replace(/<[\/]?untrusted_participant_content>/gi, '')
    .trim();
}

function mapMCPJobToUpworkJob(mcpJob) {
  const job = mcpJob || {};
  const client = job.client || {};
  const jobId = extractNativeJobId({ id: job.id, url: job.url });
  const date = parseJobDate(job);

  console.log('[Upwork MCP Raw Job Keys]:', Object.keys(job));

  const fullDescription = (job.content && job.content.description) || job.description || job.description_full || (job.details && job.details.description) || job.summary || job.description_snippet || job.title;
  const description = sanitizeDescription(fullDescription);
  const clientName = client.name || client.company_name || client.country || 'Client';
  const clientLocation = client.country || client.location || 'Worldwide';
  const url = buildUpworkJobUrl(job);
  return {
    jobId,
    url,
    title: job.title || '',
    description,
    budget: job.budget || job.fixed_price || job.hourly_rate || null,
    clientLocation,
    clientName,
    clientAvgHourlyRate: toNumber(client.avg_hourly_rate || job.client_avg_hourly_rate || job.hourly_rate),
    clientRating: toNumber(client.rating || client.score || job.rating || 0),
    clientHireRatePercent: toNumber(client.hire_rate || client.hireRate || 0),
    clientTotalSpent: toNumber(client.total_spent || client.totalSpent || client.spend || 0),
    proposals: toNumber(job.proposal_count || job.proposals || 0),
    paymentVerified: client.payment_verified ?? true,
    relativeDate: job.relative_date || job.posted || job.postedDate || '',
    absoluteDate: date ? date.toISOString() : '',
    jobType: job.job_type || '',
    experienceLevel: job.experience_level || '',
    skills: Array.isArray(job.skills) ? job.skills.map(String) : [],
    category: job.category || undefined,
    subcategory: job.subcategory || undefined,
    tags: Array.isArray(job.tags) ? job.tags.map(String) : [],
    source: 'mcp'
  };
}

module.exports = { searchUpworkJobsViaMCP, mapMCPJobToUpworkJob };