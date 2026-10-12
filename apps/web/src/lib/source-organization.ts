import type { Stage } from './server/contracts';

export function sourceProjectName(metadata: Pick<Stage['metadata'], 'groupHint'>) {
  const name = metadata.groupHint?.trim() ?? '';
  return name && name !== 'Uploaded together' ? name : '';
}

const projectKey = (name: string) => name.normalize('NFKC').toLocaleLowerCase();

export function sourceProjectNames(names: string[]) {
  const unique = new Map<string, string>();
  for (const value of names) {
    const name = value.trim();
    if (name && !unique.has(projectKey(name))) unique.set(projectKey(name), name);
  }
  return [...unique.values()].sort((a, b) => a.localeCompare(b));
}

export function groupStagingSources<T extends { metadata: Stage['metadata'] }>(sources: T[]) {
  const groups = new Map<string, { id: string; name: string; files: T[] }>();
  for (const source of sources) {
    const name = sourceProjectName(source.metadata);
    const key = name ? `project:${projectKey(name)}` : 'none';
    if (!groups.has(key)) groups.set(key, { id: key, name: name || 'No project', files: [] });
    groups.get(key)!.files.push(source);
  }
  return [...groups.values()].sort((a, b) => Number(a.id === 'none') - Number(b.id === 'none'));
}

export function localMeetingTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
