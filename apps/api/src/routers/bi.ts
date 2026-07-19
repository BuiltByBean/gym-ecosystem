import { sql } from 'drizzle-orm';
import { router, tenantProcedure } from '../trpc.js';

export const biRouter = router({
  /** Owner/Admin dashboard (spec §4.13). Live queries — fine at v1 scale;
   *  rollup jobs take over when volume demands (docs/ARCHITECTURE.md §9). */
  dashboard: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('bi.view');
    const isOwner = ctx.actor.staffRoles.includes('owner');
    const showRevenue = isOwner || ctx.gym.settings.adminFinancials === true;

    return ctx.tenant(async (tx) => {
      const gymId = ctx.gym.id;
      const core = await tx.execute(sql`
        SELECT
          (SELECT count(*) FROM members WHERE gym_id = ${gymId} AND status = 'active' AND archived_at IS NULL)::int AS active_members,
          (SELECT count(*) FROM members WHERE gym_id = ${gymId} AND status = 'prospect' AND archived_at IS NULL)::int AS prospects,
          (SELECT count(DISTINCT m.id) FROM members m
             WHERE m.gym_id = ${gymId} AND m.status = 'active' AND m.archived_at IS NULL
               AND (EXISTS (SELECT 1 FROM checkins c WHERE c.member_id = m.id AND c.created_at > now() - interval '30 days')
                 OR EXISTS (SELECT 1 FROM workout_sessions ws WHERE ws.member_id = m.id AND ws.status = 'completed' AND ws.started_at > now() - interval '30 days')))::int AS engaged_30d,
          (SELECT count(DISTINCT ta.member_id) FROM trainer_assignments ta
             JOIN members m2 ON m2.id = ta.member_id AND m2.status = 'active' AND m2.archived_at IS NULL
             WHERE ta.gym_id = ${gymId} AND ta.ended_at IS NULL)::int AS members_with_trainer,
          (SELECT count(*) FROM bookings b WHERE b.gym_id = ${gymId}
             AND b.starts_at >= date_trunc('week', now()) AND b.status IN ('booked','completed'))::int AS sessions_this_week,
          (SELECT count(*) FROM workout_sessions ws WHERE ws.gym_id = ${gymId}
             AND ws.status = 'completed' AND ws.started_at >= date_trunc('week', now()))::int AS workouts_this_week,
          (SELECT count(*) FROM maintenance_reports mr WHERE mr.gym_id = ${gymId} AND mr.status = 'open')::int AS open_maintenance,
          (SELECT count(*) FROM equipment_units eu WHERE eu.gym_id = ${gymId} AND eu.status IN ('maintenance','out_of_service'))::int AS units_down,
          (SELECT count(*) FROM program_assignments pa WHERE pa.gym_id = ${gymId} AND pa.status = 'active')::int AS active_assignments
      `);
      const c = core.rows[0] as Record<string, number>;

      let revenue30d: number | null = null;
      if (showRevenue) {
        const rev = await tx.execute(sql`
          SELECT coalesce(sum(amount_cents), 0)::int AS cents FROM payments
          WHERE gym_id = ${gymId} AND status = 'paid' AND created_at > now() - interval '30 days'
        `);
        revenue30d = (rev.rows[0] as { cents: number }).cents;
      }

      // Equipment usage: logged sets attributed via exercise↔model links + QR scans.
      const usage = await tx.execute(sql`
        SELECT em.id, em.name,
          coalesce(su.set_count, 0)::int AS set_count,
          coalesce(sc.scan_count, 0)::int AS scan_count
        FROM equipment_models em
        LEFT JOIN (
          SELECT l.model_id, count(*) AS set_count
          FROM set_log sl
          JOIN equipment_exercise_links l ON l.exercise_id = sl.exercise_id
          WHERE sl.gym_id = ${gymId} AND sl.kind = 'set_logged'
            AND sl.server_received_at > now() - interval '30 days'
          GROUP BY l.model_id
        ) su ON su.model_id = em.id
        LEFT JOIN (
          SELECT eu.model_id, count(*) AS scan_count
          FROM equipment_scans es
          JOIN equipment_units eu ON eu.id = es.unit_id
          WHERE es.gym_id = ${gymId} AND es.created_at > now() - interval '30 days'
          GROUP BY eu.model_id
        ) sc ON sc.model_id = em.id
        WHERE em.gym_id = ${gymId} AND em.archived_at IS NULL
        ORDER BY coalesce(su.set_count, 0) + coalesce(sc.scan_count, 0) DESC
        LIMIT 12
      `);

      // Trainer utilization this week: booked hours vs available template hours.
      const utilization = await tx.execute(sql`
        SELECT u.display_name AS trainer,
          coalesce(b.booked_min, 0)::int AS booked_min,
          coalesce(a.avail_min, 0)::int AS avail_min
        FROM gym_staff gs
        JOIN users u ON u.id = gs.user_id
        LEFT JOIN (
          SELECT trainer_user_id, sum(extract(epoch FROM (ends_at - starts_at)) / 60) AS booked_min
          FROM bookings
          WHERE gym_id = ${gymId} AND status IN ('booked','completed')
            AND starts_at >= date_trunc('week', now()) AND starts_at < date_trunc('week', now()) + interval '7 days'
          GROUP BY trainer_user_id
        ) b ON b.trainer_user_id = gs.user_id
        LEFT JOIN (
          SELECT trainer_user_id, sum(end_min - start_min) AS avail_min
          FROM availability_templates WHERE gym_id = ${gymId}
          GROUP BY trainer_user_id
        ) a ON a.trainer_user_id = gs.user_id
        WHERE gs.gym_id = ${gymId} AND gs.role = 'trainer' AND gs.status = 'active'
        ORDER BY u.display_name
      `);

      // Content performance: which programs are actually used.
      const content = await tx.execute(sql`
        SELECT p.name,
          (SELECT count(*) FROM program_assignments pa WHERE pa.program_id = p.id AND pa.status = 'active')::int AS active_assignments,
          (SELECT count(*) FROM workout_sessions ws
             JOIN program_versions pv ON pv.id = ws.program_version_id
             WHERE pv.program_id = p.id AND ws.status = 'completed'
               AND ws.started_at > now() - interval '30 days')::int AS workouts_30d
        FROM programs p
        WHERE p.gym_id = ${gymId} AND p.status = 'published' AND p.archived_at IS NULL
        ORDER BY 3 DESC, 2 DESC
        LIMIT 8
      `);

      const activeMembers = c.active_members ?? 0;
      return {
        activeMembers,
        prospects: c.prospects ?? 0,
        engaged30d: c.engaged_30d ?? 0,
        membersWithTrainer: c.members_with_trainer ?? 0,
        penetrationPct: activeMembers > 0 ? Math.round(((c.members_with_trainer ?? 0) / activeMembers) * 100) : 0,
        sessionsThisWeek: c.sessions_this_week ?? 0,
        workoutsThisWeek: c.workouts_this_week ?? 0,
        openMaintenance: c.open_maintenance ?? 0,
        unitsDown: c.units_down ?? 0,
        activeAssignments: c.active_assignments ?? 0,
        revenue30dCents: revenue30d,
        equipmentUsage: usage.rows as Array<{ id: string; name: string; set_count: number; scan_count: number }>,
        trainerUtilization: utilization.rows as Array<{ trainer: string; booked_min: number; avail_min: number }>,
        contentPerformance: content.rows as Array<{ name: string; active_assignments: number; workouts_30d: number }>,
      };
    });
  }),
});
