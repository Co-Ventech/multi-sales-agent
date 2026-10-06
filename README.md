# Email Marketing Agent

Full-stack platform for automated email campaigns, lead scraping, and pipeline orchestration.

## How It Works

- **Brand Management** — Configure companies with campaign settings, SMTP accounts, and scraping preferences
- **Lead Pipeline** — Import leads from JSON, scrape LinkedIn/Upwork via Apify, qualify and score contacts
- **Email Generation** — AI-powered personalized email content creation with A/B testing support
- **Send & Track** — SMTP rotation with daily limits, timezone filtering, bounce and reply monitoring via IMAP
- **Scheduling** — Cron-based automated pipeline triggers per brand
- **Reporting** — Dashboard with live stats, Google Sheets sync, Slack notifications

## Tech Stack

- **Backend** — Node.js, Express, MongoDB
- **Frontend** — React, Vite
- **Email** — SMTP sending, IMAP bounce tracking
- **Scraping** — Apify actor integration
- **Scheduling** — Node-cron

## Quick Start

See `backend/.env.example` for required environment variables. Requires MongoDB, Apify account (for scraping), and OpenAI API key.

## Pipeline Phases

1. **Import** — Upload/qualify leads, save to DB
2. **Generate** — AI email content creation
3. **Send** — SMTP delivery with tracking
4. **Follow-ups** — Automated follow-up sequences
5. **Bounce check** — IMAP-based delivery failure detection
6. **Scrape** — LinkedIn/Upwork lead generation

## Security

- `.env` files are git-ignored — never commit secrets
- SMTP passwords AES-256 encrypted in MongoDB
- JWT tokens in http-only cookies
- All API routes require authentication