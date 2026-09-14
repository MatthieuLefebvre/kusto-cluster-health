import { describe, expect, it } from 'vitest';

import { assessChange } from '@/services/changeAssessment';
import type { ChangeRow } from '@/types/health';

function change(principal: string, event = 'ALTER-TABLE-RETENTION-POLICY'): ChangeRow {
  return { timestamp: '', event, entityName: '', database: '', principal, changeCommand: '', activityId: '' };
}

describe('assessChange', () => {
  it('flags a named principal as a likely user', () => {
    expect(assessChange(change('operator@contoso.com')).kind).toBe('user');
  });

  it('recognizes the Eventhouse built-in principal', () => {
    expect(assessChange(change('KustoServiceBuiltInPrincipal', 'ALTER-COLUMN-ENCODING-POLICY')).kind).toBe('native');
  });

  it('recognizes application-managed native operations', () => {
    expect(assessChange(change('AAD app id=00000000-0000-0000-0000-000000000000', 'SET-EXTENTCONTAINERSTATE')).kind).toBe('native');
  });

  it('keeps other application activity visible as automation', () => {
    expect(assessChange(change('AAD app id=00000000-0000-0000-0000-000000000000')).kind).toBe('automation');
  });

  it('marks an unrecognized principal for review', () => {
    expect(assessChange(change('unclassified-principal')).kind).toBe('unknown');
  });
});