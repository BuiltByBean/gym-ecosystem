import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, errMessage } from '../../api';
import { Button, Card, PageHeader, Select, Table, Td, toast, Badge } from '../../components/ui';

type Step =
  | { step: 'pick' }
  | { step: 'map'; filename: string; csvText: string; headers: string[]; fields: readonly string[]; mapping: Record<string, string>; preview: Record<string, string>[]; rowCount: number }
  | { step: 'review'; filename: string; jobId: string; rows: number; ok: number; errors: number; errorRows: { rowNo: number; error: string | null }[] }
  | { step: 'done'; applied: number };

export function ImportMembers() {
  const [state, setState] = useState<Step>({ step: 'pick' });

  const parse = useMutation({
    mutationFn: async (file: File) => {
      const csvText = await file.text();
      const result = await api.imports.parse.mutate({ csvText });
      return { file, csvText, result };
    },
    onSuccess: ({ file, csvText, result }) =>
      setState({
        step: 'map',
        filename: file.name,
        csvText,
        headers: result.headers,
        fields: result.fields,
        mapping: result.autoMapping,
        preview: result.preview,
        rowCount: result.rowCount,
      }),
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const dryRun = useMutation({
    mutationFn: (s: Extract<Step, { step: 'map' }>) =>
      api.imports.dryRun.mutate({ filename: s.filename, csvText: s.csvText, mapping: s.mapping }),
    onSuccess: (r, s) =>
      setState({ step: 'review', filename: s.filename, jobId: r.jobId, rows: r.rows, ok: r.ok, errors: r.errors, errorRows: r.errorRows.map((e) => ({ rowNo: e.rowNo, error: e.error })) }),
    onError: (e) => toast(errMessage(e), 'err'),
  });

  const apply = useMutation({
    mutationFn: (jobId: string) => api.imports.applyImport.mutate({ jobId }),
    onSuccess: (r) => setState({ step: 'done', applied: r.applied }),
    onError: (e) => toast(errMessage(e), 'err'),
  });

  return (
    <>
      <PageHeader title="Import members" sub="CSV from any system — map the columns, dry-run, then apply." />

      {state.step === 'pick' && (
        <Card className="max-w-xl">
          <p className="mb-4 text-sm text-steel">
            Export your member list from your current system (ABC, Mindbody, Club Automation, Glofox, or a plain
            spreadsheet) as CSV and drop it here. Nothing is written until you approve the dry run.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2.5 file:font-semibold file:text-brand-ink"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) parse.mutate(f);
            }}
          />
          {parse.isPending && <p className="mt-3 text-sm text-steel">Parsing…</p>}
        </Card>
      )}

      {state.step === 'map' && (
        <div className="space-y-4">
          <Card>
            <h3 className="mb-1 font-display font-bold">Map columns</h3>
            <p className="mb-4 text-sm text-steel">{state.rowCount} rows in {state.filename}. First and last name are required.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {state.fields.map((field) => (
                <label key={field} className="block">
                  <span className="mb-1 block text-[13px] font-medium text-steel">{field}</span>
                  <Select
                    value={state.mapping[field] ?? ''}
                    onChange={(e) =>
                      setState({ ...state, mapping: { ...state.mapping, [field]: e.target.value } })
                    }
                  >
                    <option value="">— skip —</option>
                    {state.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </Select>
                </label>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => dryRun.mutate(state)} disabled={dryRun.isPending}>
                {dryRun.isPending ? 'Validating…' : 'Dry run'}
              </Button>
              <Button variant="quiet" onClick={() => setState({ step: 'pick' })}>Start over</Button>
            </div>
          </Card>
          <Card>
            <h3 className="mb-2 font-display font-bold">Preview</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr>{state.headers.map((h) => <th key={h} className="px-2 py-1 text-left text-steel">{h}</th>)}</tr></thead>
                <tbody>
                  {state.preview.map((row, i) => (
                    <tr key={i} className="border-t border-line">
                      {state.headers.map((h) => <td key={h} className="px-2 py-1">{row[h]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {state.step === 'review' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <Badge tone="signal">{state.ok} ready</Badge>
            <Badge tone={state.errors ? 'alarm' : 'steel'}>{state.errors} with errors</Badge>
          </div>
          {state.errorRows.length > 0 && (
            <Table head={['Row', 'Problem']}>
              {state.errorRows.map((r) => (
                <tr key={r.rowNo}>
                  <Td>{r.rowNo}</Td>
                  <Td className="text-alarm">{r.error}</Td>
                </tr>
              ))}
            </Table>
          )}
          <div className="flex gap-2">
            <Button onClick={() => apply.mutate(state.jobId)} disabled={apply.isPending || state.ok === 0}>
              {apply.isPending ? 'Importing…' : `Import ${state.ok} members`}
            </Button>
            <Button variant="quiet" onClick={() => setState({ step: 'pick' })}>Cancel</Button>
          </div>
          <p className="text-xs text-steel">Rows with errors are skipped; fix the source file and re-import them later.</p>
        </div>
      )}

      {state.step === 'done' && (
        <Card className="max-w-md text-center">
          <div className="score text-4xl text-signal">{state.applied}</div>
          <p className="mt-1 font-semibold">members imported</p>
          <Button className="mt-4" onClick={() => setState({ step: 'pick' })}>Import another file</Button>
        </Card>
      )}
    </>
  );
}
