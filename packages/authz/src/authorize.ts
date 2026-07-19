import type { Action } from './actions.js';
import { matrix } from './matrix.js';
import type { Actor, Condition, Decision, Resource, Role } from './types.js';

function checkCondition(cond: Condition, actor: Actor, resource: Resource): boolean {
  switch (cond) {
    case 'self_member':
      return resource.memberId != null && resource.memberId === actor.memberId;
    case 'assigned_trainer':
      return (
        resource.assignedTrainerUserIds != null &&
        resource.assignedTrainerUserIds.includes(actor.userId)
      );
    case 'health_grant':
      return resource.grantedUserIds != null && resource.grantedUserIds.includes(actor.userId);
    case 'trainer_self':
      return (
        (resource.ownerUserId != null && resource.ownerUserId === actor.userId) ||
        (resource.trainerUserId != null && resource.trainerUserId === actor.userId)
      );
    case 'financials_enabled':
      return resource.adminFinancials === true;
  }
}

function effectiveRoles(actor: Actor): Role[] {
  const roles: Role[] = [...actor.staffRoles];
  if (actor.memberId) roles.push('member');
  return roles;
}

/**
 * The single authorization gate. Pure: all facts arrive in `actor`/`resource`.
 * Platform admins pass unconditionally — the API layer separately enforces an
 * active support-access grant with a stated reason and audits every access.
 */
export function authorize(actor: Actor, action: Action, resource: Resource): Decision {
  if (actor.isPlatformAdmin) return { allowed: true, via: 'platform_admin' };
  const rules = matrix[action];
  for (const role of effectiveRoles(actor)) {
    const rule = rules[role];
    if (rule === 'allow') return { allowed: true, via: role };
    if (rule === 'deny' || rule == null) continue;
    for (const cond of rule) {
      if (checkCondition(cond, actor, resource)) {
        return { allowed: true, via: `${role}:${cond}` };
      }
    }
  }
  return { allowed: false };
}
