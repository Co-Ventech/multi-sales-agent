# Session Handoff — Sales Outreach Agent v2
Last updated: 2026-04-28

---

## Project Overview
Multi-brand cold email outreach system. AI generates personalized emails, sends via SMTP, tracks replies/bounces.
- **Frontend:** React + Vite (port 3001 in prod via PM2)
- **Backend:** Node.js + Express + MongoDB Atlas
- **Repo:** https://github.com/Co-Ventech/Agents (branch: main)

---

## Production Server
- **IP:** 146.190.143.62 (DigitalOcean)
- **SSH:** `ssh -i "C:\Users\muzam\Downloads\server_key.pem" root@146.190.143.62`
- **App path:** `/root/Sales-outreach-agent-v2/`
- **Process manager:** PM2, process name `sales-agent`
- **Deploy commands:**
  ```bash
  git pull origin main
  cd frontend && npm run build && cd ..
  pm2 restart sales-agent
  ```
- **App URL:** http://146.190.143.62:3001

---

## Database
- **MongoDB Atlas:** `mongodb+srv://admin:admin@cluster0.ifu0n.mongodb.net/email-agent`
- **Encryption key (SMTP passwords):** `23a3d181fe3ba40f56763e9dedb9a112`
- **Encryption IV:** `eb6978b920d8afd5`

---

## Brands Configured

### Co-Ventech (`69e2075ce76ae3046c10184e`)
- **Domain:** co-ventech.co
- **SMTP accounts:**
  - `sophie@co-ventech.co` — FROM NAME: "Sophie | Co-Ventech", SENDER NAME: "Sophie Adams", Title: "Business Development", daily limit: 10
  - `zubairalam@co-ventech.co` — Zubair Alam, CEO, daily limit: 10
- **DMARC:** Fixed today from `p=quarantine` → `p=none` (was causing spam)
- **Domain reputation:** Low (new sending domain, needs warmup — start 5-10/day)

### Recruitinn (`69f06def3b5868769965d8e0`)
- **Domain:** recruitinn.ai
- **SMTP accounts:**
  - `amy@recruitinn.ai` — FROM NAME: "Amy", SENDER NAME: "Amy", Title: "Hiring Specialist", daily limit: 10
- **DMARC:** Already `p=none` — inbox delivery working ✅
- **Contacts imported:** 99 contacts (from Apify dataset, Apr 28)
- **System prompt:** 2215-char prompt set for AI recruitment outreach
- **Model:** gpt-4o, threshold: 5, daily limit: 20

### Co-vental (`69...`) 
- Exists in sidebar, not fully configured yet

---

## Key Architecture

### Email Pipeline Flow
1. **Import** → contacts saved as `Pending`
2. **Generate** → AI writes email using system prompt → status: `Generated`
3. **Send** → SMTP sends email → status: `Sent`
4. **Check Bounces** → IMAP scan → updates to `Replied` or `Bounced`

### A/B Testing
- Enabled per brand in **A/B Testing** page (now in sidebar)
- When enabled: even contacts → Variant A prompt, odd → Variant B prompt
- **Default system prompt is IGNORED when A/B is enabled** — both A and B prompts must be complete
- Stats shown on A/B page after emails are sent

### Email Format
- Sent as `multipart/alternative` (text + HTML) — matches real email clients
- HTML is clean: Arial 14px, paragraph spacing, no tracking links
- All URLs stripped from body automatically
- Signature: Name + Title only (2 lines)

---

## What Was Fixed Today

| Issue | Fix |
|---|---|
| Emails going to spam | Changed from plain text to multipart/alternative HTML |
| No paragraph spacing | Added explicit format to AI prompt + post-processing in smtpSender |
| co-ventech.co → spam | DMARC changed from `p=quarantine` to `p=none` in Hostinger DNS |
| Cron fields hard to use | Replaced cron syntax with human-readable dropdowns in Settings |
| A/B Testing missing | Added it back to sidebar nav |
| Per-contact send/generate | Added buttons in contact modal |

---

## Settings Page — Key Fields

