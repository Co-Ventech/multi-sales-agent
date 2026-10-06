const fs = require('fs');
const path = require('path');
const { normalizePhrase } = require('../domain/keywordPolicy');

const DEFAULT_FILE = path.join(process.cwd(), 'data', 'published_topics.txt');

function publishedTopicsPath() {
  return process.env.PUBLISHED_TOPICS_PATH || DEFAULT_FILE;
}

/** @returns {Set<string>} */
function loadPublishedNormalizedSet() {
  const file = publishedTopicsPath();
  if (!fs.existsSync(file)) return new Set();
  const text = fs.readFileSync(file, 'utf8');
  const set = new Set();
  for (const line of text.split(/\r?\n/)) {
    const n = normalizePhrase(line);
    if (n) set.add(n);
  }
  return set;
}

function appendPublishedKeyword(phraseNormalized) {
  if (!phraseNormalized) return;
  const file = publishedTopicsPath();
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(file, `${phraseNormalized}\n`, 'utf8');
}

module.exports = {
  loadPublishedNormalizedSet,
  appendPublishedKeyword,
  publishedTopicsPath
};
