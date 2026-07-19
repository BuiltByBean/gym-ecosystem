import type { Action } from './actions.js';
import type { Role, Rule } from './types.js';

type Row = Record<Role, Rule>;
const row = (owner: Rule, admin: Rule, front_desk: Rule, trainer: Rule, member: Rule): Row => ({
  owner,
  admin,
  front_desk,
  trainer,
  member,
});

/**
 * THE permission matrix (spec §3). Every controller goes through this table.
 * Conventions:
 *  - front_desk: check-ins, booking, contact info. NEVER health, notes, financials.
 *  - member grants bind trainers only; admins read screenings (audited), never photos
 *    (docs/OPEN_QUESTIONS.md #7).
 *  - admin financial access sits behind the per-gym toggle (financials_enabled).
 */
export const matrix: Record<Action, Row> = {
  'gym.read':            row('allow', 'allow', 'allow', 'allow', 'allow'),
  'gym.update':          row('allow', 'allow', 'deny', 'deny', 'deny'),
  'staff.list':          row('allow', 'allow', 'allow', 'allow', 'deny'),
  'staff.invite':        row('allow', 'allow', 'deny', 'deny', 'deny'),
  'staff.update':        row('allow', 'allow', 'deny', 'deny', 'deny'),
  'staff.remove':        row('allow', 'allow', 'deny', 'deny', 'deny'),
  'trainer_profile.update': row('allow', 'allow', 'deny', ['trainer_self'], 'deny'),

  'member.list':         row('allow', 'allow', 'allow', 'allow', 'deny'),
  'member.read':         row('allow', 'allow', 'allow', ['assigned_trainer'], ['self_member']),
  'member.create':       row('allow', 'allow', 'allow', 'deny', 'deny'),
  'member.update':       row('allow', 'allow', 'deny', 'deny', ['self_member']),
  'member.archive':      row('allow', 'allow', 'deny', 'deny', 'deny'),
  'member.import':       row('allow', 'allow', 'deny', 'deny', 'deny'),

  'health.read':         row('allow', 'allow', 'deny', ['health_grant'], ['self_member']),
  'health.write':        row('allow', 'allow', 'deny', ['health_grant'], ['self_member']),
  'screening.manage_templates': row('allow', 'allow', 'deny', 'deny', 'deny'),

  'waiver.manage_templates': row('allow', 'allow', 'deny', 'deny', 'deny'),
  'waiver.sign':         row('allow', 'allow', 'allow', 'deny', ['self_member']),
  'waiver.read_signatures': row('allow', 'allow', 'deny', 'deny', ['self_member']),

  'grant.read':          row('allow', 'allow', 'deny', ['trainer_self'], ['self_member']),
  'grant.manage':        row('deny', 'deny', 'deny', 'deny', ['self_member']),

  'equipment.read':      row('allow', 'allow', 'allow', 'allow', 'allow'),
  'equipment.manage':    row('allow', 'allow', 'deny', 'deny', 'deny'),
  'equipment.update_status': row('allow', 'allow', 'allow', 'allow', 'deny'),
  'equipment.report_issue':  row('allow', 'allow', 'allow', 'allow', 'allow'),
  'maintenance.read':    row('allow', 'allow', 'allow', 'allow', 'deny'),
  'maintenance.manage':  row('allow', 'allow', 'deny', 'deny', 'deny'),

  'exercise.read':       row('allow', 'allow', 'allow', 'allow', 'allow'),
  'exercise.manage':     row('allow', 'allow', 'deny', 'deny', 'deny'),
  'video.upload':        row('allow', 'allow', 'deny', 'allow', 'deny'),
  'video.publish':       row('allow', 'allow', 'deny', 'deny', 'deny'),
  'video.read':          row('allow', 'allow', 'allow', 'allow', 'allow'),

  'program.read':        row('allow', 'allow', 'deny', 'allow', 'deny'),
  'program.create':      row('allow', 'allow', 'deny', 'allow', 'deny'),
  'program.update':      row('allow', 'allow', 'deny', ['trainer_self'], 'deny'),
  'program.publish':     row('allow', 'allow', 'deny', ['trainer_self'], 'deny'),
  'program.assign':      row('allow', 'allow', 'deny', ['assigned_trainer'], 'deny'),
  'program.read_assigned': row('allow', 'allow', 'deny', ['assigned_trainer'], ['self_member']),

  'workout.log':         row('allow', 'allow', 'deny', ['assigned_trainer'], ['self_member']),
  'workout.read':        row('allow', 'allow', 'deny', ['assigned_trainer'], ['self_member']),
  'workout.review_form': row('allow', 'allow', 'deny', ['assigned_trainer'], 'deny'),
  'progress.read':       row('allow', 'allow', 'deny', ['assigned_trainer'], ['self_member']),
  'max.read':            row('allow', 'allow', 'deny', ['assigned_trainer'], ['self_member']),
  'max.write':           row('allow', 'allow', 'deny', ['assigned_trainer'], ['self_member']),

  'booking.read':        row('allow', 'allow', 'allow', ['trainer_self'], ['self_member']),
  'booking.create':      row('allow', 'allow', 'allow', ['trainer_self'], ['self_member']),
  'booking.cancel':      row('allow', 'allow', 'allow', ['trainer_self'], ['self_member']),
  'booking.complete':    row('allow', 'allow', 'deny', ['trainer_self'], 'deny'),
  'booking.checkin':     row('allow', 'allow', 'allow', ['trainer_self'], 'deny'),
  'availability.read':   row('allow', 'allow', 'allow', 'allow', 'allow'),
  'availability.manage': row('allow', 'allow', 'deny', ['trainer_self'], 'deny'),
  'session_type.manage': row('allow', 'allow', 'deny', 'deny', 'deny'),
  'incident.manage':     row('allow', 'allow', 'deny', 'deny', 'deny'),
  'checkin.create':      row('allow', 'allow', 'allow', 'deny', ['self_member']),

  'rate.read':           row('allow', ['financials_enabled'], 'deny', ['trainer_self'], 'deny'),
  'rate.manage':         row('allow', ['financials_enabled'], 'deny', 'deny', 'deny'),
  'package.read':        row('allow', 'allow', 'allow', 'deny', ['self_member']),
  'package.manage':      row('allow', ['financials_enabled'], 'deny', 'deny', 'deny'),
  'package.sell':        row('allow', 'allow', 'deny', 'deny', 'deny'),
  'ledger.read':         row('allow', ['financials_enabled'], 'deny', 'deny', ['self_member']),

  'bi.view':             row('allow', 'allow', 'deny', 'deny', 'deny'),
  'audit.read':          row('allow', 'allow', 'deny', 'deny', 'deny'),
  'notification.read':   row('allow', 'allow', 'allow', 'allow', 'allow'),
};
