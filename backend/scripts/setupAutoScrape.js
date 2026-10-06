/**
 * One-time setup script:
 *   - Save Co-Ventech merged Apify filter (Test A + Test B union, fetch_count=10 for test)
 *   - Save Recruitinn Apify filter (fetch_count=10 for test)
 *   - Set cron.scrapeLeads on both brands to fire today at 14:05 PKT (one-shot test)
 *   - Set campaign.followUpDays = [6] on both brands
 *   - Set cron.sendFollowups = '0 10 * * *' on both brands
 *   - Set default soft follow-up prompt on both brands
 *   - Ensure cron.enabled = true on both brands
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const mongoose = require('mongoose');
const Brand = require('../src/models/Brand');

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
if (!APIFY_TOKEN) {
  console.error('APIFY_API_TOKEN is required in Agents/.env');
  process.exit(1);
}

const COVENTECH_FILTER = {
  company_industry: [
    "computer software",
    "information technology & services",
    "financial services",
    "computer & network security",
    "health, wellness & fitness",
    "information services"
  ],
  company_keywords: [
    "SaaS","B2B","B2B SaaS","AI","AI Development","Enterprise Software","fintech","healthtech","Edtech",
    "marketplace","platform","API","cloud","QA","Devops","Web Development","Web development",
    "Cybersecurity","Testing","Automation","Test Automation"
  ],
  contact_city: [
    "San Francisco Bay Area","New York","Austin","Seattle","Boston","Denver","Chicago",
    "Atlanta","Dallas","Los Angeles","Miami"
  ],
  contact_job_title: [
    "CTO","Chief Technology Officer","CEO","VP of Engineering","Head of Engineering",
    "Co-Founder","Technical Co-Founder",
    "Director of QA","QA Director","Head of QA","QA Manager","Quality Engineering Manager",
    "Director of Quality Engineering","Engineering Manager","Director of Engineering",
    "Director of Software Engineering","Test Automation Lead","SDET Manager"
  ],
  contact_location: ["united states"],
  contact_not_job_title: ["Sales","Marketing","Customer Support","Intern"],
  email_status: ["validated"],
  fetch_count: 10,
  file_name: "Co-Ventech Auto-Scrape (Test)",
  functional_level: ["c_suite","engineering","information_technology"],
  funding: ["angel","seed","series_a","series_b","series_c"],
  max_revenue: "5M",
  seniority_level: ["c_suite","founder","owner","director","vp","manager","head"],
  size: ["1-10","11-20","21-50","51-100","101-200","201-500"]
};

const RECRUITINN_FILTER = {
  company_industry: [
    "computer software","internet","information technology & services","financial services",
    "computer & network security","computer networking","information services","human resources",
    "consumer services","staffing & recruiting","outsourcing/offshoring"
  ],
  company_keywords: [
    "software","saas","Human Resources","product","startup","tech","AI","Artificial Intelligence",
    "Recruitment ","Hiring","Interviews","Automation"
  ],
  company_not_keywords: ["staffing & recruiting","recruitment agency","outsourcing","consulting"],
  contact_job_title: [
    "founder","co-founder","ceo","vp of talent","head of talent","head of hr",
    "hr manager","talent acquisition manager","chief people officer"
  ],
  contact_location: ["united states"],
  contact_not_job_title: ["intern","student","contractor","freelance"],
  email_status: ["validated"],
  fetch_count: 10,
  file_name: "Recruitinn Auto-Scrape (Test)",
  functional_level: ["human_resources","c_suite"],
  funding: ["seed","angel","series_a","series_b","venture_round","convertible_note"],
  max_revenue: "25M",
  seniority_level: ["founder","owner","c_suite","head","manager"],
  size: ["21-50","51-100","101-200"]
};

const SOFT_FOLLOWUP_PROMPT = `Write a short, friendly follow-up to the previous email.

- Tone: warm, respectful, polite. Not pushy. Not salesy.
- Acknowledge they may have missed the first email.
- Briefly restate the value in ONE sentence (do not repeat the original email).
- End with a soft yes/no question (e.g. "Would it be alright if I shared a quick overview?").
- Keep it under 60 words total.
- Do NOT use phrases like "just checking in", "circling back", or "per my last email".`;

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  // Test cron: fire today at 14:05 PKT (Asia/Karachi), one-shot
  const TEST_CRON = '5 14 5 5 *';  // minute=5, hour=14, day=5, month=5

  const updates = [
    { name: 'Co-Ventech', filter: COVENTECH_FILTER },
    { name: 'Recruitinn', filter: RECRUITINN_FILTER }
  ];

  for (const { name, filter } of updates) {
    const b = await Brand.findOne({ name });
    if (!b) { console.log(`[SKIP] Brand "${name}" not found`); continue; }

    b.apify = b.apify || {};
    b.apify.apiToken = APIFY_TOKEN;
    b.apify.actorId = 'IoSHqwTR9YGhzccez';
    b.apify.defaultInput = filter;
    b.markModified('apify');

    b.campaign = b.campaign || {};
    b.campaign.followUpDays = [6];
    if (!b.campaign.followUpPrompt) {
      b.campaign.followUpPrompt = SOFT_FOLLOWUP_PROMPT;
    }
    b.markModified('campaign');

    b.cron = b.cron || {};
    b.cron.scrapeLeads = TEST_CRON;
    b.cron.sendFollowups = '0 10 * * *';
    b.cron.timezone = 'Asia/Karachi';
    b.cron.enabled = true;
    b.markModified('cron');

    await b.save();
    console.log(`[OK] ${name}: scrapeLeads=${TEST_CRON} (Asia/Karachi), followUpDays=[6], cron.enabled=true`);
  }

  console.log('\nDone. Restart the backend so the scheduler reloads.');
  process.exit(0);
})().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
