import { describe, expect, it } from 'vitest';
import { ALL_ACTIONS, authorize, matrix, type Action, type Actor, type Resource, type Role } from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures. The expectation tables below are written INDEPENDENTLY of the
// matrix on purpose — they are the contract; the matrix is the implementation.
// ---------------------------------------------------------------------------

const U = {
  owner: 'u-owner',
  admin: 'u-admin',
  desk: 'u-desk',
  trainer: 'u-trainer',
  otherTrainer: 'u-trainer-2',
  member: 'u-member',
  otherMember: 'u-member-2',
};

const actors: Record<Exclude<Role, 'member'> | 'member' | 'platform', Actor> = {
  owner: { userId: U.owner, isPlatformAdmin: false, staffRoles: ['owner'], memberId: null },
  admin: { userId: U.admin, isPlatformAdmin: false, staffRoles: ['admin'], memberId: null },
  front_desk: { userId: U.desk, isPlatformAdmin: false, staffRoles: ['front_desk'], memberId: null },
  trainer: { userId: U.trainer, isPlatformAdmin: false, staffRoles: ['trainer'], memberId: null },
  member: { userId: U.member, isPlatformAdmin: false, staffRoles: [], memberId: 'm-self' },
  platform: { userId: 'u-platform', isPlatformAdmin: true, staffRoles: [], memberId: null },
};

/** A member resource belonging to the member actor, trainer assigned, no health grant. */
const selfMemberRes: Resource = {
  type: 'member',
  memberId: 'm-self',
  assignedTrainerUserIds: [U.trainer],
  grantedUserIds: [],
};
/** Same member, with a live health grant for the assigned trainer. */
const selfMemberGranted: Resource = { ...selfMemberRes, grantedUserIds: [U.trainer] };
/** Somebody else's member resource — the trainer is NOT assigned. */
const otherMemberRes: Resource = {
  type: 'member',
  memberId: 'm-other',
  assignedTrainerUserIds: [U.otherTrainer],
  grantedUserIds: [U.otherTrainer],
};
/** The trainer's own schedule/program/profile. */
const trainerOwnRes: Resource = { type: 'schedule', trainerUserId: U.trainer, ownerUserId: U.trainer };
const otherTrainerRes: Resource = { type: 'schedule', trainerUserId: U.otherTrainer, ownerUserId: U.otherTrainer };

const finOn: Resource = { type: 'money', adminFinancials: true };
const finOff: Resource = { type: 'money', adminFinancials: false };

// ---------------------------------------------------------------------------
// Contract table: (actor, action, resource) -> expected decision
// ---------------------------------------------------------------------------

const cases: [keyof typeof actors, Action, Resource, boolean][] = [
  // Owner sees and does everything in their gym
  ['owner', 'gym.update', {} as Resource, true],
  ['owner', 'health.read', otherMemberRes, true],
  ['owner', 'rate.manage', finOff, true],
  ['owner', 'audit.read', {} as Resource, true],

  // Admin: broad, but financials behind the toggle; can never self-grant photo/health grants
  ['admin', 'member.archive', otherMemberRes, true],
  ['admin', 'health.read', otherMemberRes, true], // screenings: operational duty of care, audited
  ['admin', 'rate.manage', finOff, false],
  ['admin', 'rate.manage', finOn, true],
  ['admin', 'ledger.read', finOff, false],
  ['admin', 'grant.manage', otherMemberRes, false],

  // Front desk: check-in, booking, contact info. Never health/notes/financials.
  ['front_desk', 'member.read', otherMemberRes, true],
  ['front_desk', 'checkin.create', otherMemberRes, true],
  ['front_desk', 'booking.create', otherMemberRes, true],
  ['front_desk', 'booking.cancel', otherMemberRes, true],
  ['front_desk', 'health.read', otherMemberRes, false],
  ['front_desk', 'health.read', selfMemberGranted, false],
  ['front_desk', 'workout.read', otherMemberRes, false],
  ['front_desk', 'rate.read', finOn, false],
  ['front_desk', 'ledger.read', finOn, false],
  ['front_desk', 'audit.read', {} as Resource, false],
  ['front_desk', 'member.update', otherMemberRes, false],

  // Trainer: own clients only; health requires a live member grant
  ['trainer', 'member.read', selfMemberRes, true],
  ['trainer', 'member.read', otherMemberRes, false],
  ['trainer', 'workout.log', selfMemberRes, true],
  ['trainer', 'workout.log', otherMemberRes, false],
  ['trainer', 'health.read', selfMemberRes, false], // assigned but NO grant
  ['trainer', 'health.read', selfMemberGranted, true], // assigned + grant
  ['trainer', 'health.read', otherMemberRes, false], // grant exists but for another trainer
  ['trainer', 'availability.manage', trainerOwnRes, true],
  ['trainer', 'availability.manage', otherTrainerRes, false],
  ['trainer', 'program.update', trainerOwnRes, true],
  ['trainer', 'program.update', otherTrainerRes, false],
  ['trainer', 'program.assign', selfMemberRes, true],
  ['trainer', 'program.assign', otherMemberRes, false],
  ['trainer', 'rate.read', trainerOwnRes, true], // own rates
  ['trainer', 'rate.read', otherTrainerRes, false],
  ['trainer', 'video.upload', {} as Resource, true],
  ['trainer', 'video.publish', {} as Resource, false], // admin publishes
  ['trainer', 'exercise.manage', {} as Resource, false], // read-only on gym library (v1)
  ['trainer', 'booking.complete', trainerOwnRes, true],

  // Member: own data + published gym content; controls their own grants
  ['member', 'member.read', selfMemberRes, true],
  ['member', 'member.read', otherMemberRes, false],
  ['member', 'workout.log', selfMemberRes, true],
  ['member', 'workout.read', otherMemberRes, false],
  ['member', 'health.read', selfMemberRes, true],
  ['member', 'health.read', otherMemberRes, false],
  ['member', 'grant.manage', selfMemberRes, true],
  ['member', 'grant.manage', otherMemberRes, false],
  ['member', 'booking.create', selfMemberRes, true],
  ['member', 'booking.create', otherMemberRes, false],
  ['member', 'ledger.read', selfMemberRes, true],
  ['member', 'ledger.read', otherMemberRes, false],
  ['member', 'equipment.report_issue', {} as Resource, true],
  ['member', 'exercise.read', {} as Resource, true],
  ['member', 'program.read_assigned', selfMemberRes, true],
  ['member', 'program.read_assigned', otherMemberRes, false],
  ['member', 'bi.view', {} as Resource, false],
  ['member', 'staff.list', {} as Resource, false],

  // Platform admin passes the matrix (support-grant + audit enforced at API layer)
  ['platform', 'health.read', otherMemberRes, true],
];

