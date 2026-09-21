import { ResourceManager } from '@/components/admin-dashboard'
export default function AuditLogsPage() { return <ResourceManager resource="audit-logs" title="Audit Logs" description="A server-generated trail of admin mutations across games, scripts, links, and blacklist state." columns={['actorEmail','action','entityType','entityId','createdAt']} fields={[]} /> }
