/**
 * timezoneScheduler.js — Country-aware business hours filter
 *
 * Ensures emails are sent during recipient's local business hours (9am–5pm).
 * Instead of one fixed cron, the send cron runs every 2 hours and this
 * module decides which contacts are in business hours RIGHT NOW.
 *
 * Pakistan (PKT = UTC+5) timing chart:
 *   USA East  (EST UTC-5): PKT 19:00–03:00  → send between 7pm-11pm PKT
 *   USA West  (PST UTC-8): PKT 22:00–06:00  → send between 10pm-2am PKT
 *   UK/Europe (GMT UTC+0): PKT 14:00–22:00  → send between 2pm-10pm PKT
 *   UAE/Gulf  (GST UTC+4): PKT 10:00–18:00  → send between 10am-6pm PKT
 *   India     (IST UTC+5:30): PKT 8:30–17:30 → send between 8am-5pm PKT
 *   Australia (AEST UTC+10): PKT 04:00–12:00 → send between 4am-12pm PKT
 */

// Country → IANA timezone mapping (covers most common countries in lead data)
const COUNTRY_TIMEZONES = {
  // Americas
  'united states': 'America/New_York',
  'usa': 'America/New_York',
  'us': 'America/New_York',
  'canada': 'America/Toronto',

  // Europe
  'united kingdom': 'Europe/London',
  'uk': 'Europe/London',
  'germany': 'Europe/Berlin',
  'france': 'Europe/Paris',
  'netherlands': 'Europe/Amsterdam',
  'spain': 'Europe/Madrid',
  'italy': 'Europe/Rome',
  'sweden': 'Europe/Stockholm',
  'norway': 'Europe/Oslo',
  'denmark': 'Europe/Copenhagen',
  'finland': 'Europe/Helsinki',
  'poland': 'Europe/Warsaw',
  'switzerland': 'Europe/Zurich',
  'ireland': 'Europe/Dublin',
  'portugal': 'Europe/Lisbon',

  // Middle East
  'united arab emirates': 'Asia/Dubai',
  'uae': 'Asia/Dubai',
  'saudi arabia': 'Asia/Riyadh',
  'qatar': 'Asia/Qatar',
  'kuwait': 'Asia/Kuwait',
  'bahrain': 'Asia/Bahrain',
  'oman': 'Asia/Muscat',
  'israel': 'Asia/Jerusalem',
  'turkey': 'Europe/Istanbul',
  'jordan': 'Asia/Amman',
  'lebanon': 'Asia/Beirut',
  'iraq': 'Asia/Baghdad',
  'syria': 'Asia/Damascus',
  'yemen': 'Asia/Aden',
  'libya': 'Africa/Tripoli',

  // Africa
  'egypt': 'Africa/Cairo',
  'kenya': 'Africa/Nairobi',
  'nigeria': 'Africa/Lagos',
  'south africa': 'Africa/Johannesburg',
  'ethiopia': 'Africa/Addis_Ababa',
  'ghana': 'Africa/Accra',
  'tanzania': 'Africa/Dar_es_Salaam',
  'morocco': 'Africa/Casablanca',
  'tunisia': 'Africa/Tunis',
  'algeria': 'Africa/Algiers',

  // Asia Pacific
  'india': 'Asia/Kolkata',
  'pakistan': 'Asia/Karachi',
  'singapore': 'Asia/Singapore',
  'australia': 'Australia/Sydney',
  'new zealand': 'Pacific/Auckland',
  'japan': 'Asia/Tokyo',
  'south korea': 'Asia/Seoul',
  'hong kong': 'Asia/Hong_Kong',
  'china': 'Asia/Shanghai',

  // Default
  _default: 'America/New_York'  // Most leads are USA
};

// Business hours: 9am to 5pm local time
const BUSINESS_HOUR_START = 9;
const BUSINESS_HOUR_END   = 17;

/**
 * Get timezone string for a country.
 */
function getTimezone(country) {
  if (!country) return COUNTRY_TIMEZONES._default;
  const key = country.toLowerCase().trim();
  return COUNTRY_TIMEZONES[key] || COUNTRY_TIMEZONES._default;
}

/**
 * Check if it is currently business hours (9am–5pm Mon–Fri) in the given timezone.
 */
function isBusinessHours(timezone) {
  try {
    const now   = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour:     'numeric',
      weekday:  'short',
      hour12:   false
    }).formatToParts(now);

    const hour    = parseInt(parts.find(p => p.type === 'hour').value);
    const weekday = parts.find(p => p.type === 'weekday').value; // Mon, Tue...
    const isWeekend = weekday === 'Sat' || weekday === 'Sun';

    if (isWeekend) return false;
    return hour >= BUSINESS_HOUR_START && hour < BUSINESS_HOUR_END;
  } catch {
    return true; // if timezone lookup fails, allow sending
  }
}

/**
 * Get local time string for a country (for logging).
 */
function getLocalTime(country) {
  const tz = getTimezone(country);
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', minute: '2-digit',
      weekday: 'short', hour12: true
    }).format(new Date());
  } catch {
    return 'unknown';
  }
}

/**
 * Filter contacts to only those whose country is currently in business hours.
 * Contacts with no country default to USA timezone.
 *
 * @param {Array} contacts
 * @param {object} logger
 * @returns {Array} contacts in business hours right now
 */
function filterByBusinessHours(contacts, logger) {
  const groups = {};
  const eligible = [];
  const skipped  = [];

  for (const contact of contacts) {
    const country  = contact.country || '';
    const tz       = getTimezone(country);
    const inHours  = isBusinessHours(tz);
    const localNow = getLocalTime(country);

    if (!groups[tz]) groups[tz] = { tz, country, localNow, inHours, count: 0, skippedCount: 0 };

    if (inHours) {
      eligible.push(contact);
      groups[tz].count++;
    } else {
      skipped.push(contact);
      groups[tz].skippedCount++;
    }
  }

  // Log timezone summary
  logger.info('Timezone filter summary:');
  for (const g of Object.values(groups)) {
    const status = g.inHours ? '✓ IN HOURS' : '✗ off hours';
    logger.info(`  ${g.tz.padEnd(30)} local: ${g.localNow.padEnd(20)} ${status} — ${g.count} send, ${g.skippedCount} skip`);
  }
  logger.info(`Eligible now: ${eligible.length} / ${contacts.length} contacts`);

  return eligible;
}

module.exports = { filterByBusinessHours, isBusinessHours, getTimezone, getLocalTime, COUNTRY_TIMEZONES };
