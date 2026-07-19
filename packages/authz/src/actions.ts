/** Closed catalog of every authorizable action. Adding an endpoint means adding
 *  an action here, which forces a matrix entry (type error otherwise), which is
 *  a reviewed diff. */
export const ALL_ACTIONS = [
  // gym + staff
  'gym.read',
  'gym.update',
  'staff.list',
  'staff.invite',
  'staff.update',
  'staff.remove',
  'trainer_profile.update',
  // members
  'member.list',
  'member.read',
  'member.create',
  'member.update',
  'member.archive',
  'member.import',
  // health (sensitive: every read audited)
  'health.read',
  'health.write',
  'screening.manage_templates',
  // waivers
  'waiver.manage_templates',
  'waiver.sign',
  'waiver.read_signatures',
  // member-controlled trainer grants
  'grant.read',
  'grant.manage',
  // equipment
  'equipment.read',
  'equipment.manage',
  'equipment.update_status',
  'equipment.report_issue',
  'maintenance.read',
  'maintenance.manage',
  // exercise library + media
  'exercise.read',
  'exercise.manage',
  'video.upload',
  'video.publish',
  'video.read',
  // programs
  'program.read',
  'program.create',
  'program.update',
  'program.publish',
  'program.assign',
  'program.read_assigned',
  // workout logging + progress
  'workout.log',
  'workout.read',
  'workout.review_form',
  'progress.read',
  'max.read',
  'max.write',
  // scheduling
  'booking.read',
  'booking.create',
  'booking.cancel',
  'booking.complete',
  'booking.checkin',
  'availability.read',
  'availability.manage',
  'session_type.manage',
  'incident.manage',
  'checkin.create',
  // money
  'rate.read',
  'rate.manage',
  'package.read',
  'package.manage',
  'package.sell',
  'ledger.read',
  // oversight
  'bi.view',
  'audit.read',
  'notification.read',
] as const;

export type Action = (typeof ALL_ACTIONS)[number];

/** Sensitive-scope actions: authorize middleware writes an audit event on every use. */
export const AUDITED_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'health.read',
  'health.write',
  'waiver.read_signatures',
]);

/** Actions that touch money — never available to front desk, admin only behind the per-gym toggle where marked in the matrix. */
export const FINANCIAL_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'rate.read',
  'rate.manage',
  'package.manage',
  'ledger.read',
]);
