import { Palette } from 'lucide-react'
import { useBranding } from '../../contexts/BrandingContext'
import BrandingEditor from '../../components/branding/BrandingEditor'
import { card } from '../../components/employees/styles'

/** Customer admins: the branding parts their provider lets them change (migration 036). */
export default function AdminBrandingPage() {
  const { branding } = useBranding()

  if (!branding.admin_edit_look && !branding.admin_edit_details) {
    return (
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#64748b' }}>
        <Palette size={20} />
        The app’s logo, colours and name are managed by your provider. Contact them to change it.
      </div>
    )
  }
  return <BrandingEditor scope="admin" />
}
