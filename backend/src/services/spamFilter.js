/**
 * spamFilter.js — Detect spam-trigger words before sending
 *
 * Scans email subject + body for words/phrases that commonly cause:
 *   - Gmail/Outlook spam classification
 *   - Low inbox placement
 *   - Deliverability penalties
 *
 * Usage:
 *   const { checkSpam } = require('./spamFilter');
 *   const result = checkSpam(subject, body);
 *   if (!result.passed) { skip this email }
 */

// Phrases that trigger spam filters — from SpamAssassin + MailChimp research
const SPAM_PHRASES = [
  // Urgency pressure
  'act now', 'act immediately', 'apply now', 'limited time', 'now or never',
  'today only', 'don\'t hesitate', 'don\'t delay', 'do it today', 'order now',

  // Financial / money
  'make money', 'earn extra', 'extra cash', 'financial freedom', 'cash bonus',
  'no cost', 'no fees', 'free money', 'risk free', 'risk-free', 'no risk',
  'double your', 'triple your', 'earn $', 'make $',

  // Hype / salesy
  'amazing offer', 'incredible deal', 'unbelievable', 'satisfaction guaranteed',
  'you\'ve been selected', 'exclusive deal', 'special promotion', 'special offer',
  'once in a lifetime', 'buy now', 'click here', 'click below', 'subscribe now',
  'you have won', 'you\'re a winner', 'congratulations', 'dear friend',

  // Filler / generic openers (also kill cold email response rates)
  'i hope this email finds you well',
  'i hope this finds you well',
  'hope you\'re doing well',
  'hope you are doing well',
  'just following up',
  'just checking in',
  'touching base',
  'circling back',
  'per my last email',
  'as per my previous',

  // Misc spam indicators
  'nigerian', 'lottery', 'inheritance', 'unclaimed', 'billion dollars',
  'million dollars', 'million dollar',
];

// ALL-CAPS words that are legitimate in industry/business emails and must never be flagged.
// Covers healthcare terms, common company-name abbreviations, and standard business words.
const CAPS_WHITELIST = new Set([
  // Healthcare & medical
  'HOSPITAL', 'PATIENT', 'PATIENTS', 'CLINIC', 'CLINICS', 'CLINICAL',
  'HEALTH', 'HEALTHCARE', 'MEDICAL', 'MEDICINE', 'DOCTOR', 'DOCTORS',
  'NURSE', 'NURSES', 'SURGERY', 'DENTAL', 'PHARMACY', 'PHARMA',
  'DIAGNOSTIC', 'DIAGNOSTICS', 'RADIOLOGY', 'THERAPY', 'THERAPIST',
  'REHAB', 'REHABILITATION', 'EMERGENCY', 'PEDIATRIC', 'CARDIAC',
  'ONCOLOGY', 'NEUROLOGY', 'ORTHOPEDIC', 'DERMA', 'DERMATOLOGY',
  'IBSAR', 'DAVITA', 'IQVIA', 'DALLAH',
  // Business / workflow words AI commonly capitalises
  'FOLLOW', 'FOLLOWUP', 'FOLLOW-UP', 'CALLS', 'MISSED', 'MISSED-CALLS',
  'CLIENT', 'CLIENTS', 'PROSPECT', 'PROSPECTS', 'ENGAGEMENT',
  'ONBOARDING', 'REVENUE', 'SOLUTIONS', 'CENTER', 'CENTRE',
  'REPORT', 'REPORTS', 'PORTAL', 'PLATFORM', 'SYSTEM', 'SYSTEMS',
  'SUPPORT', 'SERVICE', 'SERVICES', 'MANAGEMENT', 'OPERATIONS',
  'STAFF', 'TEAM', 'TEAMS', 'GROWTH', 'IMPACT', 'RESULTS',
  'AUTOMATION', 'AUTOMATED', 'AUTOMATE',
  'SCHEDULING', 'SCHEDULE', 'APPOINTMENT', 'APPOINTMENTS',
  'INQUIRY', 'INQUIRIES', 'VOLUME', 'LEADS', 'FRONT',
  'ADMIN', 'ADMINISTRATION', 'BOTTLENECKS', 'BOTTLENECK',
  'MEMBERSHIP', 'MEMBERSHIPS', 'SHOWS', 'WORKFLOW', 'WORKFLOWS',
  // Healthcare extended
  'HOSPITALS', 'FITNESS', 'WELLNESS', 'MOLECULAR', 'IMAGING',
  'LABORATORY', 'LABORATORIES', 'SPECIMEN', 'PATHOLOGY',
  'PHYSIOTHERAPY', 'CARDIOLOGY', 'GYNECOLOGY', 'UROLOGY',
  'TELEMEDICINE', 'TELEHEALTH', 'HOMECARE', 'HOMEHEALTH',
  // Country/region names that appear in company names
  'JORDAN', 'EGYPT', 'SAUDI', 'QATAR', 'KUWAIT', 'BAHRAIN', 'OMAN',
  'DUBAI', 'RIYADH', 'JEDDAH', 'MAKKAH', 'MEDINA',
  // Common company name patterns
  'THAKAA', 'IBSAR', 'DAVITA', 'IQVIA', 'DALLAH',
]);

// Regex patterns for spam indicators
const SPAM_PATTERNS = [
  { pattern: /[A-Z]{5,}/g,          label: 'ALL-CAPS word' },     // URGENT GUARANTEED FREE
  { pattern: /!!!+/g,               label: 'multiple !!!' },
  { pattern: /\?\?\?+/g,            label: 'multiple ???' },
  { pattern: /\$\d[\d,]*/g,         label: 'dollar amount' },
  { pattern: /\d+%\s*(off|discount)/gi, label: 'percentage discount' },
];

/**
 * Check email content for spam trigger words/patterns.
 *
 * @param {string} subject
 * @param {string} body
 * @returns {{ passed: boolean, score: number, matches: string[] }}
 *   passed — true if no spam words found (safe to send)
 *   score  — count of matches (0 = clean)
 *   matches — list of offending words/patterns found
 */
function checkSpam(subject, body) {
  const fullText = `${subject} ${body}`.toLowerCase();
  const matches  = new Set();

  // Check phrases
  for (const phrase of SPAM_PHRASES) {
    if (fullText.includes(phrase)) {
      matches.add(phrase);
    }
  }

  // Check patterns (use original text for case detection)
  const originalText = `${subject} ${body}`;
  for (const { pattern, label } of SPAM_PATTERNS) {
    const found = originalText.match(pattern);
    if (found) {
      for (const f of found) {
        // For ALL-CAPS matches, skip words that are whitelisted industry/healthcare terms
        if (label === 'ALL-CAPS word' && CAPS_WHITELIST.has(f.trim())) continue;
        matches.add(`${label}: "${f}"`);
      }
    }
  }

  const score  = matches.size;
  const passed = score === 0;

  return { passed, score, matches: [...matches] };
}

module.exports = { checkSpam };
