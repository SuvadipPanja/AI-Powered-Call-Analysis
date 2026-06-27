/**
 * Standalone license route — redirects to Admin Settings license tab.
 * Kept for backward compatibility (expired-license / temp super-admin flow).
 */
import { Navigate } from 'react-router-dom';

export default function LicenseManagement() {
  return <Navigate to="/admin-settings?tab=license" replace />;
}
