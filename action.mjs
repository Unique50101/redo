import { readFile } from 'node:fs/promises';
import { rules, decision, command } from './core.mjs';

const env = process.env;
const marker = '<!-- unique50101-redo:v1 -->';
const escape = value => String(value).replace(/[&<>|`*_\[\]@\\\r\n]/g, c => '&#' + c.charCodeAt(0) + ';');

async function run() {
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const number = event.pull_request?.number ?? (event.issue?.pull_request && event.issue.number);
  if (!number) return;
  const checks = rules(env.INPUT_CHECKS);
  async function api(path, method = 'GET', body) {
    const response = await fetch(env.GITHUB_API_URL + '/repos/' + env.GITHUB_REPOSITORY + path, {
      method, headers: { Authorization: 'Bearer ' + env.INPUT_TOKEN, 'Content-Type': 'application/json', Accept: 'application/vnd.github+json' },
      body: body && JSON.stringify(body)
    });
    if (!response.ok) throw Object.assign(Error(method + ' ' + path + ' returned ' + response.status), { status: response.status });
    return response.json();
  }
  const pr = await api('/pulls/' + number);
  if (pr.state !== 'open') return;
  const head = pr.head.sha;
  const endpoint = '/issues/' + number + '/comments';
  const comments = [];
  for (let page = 1; ; page++) {
    const batch = await api(endpoint + '?per_page=100&page=' + page);
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  const previous = comments.find(c => c.user.login === 'github-actions[bot]' && c.body.startsWith(marker));
  const passes = new Map();
  const permissions = new Map();
  for (const c of comments) {
    const parsed = command(c.body);
    if (!parsed) continue;
    const [, id, sha, key] = parsed;
    if (!checks.some(r => r.id === id && r.key === key)) continue;
    const login = c.user.login;
    if (!permissions.has(login)) {
      const result = await api('/collaborators/' + encodeURIComponent(login) + '/permission');
      permissions.set(login, ['admin','write','maintain'].includes(result.permission));
    }
    if (permissions.get(login)) passes.set(id, { sha, url: c.html_url });
  }
  const lines = [marker, '## Redo · manual QA', '', 'Current commit: `' + head.slice(0, 8) + '`', '', '| Check | Status | Reason | Last sign-off |', '|---|---|---|---|'];
  const comparisons = new Map();
  const commands = [];
  for (const rule of checks) {
    const pass = passes.get(rule.id);
    if (pass && pass.sha !== head && !comparisons.has(pass.sha)) {
      try { comparisons.set(pass.sha, await api('/compare/' + pass.sha + '...' + head)); }
      catch (error) {
        if (![404, 409, 422].includes(error.status)) throw error;
        comparisons.set(pass.sha, null);
      }
    }
    const [status, reason] = decision(rule, pass?.sha, head, comparisons.get(pass?.sha));
    const link = pass ? '[' + pass.sha.slice(0, 8) + '](' + pass.url + ')' : '—';
    lines.push('| ' + escape(rule.label) + ' | **' + status + '** | ' + escape(reason) + ' | ' + link + ' |');
    if (status !== 'Passed') commands.push('/redo pass ' + rule.id + ' ' + head + ' ' + rule.key);
  }
  if (commands.length) lines.push('', 'After testing this commit, post the corresponding command as a separate PR comment. Each sign-off requires write access.', '', '```text', ...commands, '```');
  const body = lines.join('\n');
  if (previous?.body === body) return;
  if (previous) await api('/issues/comments/' + previous.id, 'PATCH', { body });
  else await api(endpoint, 'POST', { body });
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
