# Sales Outreach Agent — Complete Reference Guide

**Version:** Current (April 2026)  
**Stack:** Node.js / Express / MongoDB / React / OpenAI / Nodemailer

---

## 1. What This System Does

An automated cold email outreach platform. You upload a list of leads, the AI writes a personalized email for each one based on their profile, and the system sends them automatically on a schedule. It monitors for replies and bounces, tracks stats per brand, and supports multiple independent brands from one dashboard.

---

## 2. How Qualification Works

When you import a contact list (JSON file), every lead is automatically **scored 1–10** before being saved to the database. Leads below your threshold (default: 6) are rejected and never emailed.

### Scoring Formula (weighted)

| Dimension | Weight | What it checks |
|-----------|--------|---------------|
| Industry | 30% | How well the company's industry matches your target market |
| Seniority | 25% | Whether the contact is a decision-maker |
| Company Size | 20% | Whether the company is the right size (startup/midmarket) |
| Geography | 15% | Whether the contact is in a high-value country |
| Tech Stack Bonus | 10% | Whether the company already uses QA/CI tools |

### Industry Scores

| Score | Industries |
|-------|-----------|
| 10 | Computer Software, SaaS |
| 9 | Internet, Financial Services, FinTech, Hospital & Health Care |
| 8 | Medical Devices, IT & Services, Cybersecurity |
| 7 | Logistics, E-commerce, Automotive, Blockchain |
| 6 | Retail, Telecom, Education, E-learning |
| 4 | All other industries (default) |

### Seniority Scores

| Score | Levels |
|-------|--------|
| 10 | C-Suite (CEO, CTO, COO…), Founder, Owner |
| 9 | VP |
| 8 | Director, Head |
| 7 | Partner |
| 6 | Manager |
| 4 | Senior |
| 3 | All others (default) |

### Company Size Scores

| Score | Employee Count |
|-------|---------------|
| 10 | 51–100 (sweet spot) |
| 9 | 21–50 or 101–200 |
| 8 | 201–500 |
| 5 | 501–1,000 |
| 3 | 2–10 or 1,001–2,000 |
| 2 | 2,001–5,000 |
| 1 | 5,001–10,000+ (too large) |

### Geography Scores

| Score | Countries |
|-------|----------|
| 10 | United States |
| 9 | Canada |
| 8 | UAE, Australia |
| 7 | United Kingdom |
| 6 | Germany, Netherlands |
| 4 | All others (default) |

### Tech Stack Bonus

If the company's tech stack includes any of these tools, the lead gets a +1 bonus (10% weight):
Selenium, Cypress, Playwright, Appium, TestNG, Pytest, Jest, Mocha, Jenkins, GitHub Actions, CircleCI, Jira, Postman, k6, JMeter

### Example Score Calculation

A lead is: CTO at a 75-person SaaS company in the US using Cypress.

- Industry: SaaS = 10 × 0.30 = 3.0
- Seniority: C-suite = 10 × 0.25 = 2.5
- Company size: 51–100 = 10 × 0.20 = 2.0
- Geography: US = 10 × 0.15 = 1.5
- Tech bonus: Cypress = 10 × 0.10 = 1.0
- **Total: 10/10 → Qualified**

### Threshold Setting

The threshold is set per brand in **Settings → Lead Score Threshold**. Default is 6. Raise it (e.g. to 7) to be more selective. Lower it (e.g. to 4) to accept more leads.

> **Note:** If your import shows a low qualification rate (under 10%), the system logs a warning. This means your lead list doesn't match the scoring criteria — review your targeting or lower the threshold.

---

## 3. Frontend Pages — Complete Reference

### 3.1 Overview (Dashboard)

Your main stats page. Refreshes on demand.

**Stats Cards (top row)**
- **Total Contacts** — all leads in the database for this brand
- **Ready to Send** — contacts with Generated or Pending status (will be emailed on next automated run)
- **Sent Today** — emails sent today across all SMTP accounts combined
- **Replied** — total prospects who replied
- **Reply Rate** — (Replied ÷ Sent) × 100
- **Bounced** — emails confirmed undeliverable