describe('permission matrix contract', () => {
  it.each(cases.map(([a, act, res, exp]) => [a, act, exp, res] as const))(
    '%s → %s ⇒ %s',
    (actorKey, action, expected, resource) => {
      const decision = authorize(actors[actorKey], action, resource);
      expect(decision.allowed).toBe(expected);
    },
  );
});

describe('structural sweeps', () => {
  it('matrix is complete: every action has a rule for every role', () => {
    const roles: Role[] = ['owner', 'admin', 'front_desk', 'trainer', 'member'];
    for (const action of ALL_ACTIONS) {
      const rules = matrix[action];
      expect(rules, `missing row for ${action}`).toBeDefined();
      for (const role of roles) {
        expect(rules[role], `missing rule ${action} × ${role}`).toBeDefined();
      }
    }
  });

  it('front desk can never reach health, notes, workout, progress, or money actions', () => {
    const forbidden: Action[] = [
      'health.read', 'health.write', 'workout.log', 'workout.read', 'workout.review_form',
      'progress.read', 'max.read', 'max.write', 'rate.read', 'rate.manage', 'package.manage',
      'package.sell', 'ledger.read', 'bi.view', 'audit.read', 'waiver.read_signatures',
      'grant.read', 'grant.manage', 'member.import', 'staff.invite', 'gym.update',
    ];
    // The richest resource imaginable — front desk must still be denied.
    const richest: Resource = {
      type: 'member',
      memberId: 'm-any',
      assignedTrainerUserIds: [U.desk],
      grantedUserIds: [U.desk],
      ownerUserId: U.desk,
      trainerUserId: U.desk,
      adminFinancials: true,
    };
    for (const action of forbidden) {
      expect(
        authorize(actors.front_desk, action, richest).allowed,
        `front_desk must be denied ${action}`,
      ).toBe(false);
    }
  });

  it('members can never touch another member’s data via any action', () => {
    // Actions where the member cell is unconditional 'allow' must be exactly the
    // public-content set; everything else must deny against a foreign member resource.
    const publicSet = new Set<Action>([
      'gym.read', 'equipment.read', 'equipment.report_issue', 'exercise.read',
      'video.read', 'availability.read', 'notification.read',
    ]);
    for (const action of ALL_ACTIONS) {
      const memberRule = matrix[action].member;
      if (memberRule === 'allow') {
        expect(publicSet.has(action), `unexpected public member action: ${action}`).toBe(true);
      } else {
        const decision = authorize(actors.member, action, otherMemberRes);
        expect(decision.allowed, `member must be denied ${action} on another member`).toBe(false);
      }
    }
  });

  it('a user with zero roles at the gym is denied everything non-public', () => {
    const stranger: Actor = { userId: 'u-nobody', isPlatformAdmin: false, staffRoles: [], memberId: null };
    for (const action of ALL_ACTIONS) {
      const decision = authorize(stranger, action, selfMemberGranted);
      expect(decision.allowed, `stranger allowed ${action}`).toBe(false);
    }
  });
});
