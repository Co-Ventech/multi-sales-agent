# Sales Outreach Agent v2

Multi-brand email outreach automation system with lead scraping, A/B testing, bounce tracking, and Google Sheets reporting.

## Features

- **Multi-brand** — manage multiple companies (Co-Ventech, RecruitN, SkillBuilder, etc.) under one admin
- **Lead scraping** — Apify actor integration (IoSHqwTR9YGhzccez "Leads Finder") with full filter UI
- **Email pipeline** — import leads → generate personalized emails via OpenAI → send via SMTP rotation
- **A/B testing** — two email variants per campaign, tracked separately
- **SMTP rotation** — multiple accounts per brand with daily send limits and warmup ramp
- **Bounce/reply tracking** — IMAP polling detects bounces and replies automatically
- **Google Sheets sync** — campaign results exported to a shared sheet
- **Slack notifications** — instant alerts on replies and bounces
- **Calendar tracking** — Calendly links routed through backend for UTM tracking
- **Dashboard** — live stats: sent, opened, replied, bounced per brand/campaign

## Tech Stack

| Layer    | Stack                              |
|----------|------------------------------------|
| Backend  | Node.js 18, Express, MongoDB       |
| Frontend | React 18, Vite, React Router       |
| AI       | OpenAI GPT-4o                      |
| Scraping | Apify (actor IoSHqwTR9YGhzccez)    |
| Email    | Nodemailer (SMTP) + node-imap      |
| Auth     | JWT (http-only cookies) + bcrypt   |
| Sheets   | Google Sheets API v4               |
| Notify   | Slack Incoming Webhooks            |

## Quick Start (Local)

### Prerequisites

- Node.js 18+
- MongoDB running locally (`mongod`)
- An Apify account + API token (for lead scraping)
- OpenAI API key (for email generation)

### 1. Clone & install

```bash
git clone https://github.com/Co-Ventech/Agents.git
cd Agents/Sales-outreach-agent-v2

# Install backend
cd backend && npm install

# Install frontend
cd ../frontend && npm install
```

### 2. Configure environment

Copy the example and fill in your values:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env`:

```env
# MongoDB (local)
MONGO_URI=mongodb://localhost:27017/email-agent

# JWT (generate: openssl rand -hex 32)
JWT_SECRET=your_jwt_secret_here

# AES-256 encryption for SMTP passwords
ENCRYPTION_KEY=your_32_char_hex_key
ENCRYPTION_IV=your_16_char_hex_iv

# OpenAI
OPENAI_API_KEY=sk-proj-...

# App
PORT=3001
SERVER_URL=http://localhost:3001
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

### 3. Start the servers

```bash
# Terminal 1 — backend
cd backend && npm run dev

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open http://localhost:5173

### 4. First login

Navigate to http://localhost:5173/register and create your admin account. Then log in.

## Environment Variables Reference

| Variable         | Required | Description                                           |
|------------------|----------|-------------------------------------------------------|
| `MONGO_URI`      | Yes      | MongoDB connection string                             |
| `JWT_SECRET`     | Yes      | Secret for signing JWT tokens (32+ bytes)             |
| `ENCRYPTION_KEY` | Yes      | AES-256-CBC key for SMTP passwords (32 hex chars)     |
| `ENCRYPTION_IV`  | Yes      | AES-256-CBC IV (16 hex chars)                         |
| `OPENAI_API_KEY` | Yes      | OpenAI API key for email generation                   |
| `PORT`           | No       | Backend port (default: 3001)                          |
| `SERVER_URL`     | No       | Backend URL (default: http://localhost:3001)          |
| `FRONTEND_URL`   | No       | Frontend URL for CORS (default: http://localhost:5173)|
| `APIFY_API_TOKEN`| No       | Fallback Apify token (can also set per-brand in UI)   |
| `SLACK_WEBHOOK`  | No       | Slack webhook URL for reply/bounce notifications      |
| `LOG_LEVEL`      | No       | Logging verbosity: debug/info/warn/error              |

## Project Structure

```
Sales-outreach-agent-v2/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── middleware/     # auth, asyncHandler
│   │   │   └── routes/         # brands, contacts, smtp, pipeline, apify, auth
│   │   ├── models/             # MongoDB schemas
│   │   ├── pipeline/           # importPhase, generatePhase, sendPhase, followUpPhase, bouncePhase
│   │   ├── services/           # openaiService, smtpSender, imapChecker, apifyService, etc.
│   │   └── utils/              # encryption, logger, apifyActorSchema
│   └── server.js
└── frontend/
    └── src/
        ├── api/                # axios client
        ├── components/         # Layout, Sidebar, AuthGuard
        └── pages/
            ├── Login.jsx
            ├── Register.jsx
            ├── Dashboard.jsx
            └── brand/          # Contacts, Pipeline, Smtp, Settings, Apify
```

## Apify Lead Scraping

1. Go to **Brand → Fetch Leads (Apify)**
2. Enter your Apify API token (or save it in brand settings)
3. Set filters: job titles, seniority, location, company size, industry, etc.
4. Set `fetch_count` — **max 1,000 per run** to protect credits
5. Click **Fetch Leads** — actor runs (1–5 mins), results appear in a table
6. Review contacts: new ones are highlighted, existing DB contacts are flagged
7. Select the contacts you want → click **Import Selected**

## Email Pipeline

1. **Import phase** — qualify leads, dedup, write to DB
2. **Generate phase** — OpenAI writes personalized emails (A + B variants)
3. **Send phase** — SMTP rotation with daily limits, warmup ramp, timezone filtering
4. **Follow-up phase** — scheduled multi-touch sequences
5. **Bounce check phase** — IMAP polling detects delivery failures and replies

## Deployment (DigitalOcean / Ubuntu)

```bash
# Install Node 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install MongoDB
# Follow: https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/

# Clone and install
git clone https://github.com/Co-Ventech/Agents.git
cd Agents/Sales-outreach-agent-v2/backend
npm install --production

# Set up environment
cp .env.example .env && nano .env

# Run with PM2
npm install -g pm2
pm2 start server.js --name email-agent
pm2 save && pm2 startup

# Build frontend
cd ../frontend
npm install && npm run build
# Serve dist/ with nginx or any static host
```

## Security Notes

- SMTP passwords are AES-256-CBC encrypted in MongoDB
- JWT tokens in http-only cookies (not localStorage)
- `.env` files are git-ignored — never commit secrets
- All API routes require authentication
- Input validation on all endpoints

## License

Private — Co-Ventech internal tool.
