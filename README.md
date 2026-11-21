# Nile Therapy Portal

Internal website for Nile Therapy:

- **Login page.** Founders and doctors sign in with a username and password.
- **Doctor portal.** Doctors log sessions (patient, type, place, date/time, minutes, notes) and can see and edit their own sessions.
- **Founder dashboard.**
  - **Sessions.** Every logged session, grouped by doctor or in one list, with search and filters. Founders can add a session for a doctor, and **Export to Excel (CSV)** downloads the current filtered view.
  - **Doctors.** Profile cards for each doctor. A doctor's page shows their info, session count, patients and history. From here founders add a doctor (the password is generated for them), edit a profile, turn an account off, or reset a password.
  - **My AI room.** Each founder has a private chat with Claude. The other founders can't see it. The AI sees the live sessions and doctors data and keeps a **memory** of each founder that is used in every chat. The founder can see and delete what it remembers.

## New version (in progress): GitHub Pages + Supabase

- **Live site:** https://odostore11-creator.github.io/nile-therapy/ . Every push to `main` that changes `public/` republishes it automatically (`.github/workflows/pages.yml`).
- **Data and logins:** Supabase. The tables and permission rules are in `supabase/migrations/`, test data is in `supabase/seed.sql`, and the permission check is `supabase/tests/rls_check.sql`.
- **Preview on your computer:** `node scripts/serve.mjs`, then open http://localhost:5500/nile-therapy/
- **Not done yet:** adding a doctor, resetting a password and the AI chat need Supabase Edge Functions (next step).

The sections below describe the original v0.1 (`server.js`), which is kept as the reference until the new version matches it.

## Run it (v0.1)

Needs **Node.js 22.5 or newer**. That's all: there are no packages to install.

```bash
cp .env.example .env      # then edit .env
node server.js
```

Open http://localhost:3000. On the first run the terminal prints the starting username and password for every account. They are also saved to `data/FIRST_RUN_PASSWORDS.txt`. Log in, change the passwords, then delete that file.

> The "SQLite is an experimental feature" warning is normal.

## Connecting the AI (later)

1. Create an API key at console.anthropic.com and add credits.
2. In `.env` set `ANTHROPIC_API_KEY=sk-ant-...`
3. Restart the server. The yellow "not connected" banner disappears.

Founders can choose between **Sonnet** (fast, the default) and **Opus** (deeper thinking) in the chat header.

## Going live

- Before the real launch, set `SEED_DEMO=0` and delete the `data/` folder. That removes the 4 demo doctors and their sessions.
- Host it on any small server that runs Node: a cheap VPS, Railway or Render. **GitHub Pages won't work**, because it only hosts static files and can't keep the API key secret.
- Put it behind **HTTPS** and set `COOKIE_SECURE=1`.
- **Back up `data/nile.db`.** That single file holds all the data.

## Files

```
server.js        backend: auth, sessions, doctors, CSV export, AI chat + memory
public/          the website (index.html, style.css, app.js, logo.svg)
data/nile.db     database (created on first run)
```