**Weekly/Monthly Cards**
- **This Week** — emails sent since Sunday (+ trend % vs last week)
- **Last Week** — emails sent the previous week
- **This Month** — emails sent since 1st of current month

**Automated Schedule Banner (blue)** — appears when cron is enabled  
Shows: Generate time, Send time, Bounce Check time — all in both configured timezone AND Pakistan time (PKT). Also shows how many contacts are queued for next run.

**Yellow Warning Banner** — appears when cron is disabled  
Reminds you to use the Pipeline page for manual runs.

**Status Breakdown** — count of every contact status (Pending, Generated, Sent, Replied, Bounced, Failed, SpamBlocked, DryRun)

**SMTP Rotation Today** — progress bar per account: sent today / daily limit

---

### 3.2 Contacts

Full lead management.

**Import JSON** — Upload a `.json` file of leads. System runs qualification scoring, deduplicates by email, saves passing leads with status `Pending`.

**Export CSV** — Download all contacts for this brand as a CSV.

**Clear All** — Delete ALL contacts for this brand. Irreversible (asks confirmation).

**Status filter tabs** — Filter contacts by status (All, Pending, Generated, Sent, Replied, etc.)

**Search** — Search by name, email, or company name.

**Clicking a contact row** opens the Contact Modal:

| Tab | Contents |
|-----|----------|
| Contact Details | Full profile: name, email, title, headline, seniority, LinkedIn, lead score, company, domain, industry, size, revenue, funding, tech stack, location |
| Edit mode | Edit: first name, last name, email, company, job title, status, **email subject**, **email body** (before it's sent) |
| Email Preview | Shows the AI-generated email in client format (From/To/Subject/Body). Shows sent time and which SMTP sent it. |
| Reply | Full reply text from the prospect + received timestamp (only appears when status is Replied) |
| Tracking | Pipeline status, A/B variant, sent from, date sent/replied/bounced, import source, lead score |

**Editing the email before sending:**  
In Edit mode, if an email has been generated, a section appears at the bottom to edit the Subject Line and Email Body. Changes save directly to the database. The send phase uses whatever is saved — so this lets you review and correct AI output before it goes out.

---

### 3.3 SMTP Accounts

Configure the email sending accounts.

**Add Account** fields:
- Host (e.g. `smtp.hostinger.com`)
- Port (587 = STARTTLS, 465 = SSL)
- Username + Password (stored AES-256 encrypted)
- From Email + From Name (shown in recipient's inbox)
- Sender Name + Position (used in email signature: `Name\nPosition`)
- Reply-To address (optional)
- Daily Limit — max emails from this account per day
- Warmup Start Date — when set, the account starts at 5 emails/day, then 10, then 15 (over 3 weeks), then full limit
- Use SSL / Use TLS toggles

**Test Connection** — Verifies credentials work. Shows success or error message.

**Rotation logic:** The system automatically picks the SMTP account with the lowest send count today. Atomically claims the slot to prevent race conditions. If an account hits its daily limit, it's skipped and the next one is used.

---

### 3.4 Preview

Test what an AI-generated email will look like for a specific contact before running the full pipeline.

**Select from existing contacts** — Search box at the top. Type a name, email, or company. Pick from dropdown — all fields auto-fill instantly.

**Manual fields** — Can also fill in manually or edit after selecting: First/Last name, Job title, Company, Industry, Country, Tech stack (comma-separated), Company description, Company size, Seniority.

**Generate Preview** — Calls OpenAI with your brand's system prompt + this contact's data. Returns subject line + email body. Shows token count used.

---

### 3.5 Pipeline

Manual control and monitoring of all pipeline operations.

**Pipeline Actions:**

| Action | What it does |
|--------|-------------|
| Generate | AI writes emails for all `Pending` contacts. Sets status to `Generated`. Does NOT send. |
| Send | Sends all `Generated` contacts. Respects daily limits, random delays, timezone filter. |
| Full | Import → Generate → Send in one go |
| Check Bounces | Polls all SMTP account IMAP inboxes. Detects bounces (mailer-daemon, undeliverable) and replies. Updates contact statuses. Notifies via Slack/email if configured. |
| Dry Run | Simulates the send phase without actually sending. Shows what would happen. Sets status to `DryRun`. |

**Real-time Log Stream** — Every log line appears as the pipeline runs. Streams via Server-Sent Events (SSE).

**Run History** — Last 20 pipeline runs showing: action, status (running/completed/failed), results (sent/failed/bounced counts), start time, duration.

---

### 3.6 Settings

All brand configuration in one page.

#### Brand & Company
- Brand Name (required)
- Company Name, Website, Description

#### AI System Prompt
The complete instruction set for the AI. Write everything here:
- **Tone** — e.g. "Direct, conversational, no buzzwords"
- **CTA** — e.g. "End every email with: Worth a quick call?"
- **Value Proposition** — e.g. "We help SaaS companies reduce QA costs by 60%"
- **Calendly link** — paste the booking URL here
- **Case studies** — 2–3 examples with real metrics for the AI to reference
- **Writing rules** — word count limit, no links, etc.

**AI Model Settings:**
- Model — gpt-4.1, gpt-4.1-mini, gpt-4o, gpt-4o-mini
- Temperature — 0 to 2 (higher = more creative/varied)
- Max Tokens — 100 to 2000 (controls max email length)
- Lead Score Threshold — 1–10 (leads below this score rejected at import)

#### Send Settings
- **Daily Send Limit** — max emails per day across all SMTP accounts
- **Delay Min/Max (seconds)** — random wait between each send (makes sending look human)
- **Timezone Filter** — only sends to contacts when it is 9AM–5PM in their country. Contacts outside business hours are skipped and retried on the next run.
- **Spam Word Filter** — scans generated email for spam trigger words (free, urgent, guaranteed, etc.) before sending. If triggered, marks contact as SpamBlocked instead of sending.

#### Scheduled Automation
- Enable/disable cron toggle
- **Generate Emails cron** — when to generate emails (recommended: night before sending). Example: `0 17 * * 0-4` = Sun–Thu 5PM
- **Send Emails cron** — when to send. Example: `0 9 * * 1-5` = Mon–Fri 9AM
- **Check Bounces cron** — when to poll inboxes. Example: `0 11 * * *` = every day 11AM
- **Timezone dropdown** — America/New_York, Chicago, Los_Angeles, UTC, Asia/Karachi, Europe/London

> Cron times are set in recipient timezone (e.g. America/New_York for US contacts). Overview shows equivalent Pakistan time so you know when jobs will actually fire.

#### Notifications
- Slack webhook URL + toggle for reply/bounce alerts
- Email address for reply notifications
- Email address for bounce notifications

#### Delete Brand
Permanently deletes the brand and all associated contacts, SMTP accounts, pipeline logs, and bounce records.

---

## 4. Lead Contact Statuses

| Status | Meaning |
|--------|---------|
| Pending | Imported, waiting for email generation |
| Generated | AI has written the email, waiting to be sent |
| Sent | Email delivered |
| Replied | Prospect responded |
| Bounced | Email delivery failed permanently |
| Failed | Send attempt errored (SMTP error, etc.) |
| SpamBlocked | Spam filter caught the email before sending |
| DryRun | Processed in a dry run (not actually sent) |

---

## 5. What's Customizable

| Thing | Where to configure |
|-------|-------------------|
| Email content, tone, CTA, value prop | System prompt in Settings |
| Which leads get through (scoring) | Qualification threshold in Settings |
| How many emails per day | Daily limit in Settings + per-SMTP daily limit |
| When emails send | Cron schedule in Settings |
| Which SMTP account sends what | Automatic rotation (picks least-used account) |
| Email signature (Name + Position) | Sender Name + Position on each SMTP account |
| Business hours filtering | Timezone Filter toggle in Settings |
| Multiple brands | Each brand is fully independent |
| Model and creativity level | OpenAI settings in Settings |
| Warmup ramp speed | Warmup Start Date on SMTP account |

---

## 6. What the System Cannot Do

| Limitation | Reason |
|-----------|--------|
| HTML emails | Removed — HTML triggers spam/Promotions tab |
| Link click tracking | Removed — tracking links hurt deliverability |
| Follow-up email sequences | Removed — adds complexity and spam signals |
| Apify lead scraping (UI) | Hidden from navigation (backend still works) |
| Google Sheets sync (UI) | Hidden from navigation (backend still works) |
| A/B testing (UI) | Hidden from navigation (backend still works) |
| Mass edit of email bodies | One contact at a time via modal |
| Unsubscribe flow | Not implemented |
| Attachments | Not supported |
| CC / BCC | Not supported |

---

## 7. Changes: Old Agent vs Current Agent

| Feature | Old Agent | Current Agent |
|---------|-----------|---------------|
| Email format | HTML + plain text | Plain text only |
| Tracking links | Calendly click tracking with UTM params | Removed |
| Follow-up emails | 3-touch automated sequences | Removed |
| Google Sheets | Full bidirectional sync | Hidden from UI |
| Apify lead scraping | Full UI page | Hidden from UI |
| A/B testing | Full UI page | Hidden from UI |
| Campaign settings | Separate Campaign page | Merged into Settings |
| Email signature | Name + Position + Phone + Website | Name + Position only |
| SMTP config | Had requireTLS causing spam issues | Cleaned up, plain STARTTLS |
| Cron | Send only | Generate + Send + Bounce Check |
| Scheduler startup | 1-retry | 3-retry (more reliable) |
| PM2 logs | No timestamps | Timestamps (YYYY-MM-DD HH:mm:ss) |
| Overview page | Quick actions + recent sends table | Weekly/monthly stats + cron schedule in PKT |
| Preview page | Manual form entry only | Search + select from existing contacts |
| Contact edit | Name / email / status only | + Email subject and body editable |
| Navigation items | 9 pages | 6 pages (cleaner) |
| URLs in emails | AI could sneak in links | Regex strips any URL from email body |
| Phone in signature | Included | Removed (fewer spam signals) |

---

## 8. Recommended Workflow

```
Step 1 — Settings
  → Write system prompt (tone, CTA, value prop, Calendly link, case studies)
  → Add SMTP accounts (with warmup start date)
  → Set daily limit and delays
  → Configure cron schedule (optional)

Step 2 — Contacts
  → Import JSON file of leads
  → Check how many qualified (shown in import result)

Step 3 — Pipeline → Generate
  → AI writes emails for all Pending contacts
  → Review generated emails in Contacts page
  → Edit any email that needs improvement

Step 4 — Pipeline → Send
  → System sends all Generated contacts
  → Respects daily limits, delays, timezone filter

Step 5 — Overview
  → Monitor reply rate, bounce rate, weekly volume
  → Track SMTP rotation (make sure no account is hitting limit)

Step 6 — Pipeline → Check Bounces
  → Run after sends to detect replies and hard bounces
  → Replied contacts get reply content saved, status updated
  → Bounce contacts excluded from future sends
```

---

## 9. Environment Requirements

| Variable | Required | Purpose |
|----------|----------|---------|
| MONGO_URI | Yes | MongoDB Atlas connection string |
| OPENAI_API_KEY | Yes | OpenAI API for email generation |
| ENCRYPTION_KEY | Yes | 32-character AES-256 key for SMTP passwords |
| ENCRYPTION_IV | Yes | 16-character IV for AES-256 |
| JWT_SECRET | Yes | Session authentication |
| FRONTEND_URL | Yes | CORS origin (e.g. https://yourdomain.com) |
| GOOGLE_SERVICE_ACCOUNT_JSON | No | Google Sheets sync (optional) |
| PORT | No | Server port (default 3001) |

---

*Last updated: April 2026*
