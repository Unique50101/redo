import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export function rules(input) {
  const list = JSON.parse(input);
  if (!Array.isArray(list) || !list.length || list.length > 30) throw Error('Provide 1–30 checks.');
  const ids = new Set();
  return list.map(({ id, label, paths }) => {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(id) || ids.has(id) || typeof label !== 'string' ||
        !label.trim() || label.length > 160 || !Array.isArray(paths) || !paths.length ||
        paths.some(p => typeof p !== 'string' || !p || p.startsWith('/'))) throw Error('Invalid or duplicate check: ' + id);
    ids.add(id);
    const key = createHash('sha256').update(JSON.stringify([label, [...paths].sort()])).digest('hex').slice(0, 12);
    return { id, label, paths, key };
  });
}

export function decision(rule, signoff, head, comparison) {
  if (!signoff) return ['Open', 'Awaiting manual check'];
  if (signoff === head) return ['Passed', 'Checked on this commit'];
  if (!comparison || comparison.status !== 'ahead' || !Array.isArray(comparison.files))
    return ['Redo', 'Commit history could not be verified'];
  const paths = comparison.files.flatMap(f => [f.filename, f.previous_filename].filter(Boolean));
  const match = paths.find(file => rule.paths.some(pattern => posix.matchesGlob(file, pattern)));
  if (match) return ['Redo', match];
  if (comparison.files.length >= 300) return ['Redo', 'GitHub comparison file limit reached'];
  return ['Passed', 'Mapped paths unchanged'];
}

export function command(body) {
  return /^\/redo pass ([a-z][a-z0-9-]{0,39}) ([0-9a-f]{40}) ([0-9a-f]{12})$/.exec(body.trim());
}
