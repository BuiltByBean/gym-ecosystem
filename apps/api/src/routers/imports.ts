import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import Papa from 'papaparse';
import { z } from 'zod';
import { schema, uuidv7 } from '@gym/db';
import { router, tenantProcedure } from '../trpc.js';

/** Target fields the mapper UI can bind CSV columns to. */
export const IMPORT_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'status', 'membershipType',
  'dateOfBirth', 'joinedAt', 'emergencyName', 'emergencyPhone', 'goalsNote',
] as const;

const STATUS_ALIASES: Record<string, schema.MemberStatus> = {
  active: 'active', current: 'active', member: 'active',
  prospect: 'prospect', lead: 'prospect', trial: 'prospect',
  frozen: 'frozen', hold: 'frozen', suspended: 'frozen',
  inactive: 'inactive', lapsed: 'inactive', expired: 'inactive',
  cancelled: 'cancelled', canceled: 'cancelled', terminated: 'cancelled',
};

function normalizeDate(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(t);
  if (us) return `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`;
  return null;
}

interface MappedRow {
  mapped: Record<string, unknown>;
  error: string | null;
}

function mapRow(raw: Record<string, string>, mapping: Record<string, string>): MappedRow {
  const mapped: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(mapping)) {
    if (!column) continue;
    const value = (raw[column] ?? '').trim();
    if (!value) continue;
    switch (field) {
      case 'status': {
        const norm = STATUS_ALIASES[value.toLowerCase()];
        if (!norm) return { mapped, error: `unrecognized status "${value}"` };
        mapped.status = norm;
        break;
      }
      case 'email': {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return { mapped, error: `invalid email "${value}"` };
        mapped.email = value.toLowerCase();
        break;
      }
      case 'dateOfBirth':
      case 'joinedAt': {
        const d = normalizeDate(value);
        if (!d) return { mapped, error: `unparseable date "${value}" for ${field}` };
        mapped[field] = d;
        break;
      }
      default:
        mapped[field] = value;
    }
  }
  if (!mapped.firstName || !mapped.lastName) {
    return { mapped, error: 'firstName and lastName are required' };
  }
  return { mapped, error: null };
}

