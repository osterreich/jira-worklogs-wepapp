import "dotenv/config";
import axios from "axios";
import express from "express";

const JIRA_BASE = process.env.JIRA_BASE;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_TOKEN = process.env.JIRA_TOKEN;

if (!JIRA_BASE || !JIRA_EMAIL || !JIRA_TOKEN) {
  console.error("Missing env vars: JIRA_BASE, JIRA_EMAIL, JIRA_TOKEN");
  process.exit(1);
}

const authHeader =
  "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString("base64");

const api = axios.create({
  baseURL: JIRA_BASE,
  headers: {
    Authorization: authHeader,
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  timeout: 60_000,
});

function toUtcRange(dateFrom, dateTo) {
  const from = new Date(`${dateFrom}T00:00:00.000Z`).getTime();
  const to = new Date(`${dateTo}T23:59:59.999Z`).getTime();
  return { from, to };
}

async function getMyAccountId() {
  const res = await api.get("/rest/api/3/myself");
  return res.data.accountId;
}

async function searchIssuesByJql(jql) {
  const issues = [];
  const maxResults = 100;
  let nextPageToken = null;

  while (true) {
    const body = {
      jql,
      maxResults,
      fields: ["summary"],
    };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const res = await api.post("/rest/api/3/search/jql", body);

    const batch = res.data.issues || [];
    for (const issue of batch) {
      issues.push({
        key: issue.key,
        name: issue.fields?.summary || issue.key,
      });
    }

    const isLast = res.data.isLast === true;
    nextPageToken = res.data.nextPageToken || null;

    if (isLast) break;
    if (!nextPageToken) break;
  }

  return issues;
}

async function fetchAllWorklogs(issueKey) {
  const worklogs = [];
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const res = await api.get(`/rest/api/3/issue/${issueKey}/worklog`, {
      params: { startAt, maxResults },
    });

    const batch = res.data.worklogs || [];
    worklogs.push(...batch);

    const total = res.data.total ?? worklogs.length;
    startAt += batch.length;

    if (startAt >= total || batch.length === 0) break;
  }

  return worklogs;
}

async function computeWorklogSummary({ dateFrom, dateTo, projectKey }) {
  const { from, to } = toUtcRange(dateFrom, dateTo);

  const myId = await getMyAccountId();

  const projectPart = projectKey ? `project = ${projectKey} AND ` : "";
  const jql =
    `${projectPart}worklogAuthor = currentUser() ` +
    `AND worklogDate >= "${dateFrom}" AND worklogDate <= "${dateTo}"`;

  const issues = await searchIssuesByJql(jql);

  let totalSeconds = 0;
  const perIssue = new Map();
  const dailySeconds = new Map();

  for (
    let day = new Date(`${dateFrom}T00:00:00.000Z`);
    day <= new Date(`${dateTo}T00:00:00.000Z`);
    day = new Date(day.getTime() + 24 * 60 * 60 * 1000)
  ) {
    dailySeconds.set(day.toISOString().slice(0, 10), 0);
  }

  for (const issue of issues) {
    const wls = await fetchAllWorklogs(issue.key);

    for (const w of wls) {
      if (w?.author?.accountId !== myId) continue;

      const startedMs = new Date(w.started).getTime();
      if (Number.isNaN(startedMs)) continue;

      if (startedMs >= from && startedMs <= to) {
        const secs = Number(w.timeSpentSeconds || 0);
        totalSeconds += secs;
        const date = new Date(startedMs).toISOString().slice(0, 10);
        dailySeconds.set(date, (dailySeconds.get(date) || 0) + secs);

        const current = perIssue.get(issue.key) || {
          key: issue.key,
          name: issue.name,
          seconds: 0,
        };
        current.seconds += secs;
        perIssue.set(issue.key, current);
      }
    }
  }

  const perIssueSorted = [...perIssue.entries()]
    .map(([, item]) => ({
      ...item,
      hours: Number((item.seconds / 3600).toFixed(2)),
    }))
    .sort((a, b) =>
      a.key.localeCompare(b.key, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );

  const perDay = [...dailySeconds.entries()]
    .filter(([, seconds]) => seconds > 0)
    .map(([date, seconds]) => ({
      date,
      seconds,
      hours: Number((seconds / 3600).toFixed(2)),
    }));

  return {
    range: { from: dateFrom, to: dateTo },
    issueCount: issues.length,
    totalSeconds,
    totalHours: Number((totalSeconds / 3600).toFixed(2)),
    perDay,
    perIssue: perIssueSorted,
  };
}

const app = express();
const PORT = Number(process.env.PORT || 3010);

app.use(
  "/vendor/chart.js",
  express.static("node_modules/chart.js/dist")
);
app.use(express.static("public"));

app.get("/api/config", (req, res) => {
  res.json({ jiraBase: String(JIRA_BASE || "").replace(/\/+$/, "") });
});

app.get("/api/worklogs", async (req, res) => {
  const dateFrom = String(req.query.from || "").trim();
  const dateTo = String(req.query.to || "").trim();
  const projectKey = String(req.query.project || "").trim() || null;
  const perIssue = String(req.query.perIssue || "") === "1";

  if (!dateFrom || !dateTo) {
    res.status(400).json({ error: "from and to are required (YYYY-MM-DD)" });
    return;
  }

  try {
    const summary = await computeWorklogSummary({
      dateFrom,
      dateTo,
      projectKey,
    });

    if (!perIssue) summary.perIssue = [];
    res.json(summary);
  } catch (err) {
    const payload = err?.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    res.status(500).json({ error: payload });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
