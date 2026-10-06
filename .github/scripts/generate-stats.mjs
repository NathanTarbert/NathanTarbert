// Renders assets/stats.svg (total contributions + streaks) from the GitHub
// GraphQL API. No dependencies: runs on the Node that ships with the runner.
import { writeFileSync } from "node:fs";

const token = process.env.GITHUB_TOKEN;
const login = process.env.GITHUB_LOGIN || "NathanTarbert";
const out = process.env.STATS_OUT || "assets/stats.svg";
if (!token) throw new Error("GITHUB_TOKEN is required");

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GraphQL failed: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  return json.data;
}

const { user } = await gql(
  `query($login: String!) { user(login: $login) { createdAt } }`,
  { login },
);
const firstYear = new Date(user.createdAt).getUTCFullYear();
const thisYear = new Date().getUTCFullYear();

const days = new Map(); // YYYY-MM-DD -> count
const totals = { commits: 0, prs: 0, issues: 0, reviews: 0, repos: 0, private: 0 };
for (let year = firstYear; year <= thisYear; year++) {
  const data = await gql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
       user(login: $login) { contributionsCollection(from: $from, to: $to) {
         totalCommitContributions totalPullRequestContributions totalIssueContributions
         totalPullRequestReviewContributions totalRepositoryContributions restrictedContributionsCount
         contributionCalendar { weeks { contributionDays { date contributionCount } } }
       } }
     }`,
    { login, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
  );
  const cc = data.user.contributionsCollection;
  totals.commits += cc.totalCommitContributions;
  totals.prs += cc.totalPullRequestContributions;
  totals.issues += cc.totalIssueContributions;
  totals.reviews += cc.totalPullRequestReviewContributions;
  totals.repos += cc.totalRepositoryContributions;
  totals.private += cc.restrictedContributionsCount;
  for (const w of cc.contributionCalendar.weeks)
    for (const d of w.contributionDays) days.set(d.date, d.contributionCount);
}

const dates = [...days.keys()].sort();
const today = new Date().toISOString().slice(0, 10);
const total = [...days.values()].reduce((a, b) => a + b, 0);
const firstActive = dates.find((d) => days.get(d) > 0) ?? today;

let longest = { len: 0, start: null, end: null };
let run = { len: 0, start: null, end: null };
for (const d of dates) {
  if (d > today) break;
  if (days.get(d) > 0) {
    run = run.len ? { ...run, len: run.len + 1, end: d } : { len: 1, start: d, end: d };
    if (run.len > longest.len) longest = { ...run };
  } else {
    run = { len: 0, start: null, end: null };
  }
}
// Current streak: today may still be empty, so it only counts if yesterday ended the run.
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const current = run.len && (run.end === today || run.end === yesterday) ? run : { len: 0, start: null, end: null };

const fmtDay = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const range = (r) => (r.len ? `${fmtDay(r.start)} – ${fmtDay(r.end)}` : "No active streak");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const cols = [
  { x: 165, value: total.toLocaleString("en-US"), label: "Total Contributions", sub: `${fmtDay(firstActive)} – Present`, accent: false },
  { x: 495, value: `${current.len}`, label: "Current Streak", sub: range(current), accent: true },
  { x: 825, value: `${longest.len}`, label: "Longest Streak", sub: range(longest), accent: false },
];
const fmt = (n) => n.toLocaleString("en-US");
const breakdown = [
  ["Commits", totals.commits],
  ["Pull Requests", totals.prs],
  ["Issues", totals.issues],
  ["Code Reviews", totals.reviews],
  ["Repos Created", totals.repos],
  ["Private", totals.private],
];
const row2 = breakdown
  .map(
    ([label, n], i) => `  <text x="${82.5 + i * 165}" y="232" text-anchor="middle" font-size="26" font-weight="700" fill="#F0F6FC">${fmt(n)}</text>
  <text x="${82.5 + i * 165}" y="254" text-anchor="middle" font-size="12" fill="#8B949E">${esc(label)}</text>`,
  )
  .join("\n");
const font = "ui-sans-serif,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";
const body = cols
  .map(
    (c) => `  <text x="${c.x}" y="78" text-anchor="middle" font-size="40" font-weight="700" fill="${c.accent ? "#E8643C" : "#F0F6FC"}">${esc(c.value)}</text>
  <text x="${c.x}" y="112" text-anchor="middle" font-size="16" font-weight="600" fill="${c.accent ? "#E8643C" : "#F0F6FC"}">${esc(c.label)}</text>
  <text x="${c.x}" y="136" text-anchor="middle" font-size="12" fill="#8B949E">${esc(c.sub)}</text>`,
  )
  .join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 990 280" width="990" height="280" role="img" aria-label="GitHub stats for ${esc(login)}: ${esc(total)} total contributions, ${current.len} day current streak, ${longest.len} day longest streak. Totals: ${totals.commits} commits, ${totals.prs} pull requests, ${totals.issues} issues, ${totals.reviews} code reviews, ${totals.repos} repositories created, ${totals.private} private contributions">
  <rect width="990" height="280" rx="12" fill="#0D1117"/>
  <g font-family="${font}">
${body}
${row2}
  </g>
  <line x1="330" y1="40" x2="330" y2="150" stroke="#30363D"/>
  <line x1="660" y1="40" x2="660" y2="150" stroke="#30363D"/>
  <line x1="40" y1="176" x2="950" y2="176" stroke="#30363D"/>
</svg>
`;
writeFileSync(out, svg);
console.log(`${login}: total=${total} current=${current.len} longest=${longest.len} -> ${out}`);
