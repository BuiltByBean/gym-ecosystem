import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { Badge, PageHeader, Spinner, Table, Td } from '../../components/ui';
import { dateTime } from '../../lib/format';

export function AuditLog() {
  const events = useQuery({ queryKey: ['audit'], queryFn: () => api.gym.auditLog.query({ limit: 100 }) });
  if (events.isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title="Audit log" sub="Every sensitive read and every money/permission change, append-only" />
      <Table head={['When', 'Actor', 'Action', 'Resource', 'Detail']}>
        {(events.data ?? []).map((e) => (
          <tr key={e.id}>
            <Td className="whitespace-nowrap text-steel">{dateTime(e.createdAt)}</Td>
            <Td className="font-semibold">{e.actorName ?? 'system'}</Td>
            <Td><Badge tone={e.action.startsWith('health') ? 'alarm' : 'steel'}>{e.action}</Badge></Td>
            <Td className="text-steel">{e.resourceType}</Td>
            <Td className="max-w-64 truncate text-xs text-steel">{JSON.stringify(e.metadata)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
