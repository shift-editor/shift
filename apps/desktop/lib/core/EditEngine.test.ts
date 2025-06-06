import { beforeEach, describe, it } from 'vitest';

import { EditEngine } from './EditEngine';

describe('EditEngine', () => {
  let editEngine: EditEngine;

  beforeEach(() => {
    editEngine = new EditEngine({
      getSelectedPoints: () => [],
      movePointTo: () => {},
    });
  });

  it('should preview edits', () => {});
});
