# Jira Worklogs (Express)

Simple Express web server to compute your Jira worklogs for a date range.

## Requirements
- Node.js 18+ (tested on Node 22)
- Jira Cloud access and an API token

## Setup
1) Install dependencies:
```bash
npm install
```

2) Create `.env` next to `index.js`:
```env
JIRA_BASE=https://your-domain.atlassian.net
JIRA_EMAIL=you@example.com
JIRA_TOKEN=your_api_token
```

## Run
```bash
npm start
```

Open in your browser:
```
http://localhost:3000
```

## Usage
1) Pick `From` and `To` dates with the date picker.
2) Optionally enter `Project key` (e.g. `PT`).
3) Toggle `Show per-issue breakdown`.
4) Click **Fetch**.

Results:
- Shows total hours.
- Lists issues with clickable Jira links.

## Notes
- UI uses Tailwind via CDN (`https://cdn.tailwindcss.com`).
- Server serves static files from `public/` and exposes:
  - `GET /api/config` — returns `jiraBase`
  - `GET /api/worklogs?from=YYYY-MM-DD&to=YYYY-MM-DD&project=KEY&perIssue=1`

## Common errors
- `Missing env vars` — check `.env`.
- Jira API errors — ensure the token is valid and you have access.
