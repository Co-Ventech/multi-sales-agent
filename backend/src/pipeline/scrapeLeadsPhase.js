const Brand = require('../models/Brand');
const Contact = require('../models/Contact');
const { runActor, mapToContacts } = require('../services/apifyService');
const { getApifyToken } = require('../config/apify');
const { buildApifyLeadsInputForBrand } = require('../config/apifyLeadsFilters');
const { LeadQualifier } = require('../services/qualifierService');

async function scrapeLeadsPhase(brand, logger, opts = {}) {
  logger.info('--- SCRAPE-LEADS PHASE ---');

  const apiToken = getApifyToken(brand);
  if (!apiToken) {
    logger.error('No Apify API token configured. Set APIFY_API_TOKEN in Agents/.env');
    return { scraped: 0, imported: 0, duplicatesSkipped: 0 };
  }

  const actorId = brand.apify?.actorId || 'IoSHqwTR9YGhzccez';
  const input = await buildApifyLeadsInputForBrand(brand, opts);

  logger.info(
    `Apify actor=${actorId} fetch_count=${input.fetch_count} ` +
    `locations=${(input.contact_location || []).join(', ')} ` +
    `filterFields=${Object.keys(input).length}`
  );
  if ((brand.slug || '').toLowerCase() === 'leads-gulf') {
    logger.info(`[Leads-Gulf] Apify input fetch_count=${input.fetch_count} (test cap; Co-Ventech prod limit not used)`);
  }

  let rawItems;
  try {
    rawItems = await runActor(apiToken, actorId, input);
  } catch (err) {
    logger.error(`Apify actor failed: ${err.message}`);
    return { scraped: 0, imported: 0, duplicatesSkipped: 0 };
  }

  if (!rawItems.length) {
    logger.warn('Apify returned 0 items');
    return { scraped: 0, imported: 0, duplicatesSkipped: 0 };
  }

  const mapped = mapToContacts(rawItems);
  logger.info(`Mapped ${mapped.length}/${rawItems.length} items with valid emails`);

  const qualifier = new LeadQualifier(logger, brand.qualification?.threshold ?? 6);
  const { qualified } = qualifier.qualifyBatch(mapped);
  logger.info(`Qualified ${qualified.length}/${mapped.length} above threshold`);

  if (!qualified.length) {
    return { scraped: rawItems.length, imported: 0, duplicatesSkipped: 0 };
  }

  const emails = qualified.map(c => c.email);
  const existing = await Contact.find({ brandId: brand._id, email: { $in: emails } }).select('email');
  const existingSet = new Set(existing.map(c => c.email));
  const toInsertRaw = qualified.filter(c => !existingSet.has(c.email));

  // Create an ImportBatch for this scrape run so user can pause/resume per scrape
  let batchId = null;
  if (toInsertRaw.length > 0) {
    const ImportBatch = require('../models/ImportBatch');
    const batchName = `Apify scrape - ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const batch = await ImportBatch.create({
      brandId: brand._id,
      name: batchName,
      source: 'apify_scrape',
      count: toInsertRaw.length,
      paused: false
    });
    batchId = batch._id;
  }
  const toInsert = toInsertRaw.map(c => ({
    ...c,
    brandId: brand._id,
    status: 'Pending',
    importSource: 'apify-cron',
    ...(batchId ? { importBatchId: batchId } : {})
  }));

  let inserted = 0;
  if (toInsert.length) {
    try {
      const result = await Contact.insertMany(toInsert, { ordered: false });
      inserted = result.length;
    } catch (err) {
      if (err.code === 11000) {
        inserted = err.result?.nInserted || 0;
      } else {
        logger.error(`InsertMany error: ${err.message}`);
      }
    }
  }

  const duplicatesSkipped = qualified.length - toInsert.length + (toInsert.length - inserted);
  logger.info(`Auto-imported ${inserted} new contacts (${duplicatesSkipped} duplicates skipped)`);

  return { scraped: rawItems.length, imported: inserted, duplicatesSkipped };
}

module.exports = scrapeLeadsPhase;
