const Contact = require('../models/Contact');

function isLinkedInProfileUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const u = url.trim().toLowerCase();
  if (!u.includes('linkedin.com')) return false;
  if (u.includes('/jobs/') || u.includes('/job-apply')) return false;
  return u.includes('/in/') || u.includes('/pub/');
}

function isLinkedInJobUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /linkedin\.com\/jobs\//i.test(url);
}

/** Prefer HR profile URLs over job posting URLs when merging. */
function pickLinkedinUrl(existing, incoming) {
  if (isLinkedInProfileUrl(incoming)) return incoming;
  if (!existing) return incoming || '';
  if (isLinkedInJobUrl(existing) && incoming) return incoming;
  return existing;
}

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function mergeJobIds(contact, jobIds) {
  let changed = false;
  const existing = new Set(contact.linkedinJobIds.map(id => String(id)));
  for (const jid of jobIds) {
    if (!existing.has(String(jid))) {
      contact.linkedinJobIds.push(jid);
      existing.add(String(jid));
      changed = true;
    }
  }
  return changed;
}

/**
 * Upsert a contact by brandId + email (matches DB unique index brandId_1_email_1).
 * Merges linkedinJobIds and optional linkedinContactId / linkedinUrl on existing rows.
 */
async function upsertEnrichedContact(brandId, data) {
  const email = normalizeEmail(data.email);
  if (!email) return { created: false, contact: null };

  const jobIds = data.linkedinJobIds || [];
  let existing = await Contact.findOne({ brandId, email });

  if (existing) {
    let changed = mergeJobIds(existing, jobIds);
    if (data.linkedinContactId && !existing.linkedinContactId) {
      existing.linkedinContactId = data.linkedinContactId;
      changed = true;
    }
    const mergedLinkedin = pickLinkedinUrl(existing.linkedinUrl, data.linkedinUrl);
    if (mergedLinkedin && mergedLinkedin !== existing.linkedinUrl) {
      existing.linkedinUrl = mergedLinkedin;
      changed = true;
    }
    if (data.jobLinkedinUrl && !existing.jobLinkedinUrl) {
      existing.jobLinkedinUrl = data.jobLinkedinUrl;
      changed = true;
    }
    if (changed) await existing.save();
    return { created: false, contact: existing };
  }

  try {
    const contact = await Contact.create({ ...data, brandId, email });
    return { created: true, contact };
  } catch (err) {
    if (err.code !== 11000) throw err;
    existing = await Contact.findOne({ brandId, email });
    if (!existing) throw err;
    mergeJobIds(existing, jobIds);
    if (data.linkedinContactId && !existing.linkedinContactId) {
      existing.linkedinContactId = data.linkedinContactId;
    }
    const mergedLinkedin = pickLinkedinUrl(existing.linkedinUrl, data.linkedinUrl);
    if (mergedLinkedin && mergedLinkedin !== existing.linkedinUrl) {
      existing.linkedinUrl = mergedLinkedin;
    }
    if (data.jobLinkedinUrl && !existing.jobLinkedinUrl) {
      existing.jobLinkedinUrl = data.jobLinkedinUrl;
    }
    await existing.save();
    return { created: false, contact: existing };
  }
}

module.exports = { upsertEnrichedContact, normalizeEmail };
