import { ResourceManager } from '@/components/admin-dashboard'
export default function WebhooksPage() { return <ResourceManager resource="webhooks" title="Discord Webhooks" description="Persist approved HTTPS destinations for explicit runtime notifications. URLs are never inferred from uploaded scripts." columns={['name','url','enabled','events','updatedAt']} fields={['name','url','events']} /> }