- **System Prompt:** Main AI instructions (ignored when A/B is on)
- **Model:** GPT-4.1 Mini recommended for cold email
- **Temperature:** 0.75 default
- **Max Tokens:** 400 default
- **Daily Limit:** per brand total sends/day
- **Timezone Filter:** sends only 9am-5pm recipient's local time
- **Spam Filter:** blocks emails with spam phrases before sending
- **Automation:** enable cron, set friendly schedule (e.g. "Check replies every 30 min")

---

## Automation Schedule (Recommended for Recruitinn)
Go to Settings → Automation:
- Enable: ON
- Timezone: America/New_York (US contacts)
- Generate: 5:00 PM on Weekdays (generates night before)
- Send: 9:00 AM on Weekdays
- Check Bounces: Every 30 minutes

---

## Apify Lead Generation
- **Actor:** `IoSHqwTR9YGhzccez`
- **Reference file:** `docs/recruitinn-apify-input.json` (valid input format)
- **Valid revenue values:** "100K", "500K", "1M", "5M", "10M", "25M", "50M", "100M", "500M", "1B"
- **Valid functional_level:** "engineering", "product_management", "information_technology" ONLY
- **Import:** Contacts page → Import JSON button

---

## Important Files

| File | Purpose |
|---|---|
| `backend/src/services/smtpSender.js` | Sends emails, builds multipart/alternative |
| `backend/src/utils/emailTemplates.js` | AI prompt templates (minimal mode + full mode) |
| `backend/src/services/openaiService.js` | OpenAI email generation |
| `backend/src/pipeline/generatePhase.js` | Assigns A/B variants, generates emails |
| `backend/src/pipeline/runner.js` | Orchestrates pipeline actions |
| `backend/src/services/schedulerService.js` | Cron scheduler for auto runs |
| `backend/src/api/routes/stats.js` | Stats + `/stats/ab` A/B endpoint |
| `backend/src/api/routes/preview.js` | Preview + `/preview/ab` endpoint |
| `frontend/src/pages/brand/Settings.jsx` | All brand settings UI |
| `frontend/src/pages/brand/Pipeline.jsx` | Manual pipeline triggers |
| `frontend/src/pages/brand/AbTest.jsx` | A/B testing config + stats |
| `frontend/src/components/Layout/Sidebar.jsx` | Nav links |

---

## DNS Status

### recruitinn.ai ✅
- SPF: `v=spf1 include:_spf.mail.hostinger.com ~all`
- DKIM: hostingermail-a/b/c CNAMEs configured
- DMARC: `v=DMARC1; p=none`

### co-ventech.co ✅ (fixed today)
- SPF: same as above
- DKIM: hostingermail-a/b/c CNAMEs + old `hostingermail1` TXT key (can delete)
- DMARC: `v=DMARC1; p=none` (changed from quarantine today)

---

## Remaining Tasks / Next Steps

1. **Warm up co-ventech.co domain** — send 5-10/day for 2-3 weeks before scaling
2. **Delete old DKIM key** — `hostingermail1._domainkey` TXT record on co-ventech.co (leftover, not needed)
3. **Reset test contacts** — Sek Chai and Ryan's emails were changed to test addresses; change back to real emails before running pipeline
4. **Configure Recruitinn automation** — Enable cron in Settings, set schedule
5. **Set up A/B testing** — If you want to test two different prompts for Recruitinn
6. **Add more SMTP accounts** — For higher volume, add more sending accounts (rotate across them)
7. **Check bounce detection** — Run "Check Bounces" after emails are sent to pull replies into the system

---

## Login
- App runs at http://146.190.143.62:3001
- Auth is session-based (cookie)

---

## Common SSH Commands
```bash
# SSH in
ssh -i "C:\Users\muzam\Downloads\server_key.pem" root@146.190.143.62

# Check app status
pm2 status

# View logs
pm2 logs sales-agent --lines 50

# Restart after code change
cd /root/Sales-outreach-agent-v2
git pull origin main
cd frontend && npm run build && cd ..
pm2 restart sales-agent

# Query database
node -e "
const mongoose = require('/root/Sales-outreach-agent-v2/backend/node_modules/mongoose');
mongoose.connect('mongodb+srv://admin:admin@cluster0.ifu0n.mongodb.net/email-agent').then(async () => {
  // your query here
  process.exit(0);
});
"
```
