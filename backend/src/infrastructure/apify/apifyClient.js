const axios = require('axios');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollRunAndFetchDataset({ base, token, startRes, timeoutMs }) {
  const runId = startRes.data.data.id;
  const datasetId = startRes.data.data.defaultDatasetId;
  const deadline = Date.now() + timeoutMs;
  process.stdout.write(`  [Apify] Run ID: ${runId}`);

  let finished = false;
  while (Date.now() < deadline) {
    await sleep(5000);
    let s;
    try {
      s = await axios.get(`${base}/actor-runs/${runId}?token=${token}`);
    } catch {
      continue;
    }
    const status = s.data.data.status;
    process.stdout.write(` [${status}]`);
    if (status === 'SUCCEEDED') {
      console.log(' done.');
      finished = true;
      break;
    }
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      throw new Error(`Actor ended with: ${status}`);
    }
  }
  if (!finished) {
    throw new Error('Apify run timed out waiting for SUCCEEDED');
  }

  const res = await axios.get(
    `${base}/datasets/${datasetId}/items?token=${token}&format=json&clean=true`
  );
  return res.data || [];
}

function formatApifyAxiosError(err) {
  const status = err.response?.status;
  const data = err.response?.data;
  const apifyMsg =
    data?.error?.message ||
    (typeof data?.error === 'string' ? data.error : null) ||
    (data?.error && JSON.stringify(data.error)) ||
    (data && JSON.stringify(data)) ||
    err.message;
  return `HTTP ${status || '?'}: ${apifyMsg}`;
}

async function runActor({ base, token, actorId, input, timeoutMs }) {
  let startRes;
  try {
    startRes = await axios.post(
      `${base}/acts/${encodeURIComponent(actorId)}/runs?token=${token}`,
      input,
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    if (err.response?.status === 400) {
      console.error('\n[Apify] Actor start rejected. Input sent:', JSON.stringify(input, null, 2));
    }
    throw new Error(`Apify actor start failed — ${formatApifyAxiosError(err)}`);
  }
  return pollRunAndFetchDataset({ base, token, startRes, timeoutMs });
}

module.exports = { runActor, sleep };
