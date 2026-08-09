import { describe, expect, it } from 'vitest';

import { parseArgs } from '../../scripts/ingest';

describe('ingest CLI parseArgs', () => {
  it('defaults to no action (help is shown by the runner)', () => {
    expect(parseArgs([])).toEqual({
      register: false,
      list: false,
      all: false,
      slug: null,
      help: false,
    });
  });

  it('parses flags and the --source value', () => {
    expect(parseArgs(['--register', '--source', 'github-blog'])).toMatchObject({
      register: true,
      slug: 'github-blog',
    });
    expect(parseArgs(['--all'])).toMatchObject({ all: true });
    expect(parseArgs(['--list'])).toMatchObject({ list: true });
    expect(parseArgs(['-h'])).toMatchObject({ help: true });
  });

  it('ignores unknown flags rather than failing', () => {
    expect(parseArgs(['--nope'])).toMatchObject({ help: false, all: false });
  });
});
