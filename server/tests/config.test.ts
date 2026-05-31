import { describe, expect, it } from 'vitest';
import { getSource, parseSources, publicSources } from '../src/config.js';

const sourcesJson = JSON.stringify([
  {
    id: 'default',
    label: 'Default',
    connectionString: 'postgresql://user:secret@example.com/db',
  },
]);

describe('server config', () => {
  it('parses source config and hides connection strings in public output', () => {
    const sources = parseSources(sourcesJson);

    expect(sources).toHaveLength(1);
    expect(publicSources(sources)).toEqual([{ id: 'default', label: 'Default' }]);
    expect(JSON.stringify(publicSources(sources))).not.toContain('secret');
  });

  it('rejects unknown sources', () => {
    expect(() => getSource(parseSources(sourcesJson), 'missing')).toThrow('Unknown PostgreSQL source');
  });
});