export const importsRouter = router({
  /** Step 1: parse headers + preview so the admin can build a mapping. */
  parse: tenantProcedure
    .input(z.object({ csvText: z.string().min(1).max(10_000_000) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('member.import');
      const parsed = Papa.parse<Record<string, string>>(input.csvText, {
        header: true,
        skipEmptyLines: true,
      });
      const headers = parsed.meta.fields ?? [];
      // best-effort auto-mapping by header name
      const auto: Record<string, string> = {};
      const canon = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
      for (const h of headers) {
        const c = canon(h);
        if (['firstname', 'first', 'givenname'].includes(c)) auto.firstName = h;
        else if (['lastname', 'last', 'surname', 'familyname'].includes(c)) auto.lastName = h;
        else if (['email', 'emailaddress'].includes(c)) auto.email = h;
        else if (['phone', 'phonenumber', 'mobile', 'cell'].includes(c)) auto.phone = h;
        else if (['status', 'membershipstatus'].includes(c)) auto.status = h;
        else if (['membershiptype', 'plan', 'membership'].includes(c)) auto.membershipType = h;
        else if (['dob', 'dateofbirth', 'birthdate', 'birthday'].includes(c)) auto.dateOfBirth = h;
        else if (['joindate', 'joined', 'startdate', 'membersince'].includes(c)) auto.joinedAt = h;
      }
      return {
        headers,
        fields: IMPORT_FIELDS,
        autoMapping: auto,
        preview: parsed.data.slice(0, 5),
        rowCount: parsed.data.length,
      };
    }),

  /** Step 2: dry run — persist the job + per-row results, apply nothing. */
  dryRun: tenantProcedure
    .input(
      z.object({
        filename: z.string().min(1).max(200),
        csvText: z.string().min(1).max(10_000_000),
        mapping: z.record(z.string(), z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('member.import');
      const parsed = Papa.parse<Record<string, string>>(input.csvText, { header: true, skipEmptyLines: true });
      const jobId = uuidv7();
      let ok = 0;
      let errors = 0;
      await ctx.tenant(async (tx) => {
        await tx.insert(schema.importJobs).values({
          id: jobId,
          gymId: ctx.gym.id,
          filename: input.filename,
          mapping: input.mapping,
          status: 'dry_run',
          createdBy: ctx.user.id,
        });
        const rows = parsed.data.map((raw, i) => {
          const { mapped, error } = mapRow(raw, input.mapping);
          if (error) errors++;
          else ok++;
          return {
            id: uuidv7(),
            gymId: ctx.gym.id,
            importJobId: jobId,
            rowNo: i + 1,
            raw,
            mapped,
            status: (error ? 'error' : 'ok') as 'error' | 'ok',
            error,
          };
        });
        for (let i = 0; i < rows.length; i += 500) {
          await tx.insert(schema.importRows).values(rows.slice(i, i + 500));
        }
        await tx
          .update(schema.importJobs)
          .set({ totals: { rows: rows.length, ok, errors } })
          .where(eq(schema.importJobs.id, jobId));
      });
      const errorRows = await ctx.tenant((tx) =>
        tx
          .select({ rowNo: schema.importRows.rowNo, error: schema.importRows.error, raw: schema.importRows.raw })
          .from(schema.importRows)
          .where(and(eq(schema.importRows.importJobId, jobId), eq(schema.importRows.status, 'error')))
          .limit(50),
      );
      return { jobId, rows: parsed.data.length, ok, errors, errorRows };
    }),

  /** Step 3: apply the ok rows as members. */
  applyImport: tenantProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.allow('member.import');
      const result = await ctx.tenant(async (tx) => {
        const jobRows = await tx
          .select()
          .from(schema.importJobs)
          .where(eq(schema.importJobs.id, input.jobId))
          .limit(1);
        const job = jobRows[0];
        if (!job) throw new TRPCError({ code: 'NOT_FOUND' });
        if (job.status !== 'dry_run') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Job is ${job.status}, expected dry_run` });
        }
        const rows = await tx
          .select()
          .from(schema.importRows)
          .where(and(eq(schema.importRows.importJobId, job.id), eq(schema.importRows.status, 'ok')));
        let applied = 0;
        for (const row of rows) {
          const m = row.mapped as Record<string, string | undefined>;
          await tx.insert(schema.members).values({
            id: uuidv7(),
            gymId: ctx.gym.id,
            firstName: m.firstName!,
            lastName: m.lastName!,
            email: m.email ?? null,
            phone: m.phone ?? null,
            status: (m.status as schema.MemberStatus | undefined) ?? 'active',
            membershipType: m.membershipType ?? null,
            dateOfBirth: m.dateOfBirth ?? null,
            joinedAt: m.joinedAt ?? null,
            emergencyName: m.emergencyName ?? null,
            emergencyPhone: m.emergencyPhone ?? null,
            goalsNote: m.goalsNote ?? null,
          });
          applied++;
        }
        await tx
          .update(schema.importRows)
          .set({ status: 'applied' })
          .where(and(eq(schema.importRows.importJobId, job.id), eq(schema.importRows.status, 'ok')));
        await tx
          .update(schema.importJobs)
          .set({ status: 'applied', totals: { ...job.totals, applied } })
          .where(eq(schema.importJobs.id, job.id));
        return { applied };
      });
      await ctx.audit('member.import', 'import_job', input.jobId, result);
      return result;
    }),

  jobs: tenantProcedure.query(async ({ ctx }) => {
    await ctx.allow('member.import');
    return ctx.tenant(async (tx) => {
      return tx
        .select()
        .from(schema.importJobs)
        .where(eq(schema.importJobs.gymId, ctx.gym.id))
        .orderBy(desc(schema.importJobs.createdAt))
        .limit(20);
    });
  }),
});
