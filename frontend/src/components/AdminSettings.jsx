/**
 * Admin Settings — locations, branding, backup, license (Super Admin).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  LuPlus, LuTrash2, LuSave, LuDatabase, LuMapPin, LuSettings,
  LuPencil, LuX, LuCheck, LuRefreshCw, LuShieldCheck,
  LuClock, LuTriangleAlert, LuUpload, LuImage,
} from 'react-icons/lu';
import config from '../utils/envConfig';
import apiClient from '../utils/apiClient';
import { notifyBrandingUpdated, fetchPublicBranding, getCachedBranding } from '../utils/appBranding';
import './management-pages.css';
import './admin-settings-page.css';
import AdminLicensePanel from './admin/AdminLicensePanel';
import AdminAutoUploadPanel from './admin/AdminAutoUploadPanel';
import AdminBankConfigPanel from './admin/AdminBankConfigPanel';
import AdminQueryCategoryPanel from './admin/AdminQueryCategoryPanel';
import BrandingLoginPreview from './admin/BrandingLoginPreview';
import { Button, Input, Label, Badge, Modal, Spinner, Segmented, EmptyState } from './ui';

const ALL_TABS = [
  { value: 'locations', label: 'Locations' },
  { value: 'application', label: 'Application' },
  { value: 'bank', label: 'Bank Config' },
  { value: 'query-types', label: 'Query Types' },
  { value: 'backup', label: 'Backup' },
  { value: 'auto-upload', label: 'Auto Upload' },
  { value: 'license', label: 'License' },
];

function normalizeLocation(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    LocationID: row.LocationID ?? row.locationId ?? row.locationID ?? row.id,
    LocationName: row.LocationName ?? row.locationName ?? row.name ?? '',
    IsActive: row.IsActive ?? row.isActive ?? row.isactive ?? true,
    CreatedAt: row.CreatedAt ?? row.createdAt ?? null,
    UpdatedAt: row.UpdatedAt ?? row.updatedAt ?? null,
  };
}

function isLocationActive(loc) {
  return loc?.IsActive === true || loc?.IsActive === 1;
}

function apiErrorMessage(err, fallback) {
  const status = err?.response?.status;
  const msg = err?.response?.data?.message;
  if (status === 403) return msg || 'Admin access required. Log in as Admin or Super Admin.';
  if (status === 401) return msg || 'Session expired. Please log in again.';
  return msg || fallback;
}

function useNotification() {
  const [notification, setNotification] = useState(null);
  const timerRef = useRef(null);
  const show = useCallback((msg, type = 'success') => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setNotification({ msg, type });
    timerRef.current = setTimeout(() => setNotification(null), 4500);
  }, []);
  return [notification, show];
}

export default function AdminSettings({ licenseOnly = false }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { userType, username } = useAuth();
  const isSuper = userType === 'Super Admin';
  const isAdmin = ['Super Admin', 'Admin'].includes(userType);

  const tabFromUrl = searchParams.get('tab');
  const initialTab = licenseOnly ? 'license' : (tabFromUrl || 'locations');

  const [activeTab, setActiveTab] = useState(initialTab);
  const [notification, showNotice] = useNotification();

  const [locations, setLocations] = useState([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [newLocation, setNewLocation] = useState('');
  const [addingLocation, setAddingLocation] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [deleteModal, setDeleteModal] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const [settings, setSettings] = useState({ app_name: '', backup_path: '' });
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [logoPreview, setLogoPreview] = useState('');
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef(null);
  const originalSettings = useRef({});

  const [backupRunning, setBackupRunning] = useState(false);
  const [backupHistory, setBackupHistory] = useState([]);
  const [backupHistoryLoading, setBackupHistoryLoading] = useState(false);

  const tabsToShow = licenseOnly
    ? ALL_TABS.filter((t) => t.value === 'license')
    : isSuper
      ? ALL_TABS
      : ALL_TABS.filter((t) => !['backup', 'license', 'auto-upload', 'bank'].includes(t.value));

  const setTab = (tab) => {
    setActiveTab(tab);
    if (!licenseOnly) setSearchParams(tab === 'locations' ? {} : { tab }, { replace: true });
  };

  useEffect(() => {
    if (tabFromUrl && tabsToShow.some((t) => t.value === tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl, tabsToShow]);

  const fetchLocations = useCallback(async () => {
    setLocationsLoading(true);
    try {
      const { data } = await apiClient.get('/api/admin/locations');
      if (data.success) {
        setLocations((data.locations || []).map(normalizeLocation).filter(Boolean));
      } else {
        showNotice(data.message || 'Failed to load locations', 'error');
      }
    } catch (err) {
      showNotice(apiErrorMessage(err, 'Failed to load locations. Restart the backend server.'), 'error');
    } finally {
      setLocationsLoading(false);
    }
  }, [showNotice]);

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const [settingsRes, branding] = await Promise.all([
        fetch(`${config.apiBaseUrl}/api/admin/settings`),
        fetchPublicBranding(),
      ]);
      const data = await settingsRes.json();
      if (data.success) {
        const s = { app_name: '', backup_path: '', ...data.settings };
        setSettings(s);
        originalSettings.current = { ...s };
        setSettingsDirty(false);
      }
      if (branding?.logoUrl) setLogoPreview(branding.logoUrl);
    } catch {
      showNotice('Failed to load settings', 'error');
    } finally {
      setSettingsLoading(false);
    }
  }, [showNotice]);

  const fetchBackupHistory = useCallback(async () => {
    setBackupHistoryLoading(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/admin/backup-history`);
      const data = await res.json();
      if (data.success) setBackupHistory(data.backups || []);
    } catch {
      setBackupHistory([]);
    } finally {
      setBackupHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!licenseOnly && isAdmin) {
      fetchLocations();
      fetchSettings();
    }
  }, [fetchLocations, fetchSettings, licenseOnly, isAdmin]);

  useEffect(() => {
    if (activeTab === 'backup' && isSuper) fetchBackupHistory();
  }, [activeTab, isSuper, fetchBackupHistory]);

  const updateSetting = (key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      setSettingsDirty(
        next.app_name !== originalSettings.current.app_name
        || next.backup_path !== originalSettings.current.backup_path,
      );
      return next;
    });
  };

  const addLocation = async () => {
    const name = newLocation.trim();
    if (!name) {
      showNotice('Enter a location name before adding.', 'error');
      return;
    }
    setAddingLocation(true);
    try {
      const { data } = await apiClient.post('/api/admin/locations', { locationName: name });
      if (data.success) {
        setNewLocation('');
        fetchLocations();
        showNotice('Location added');
      } else {
        showNotice(data.message || 'Could not add location', 'error');
      }
    } catch (err) {
      showNotice(apiErrorMessage(err, 'Error adding location'), 'error');
    } finally {
      setAddingLocation(false);
    }
  };

  const saveEdit = async (loc) => {
    const name = editName.trim();
    if (!name || name === loc.LocationName) {
      setEditingId(null);
      setEditName('');
      return;
    }
    try {
      const { data } = await apiClient.put(`/api/admin/locations/${loc.LocationID}`, { locationName: name });
      if (data.success) {
        fetchLocations();
        showNotice('Location renamed');
      } else {
        showNotice(data.message || 'Rename failed', 'error');
      }
    } catch (err) {
      showNotice(apiErrorMessage(err, 'Error renaming location'), 'error');
    } finally {
      setEditingId(null);
      setEditName('');
    }
  };

  const toggleLocationActive = async (loc) => {
    try {
      const { data } = await apiClient.put(`/api/admin/locations/${loc.LocationID}`, { isActive: !isLocationActive(loc) });
      if (data.success) {
        fetchLocations();
        showNotice(`Location ${isLocationActive(loc) ? 'disabled' : 'enabled'}`);
      } else {
        showNotice(data.message || 'Update failed', 'error');
      }
    } catch (err) {
      showNotice(apiErrorMessage(err, 'Error updating location'), 'error');
    }
  };

  const deleteLocation = async () => {
    if (!deleteModal) return;
    setDeletingId(deleteModal.LocationID);
    try {
      const { data } = await apiClient.delete(`/api/admin/locations/${deleteModal.LocationID}`);
      if (data.success) {
        fetchLocations();
        showNotice('Location deleted');
      } else {
        showNotice(data.message || 'Delete failed', 'error');
      }
    } catch (err) {
      showNotice(apiErrorMessage(err, 'Error deleting location'), 'error');
    } finally {
      setDeleteModal(null);
      setDeletingId(null);
    }
  };

  const saveSettings = async (keys) => {
    setSaving(true);
    try {
      const payload = keys
        ? Object.fromEntries(keys.map((k) => [k, settings[k] ?? '']))
        : settings;
      const res = await fetch(`${config.apiBaseUrl}/api/admin/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: payload }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        originalSettings.current = { ...settings };
        setSettingsDirty(false);
        if (payload.app_name) {
          notifyBrandingUpdated({ appName: settings.app_name, logoUrl: logoPreview });
        }
        showNotice('Settings saved');
      } else {
        showNotice(data.message || 'Save failed', 'error');
      }
    } catch {
      showNotice('Error saving settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append('logo', file);
      const res = await fetch(`${config.apiBaseUrl}/api/admin/logo`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setLogoPreview(data.logoUrl);
        const currentName = settings.app_name || getCachedBranding()?.appName || 'Call Analysis';
        notifyBrandingUpdated({ appName: currentName, logoUrl: data.logoUrl });
        showNotice('Logo uploaded — visible across the app');
      } else {
        showNotice(data.message || 'Logo upload failed', 'error');
      }
    } catch {
      showNotice('Error uploading logo', 'error');
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };

  const triggerBackup = async () => {
    setBackupRunning(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/admin/backup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        showNotice(data.message || 'Backup completed');
        fetchBackupHistory();
      } else {
        showNotice(data.message || 'Backup failed', 'error');
      }
    } catch {
      showNotice('Error triggering backup', 'error');
    } finally {
      setBackupRunning(false);
    }
  };

  if (!licenseOnly && !isAdmin) {
    return (
      <div className="app-page reports-page admin-settings" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <LuShieldCheck size={48} style={{ color: 'var(--danger)', marginBottom: '1rem' }} />
        <h2 style={{ color: 'var(--danger)' }}>Access denied</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Only Admin and Super Admin can access this page.</p>
        <Button variant="secondary" onClick={() => navigate('/')}>Go to dashboard</Button>
      </div>
    );
  }

  if (licenseOnly && !isSuper) {
    return (
      <div className="app-page admin-settings admin-settings--license-only">
        <p style={{ textAlign: 'center', color: 'var(--danger)' }}>Super Admin access required.</p>
      </div>
    );
  }

  const activeCount = locations.filter(isLocationActive).length;
  const inactiveCount = locations.length - activeCount;

  return (
    <div className={`app-page reports-page mgmt-page admin-settings${licenseOnly ? ' admin-settings--license-only' : ''}`}>
      {notification && (
        <div className={`admin-settings__toast admin-settings__toast--${notification.type === 'error' ? 'error' : 'success'}`}>
          {notification.type === 'error' ? <LuTriangleAlert size={16} /> : <LuCheck size={16} />}
          {notification.msg}
        </div>
      )}

      <header className="admin-settings__hero">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div>
            <h2>
              <LuSettings size={22} />
              {licenseOnly ? 'License management' : 'Admin settings'}
            </h2>
            <p>
              {licenseOnly
                ? 'Upload and manage application license keys.'
                : 'Configure locations, branding, database backups, and license keys.'}
            </p>
          </div>
          {licenseOnly && (
            <Button variant="secondary" size="sm" onClick={() => { localStorage.clear(); navigate('/login'); }}>
              Log out
            </Button>
          )}
        </div>
      </header>

      <div className="admin-settings__toolbar">
        <div className="admin-settings__tabs">
          <Segmented options={tabsToShow} value={activeTab} onChange={setTab} />
        </div>
      </div>

      {activeTab === 'locations' && (
        <section className="admin-settings__panel">
          <header className="admin-settings__panel-head">
            <div>
              <h3><LuMapPin size={18} /> Locations</h3>
              <p>Office and site locations used when creating agents and filtering reports.</p>
            </div>
            {!locationsLoading && locations.length > 0 && (
              <div className="admin-settings__badges">
                <Badge variant="success">{activeCount} active</Badge>
                {inactiveCount > 0 && <Badge variant="default">{inactiveCount} inactive</Badge>}
              </div>
            )}
          </header>

          <div className="admin-settings__add-row">
            <Input
              type="text"
              placeholder="New location name…"
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !addingLocation && newLocation.trim() && addLocation()}
              disabled={addingLocation}
            />
            <Button
              variant="primary"
              onClick={addLocation}
              disabled={addingLocation || !newLocation.trim()}
              title={!newLocation.trim() ? 'Enter a location name to enable Add' : undefined}
            >
              {addingLocation ? <LuRefreshCw className="spin-icon" size={14} /> : <LuPlus size={14} />}
              Add
            </Button>
          </div>
          {!newLocation.trim() && !addingLocation && (
            <p className="admin-settings__field-hint admin-settings__add-hint">Type a location name above to enable Add.</p>
          )}

          {locationsLoading ? (
            <div className="admin-settings__loading"><Spinner /></div>
          ) : locations.length === 0 ? (
            <p className="admin-settings__empty">No locations yet. Add one above.</p>
          ) : (
            <div className="mgmt-table-wrap admin-settings__table-wrap">
              <table className="ui-table admin-settings__locations-table">
                <thead>
                  <tr>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((loc) => (
                    <tr key={loc.LocationID ?? loc.LocationName} style={{ opacity: deletingId === loc.LocationID ? 0.5 : 1 }}>
                      <td>
                        {editingId === loc.LocationID ? (
                          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                            <Input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEdit(loc);
                                if (e.key === 'Escape') { setEditingId(null); setEditName(''); }
                              }}
                              style={{ width: '180px', padding: '4px 8px', fontSize: '0.85rem' }}
                              autoFocus
                            />
                            <Button variant="primary" size="sm" onClick={() => saveEdit(loc)}><LuCheck size={13} /></Button>
                            <Button variant="secondary" size="sm" onClick={() => { setEditingId(null); setEditName(''); }}><LuX size={13} /></Button>
                          </div>
                        ) : (
                          <strong>{loc.LocationName}</strong>
                        )}
                      </td>
                      <td>
                        <Badge variant={isLocationActive(loc) ? 'success' : 'default'}>
                          {isLocationActive(loc) ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="admin-license__muted">
                        {loc.CreatedAt ? new Date(loc.CreatedAt).toLocaleDateString() : '—'}
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {editingId !== loc.LocationID && (
                          <>
                            <Button variant="secondary" size="sm" onClick={() => { setEditingId(loc.LocationID); setEditName(loc.LocationName); }} style={{ marginRight: '0.35rem' }}>
                              <LuPencil size={13} />
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => toggleLocationActive(loc)} style={{ marginRight: '0.35rem' }}>
                              {isLocationActive(loc) ? 'Disable' : 'Enable'}
                            </Button>
                            <Button variant="danger" size="sm" onClick={() => setDeleteModal(loc)}>
                              <LuTrash2 size={13} />
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === 'application' && (
        <section className="admin-settings__panel">
          <header className="admin-settings__panel-head">
            <div>
              <h3><LuSettings size={18} /> Application</h3>
              <p>Customize the application name and logo shown across the platform.</p>
            </div>
          </header>

          {settingsLoading ? (
            <div className="admin-settings__loading"><Spinner /></div>
          ) : (
            <div className="mgmt-form-grid" style={{ maxWidth: '640px' }}>
              <div className="mgmt-field--full">
                <Label>Application name</Label>
                <Input
                  value={settings.app_name || ''}
                  onChange={(e) => updateSetting('app_name', e.target.value)}
                  placeholder="e.g. Call Analysis"
                />
                <p className="admin-settings__field-hint">Shown in the browser tab, login page, and sidebar.</p>
              </div>

              <div className="mgmt-field--full">
                <Label>Application logo</Label>
                <div className="admin-settings__logo-upload">
                  <div className="admin-settings__logo-preview admin-settings__logo-preview--large">
                    {logoPreview ? (
                      <img src={logoPreview} alt="App logo preview" />
                    ) : (
                      <LuImage size={28} />
                    )}
                  </div>
                  <div className="admin-settings__logo-upload-body">
                    <p className="admin-settings__field-hint">
                      Upload PNG, JPG, WEBP, GIF, or SVG (max 2 MB). Updates favicon, login page, and header.
                    </p>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/svg+xml"
                      className="admin-settings__file-input"
                      onChange={(e) => uploadLogo(e.target.files?.[0])}
                      disabled={logoUploading}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={logoUploading}
                      onClick={() => logoInputRef.current?.click()}
                    >
                      {logoUploading ? <LuRefreshCw className="spin-icon" size={14} /> : <LuUpload size={14} />}
                      {logoUploading ? 'Uploading…' : 'Choose logo file'}
                    </Button>
                  </div>
                </div>
              </div>

              <BrandingLoginPreview
                appName={settings.app_name || getCachedBranding()?.appName}
                logoUrl={logoPreview}
              />

              <div className="admin-settings__panel-actions" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
                {settingsDirty && (
                  <span className="admin-settings__unsaved"><LuTriangleAlert size={14} /> Unsaved changes</span>
                )}
                <Button variant="secondary" onClick={() => { setSettings({ ...originalSettings.current }); setSettingsDirty(false); }} disabled={!settingsDirty || saving}>
                  <LuRefreshCw size={14} /> Reset
                </Button>
                <Button variant="primary" onClick={() => saveSettings(['app_name'])} disabled={saving || !settingsDirty}>
                  {saving ? <LuRefreshCw className="spin-icon" size={14} /> : <LuSave size={14} />}
                  Save name
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      {activeTab === 'backup' && isSuper && (
        <>
          <section className="admin-settings__panel">
            <header className="admin-settings__panel-head">
              <div>
                <h3><LuDatabase size={18} /> Database backup</h3>
                <p>Set the server backup folder and run on-demand database backups.</p>
              </div>
            </header>
            <div className="mgmt-form-grid" style={{ maxWidth: '640px' }}>
              <div className="mgmt-field--full">
                <Label>Default backup path</Label>
                <Input
                  value={settings.backup_path || ''}
                  onChange={(e) => updateSetting('backup_path', e.target.value)}
                  placeholder="C:\SQLBackups"
                />
                <p className="admin-settings__field-hint">SQL Server writes backup files to this folder on the server machine.</p>
              </div>
              <div className="admin-settings__panel-actions" style={{ borderTop: 'none', paddingTop: 0 }}>
                <Button variant="secondary" onClick={() => saveSettings(['backup_path'])} disabled={saving || !settingsDirty} style={{ marginRight: 'auto' }}>
                  <LuSave size={14} /> Save path
                </Button>
                <Button variant="primary" onClick={triggerBackup} disabled={backupRunning}>
                  {backupRunning ? <LuRefreshCw className="spin-icon" size={14} /> : <LuDatabase size={14} />}
                  {backupRunning ? 'Running…' : 'Backup now'}
                </Button>
              </div>
            </div>
          </section>

          <section className="admin-settings__panel">
            <header className="admin-settings__panel-head">
              <div>
                <h3><LuClock size={18} /> Backup history</h3>
                <p>Recent database backups from the server.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={fetchBackupHistory}>
                <LuRefreshCw size={13} /> Refresh
              </Button>
            </header>
            {backupHistoryLoading ? (
              <div className="admin-settings__loading"><Spinner /></div>
            ) : backupHistory.length === 0 ? (
              <EmptyState icon={<LuDatabase size={32} />} title="No backup history">
                <p className="admin-settings__empty">Run a backup to see history here.</p>
              </EmptyState>
            ) : (
              <div className="mgmt-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Date</th>
                      <th>Size</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backupHistory.map((b, i) => (
                      <tr key={i}>
                        <td className="admin-license__key-cell">{b.filename || b.path || '—'}</td>
                        <td className="admin-license__muted">{b.created_at ? new Date(b.created_at).toLocaleString() : '—'}</td>
                        <td>{b.size || '—'}</td>
                        <td><Badge variant={b.status === 'failed' ? 'danger' : 'success'}>{b.status || 'OK'}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {activeTab === 'bank' && isSuper && (
        <AdminBankConfigPanel showNotice={showNotice} />
      )}

      {activeTab === 'query-types' && isAdmin && (
        <AdminQueryCategoryPanel showNotice={showNotice} />
      )}

      {activeTab === 'auto-upload' && isSuper && (
        <AdminAutoUploadPanel onNotice={showNotice} />
      )}

      {activeTab === 'license' && isSuper && (
        <AdminLicensePanel username={username} onNotice={showNotice} />
      )}

      <Modal open={!!deleteModal} onClose={() => setDeleteModal(null)} maxWidth="420px">
        <h3 style={{ margin: '0 0 var(--space-3)' }}>Delete location?</h3>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Delete <strong>{deleteModal?.LocationName}</strong>? This cannot be undone.
        </p>
        <div className="mgmt-modal-actions">
          <Button variant="secondary" onClick={() => setDeleteModal(null)}>Cancel</Button>
          <Button variant="danger" onClick={deleteLocation}><LuTrash2 size={14} /> Delete</Button>
        </div>
      </Modal>
    </div>
  );
}
