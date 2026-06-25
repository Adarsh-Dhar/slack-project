# Launchpad 🚀

A Slack bot that coordinates product launches end-to-end — from pre-launch scanning to launch day execution.

## Features

- `/launch [name] [date]` — kick off a new launch workflow
- Pre-launch channel scanning for blockers and open threads
- Canvas-based launch tracker with live updates
- Real-time slip detection and owner DMs
- 48-hour Go/No-Go voting flow
- Daily standup DMs to owners

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env` and fill in your Slack credentials:

```bash
cp .env .env.local
```

| Variable | Description |
|---|---|
| `SLACK_BOT_TOKEN` | Bot OAuth token (`xoxb-…`) |
| `SLACK_SIGNING_SECRET` | App signing secret |
| `SLACK_APP_TOKEN` | Socket Mode app token (`xapp-…`) |
| `DB_PATH` | Path to SQLite database file |
| `STANDUP_CRON` | Cron expression for standup DMs |
| `STANDUP_TIMEZONE` | Timezone for cron |

### 3. Create your Slack App

Import `manifest.json` at [api.slack.com/apps](https://api.slack.com/apps) → *Create New App* → *From manifest*.

Enable **Socket Mode** and generate an App-Level Token with `connections:write` scope.

### 4. Run

```bash
# Development (hot reload)
npm run dev

# Production build
npm run build
npm start
```

## Project Structure

```
src/
├── app.ts            # Bolt app bootstrap
├── config.ts         # Env + constants
├── types.ts          # Shared TypeScript types
├── db/               # SQLite connection & schema
├── handlers/         # Slack event/action/command handlers
├── services/         # Core business logic
└── utils/            # Helpers (parser, block builders)
```

## Database

SQLite via `better-sqlite3`. Schema is auto-applied on startup from `src/db/schema.sql`.

## License

MIT
