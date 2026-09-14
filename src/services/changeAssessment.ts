import type { ChangeRow } from '@/types/health';

export type ChangeAssessmentKind = 'user' | 'native' | 'automation' | 'unknown';

export interface ChangeAssessment {
  kind: ChangeAssessmentKind;
  label: string;
  reason: string;
}

const nativeOperationPattern = /EXTENTCONTAINER|SYSTEM-PROPERTIES/i;
const applicationPrincipalPattern = /^AAD app id=/i;
const userPrincipalPattern = /@|\bAAD user\b|\buser(?: id)?=/i;

export function assessChange(change: ChangeRow): ChangeAssessment {
  const principal = change.principal.trim();
  const operation = `${change.event} ${change.changeCommand}`;

  if (/^KustoServiceBuiltInPrincipal$/i.test(principal)) {
    return { kind: 'native', label: 'Native maintenance', reason: 'Eventhouse built-in principal' };
  }
  if (applicationPrincipalPattern.test(principal) && nativeOperationPattern.test(operation)) {
    return { kind: 'native', label: 'Native maintenance', reason: 'Application-managed Eventhouse operation' };
  }
  if (applicationPrincipalPattern.test(principal)) {
    return { kind: 'automation', label: 'Automation', reason: 'AAD application identity; verify ownership if unexpected' };
  }
  if (userPrincipalPattern.test(principal)) {
    return { kind: 'user', label: 'Likely user', reason: 'Named user identity; review intent and timing' };
  }
  return { kind: 'unknown', label: 'Unknown actor', reason: 'Principal type is not recognized' };
}