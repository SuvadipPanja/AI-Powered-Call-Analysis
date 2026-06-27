/**
 * Query-category panel — admin-managed taxonomy of customer call query types.
 * Add / edit / disable / recolour the categories the AI classifies calls into.
 */
import { useState, useEffect, useCallback } from 'react';
import { LuLayers, LuPlus, LuPencil, LuTrash2, LuRefreshCw, LuCheck, LuX } from 'react-icons/lu';
import apiClient from '../../utils/apiClient';
import { Button, Input, Label, Badge, Modal, Spinner } from '../ui';

function emptyDraft() {
  return { id: null, name: '', description: '', keywords: '', color: '#6366f1', isActive: true, sortOrder: 0 };
}

export default function AdminQueryCategoryPanel({ showNotice }) {
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState([]);
  const [editor, setEditor] = useState(null);     // draft being edited/created (or null)
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/api/query-categories');
      if (data.success) setCategories(data.categories || []);
    } catch (err) {
      showNotice?.(err?.response?.data?.message || 'Failed to load query categories.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotice]);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  const openCreate = () => setEditor(emptyDraft());
  const openEdit = (c) => setEditor({ ...c });

  const saveDraft = async () => {
    const d = editor;
    if (!d.name.trim()) { showNotice?.('Category name is required.', 'error'); return; }
    setSaving(true);
    try {
      const payload = {
        name: d.name.trim(),
        description: d.description?.trim() || '',
        keywords: d.keywords?.trim() || '',
        color: d.color || '#94a3b8',
        isActive: d.isActive !== false,
        sortOrder: Number.isFinite(+d.sortOrder) ? +d.sortOrder : 0,
      };
      if (d.id) {
        await apiClient.put(`/api/query-categories/${d.id}`, payload);
        showNotice?.('Query category updated.', 'success');
      } else {
        await apiClient.post('/api/query-categories', payload);
        showNotice?.('Query category added.', 'success');
      }
      setEditor(null);
      fetchCategories();
    } catch (err) {
      showNotice?.(err?.response?.data?.message || 'Failed to save category.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c) => {
    try {
      await apiClient.put(`/api/query-categories/${c.id}`, { ...c, isActive: !c.isActive });
      fetchCategories();
    } catch (err) {
      showNotice?.(err?.response?.data?.message || 'Failed to update category.', 'error');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/api/query-categories/${deleteTarget.id}`);
      showNotice?.('Query category deleted.', 'success');
      setDeleteTarget(null);
      fetchCategories();
    } catch (err) {
      showNotice?.(err?.response?.data?.message || 'Failed to delete category.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="admin-panel">
      <div className="admin-panel__header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <LuLayers /> Customer Query Types
          </h3>
          <p className="admin-panel__hint" style={{ margin: '4px 0 0', color: 'var(--text-muted,#64748b)', fontSize: 13 }}>
            The taxonomy the AI uses to classify what each call is about. Add specific types
            (e.g. "ATM/Debit PIN Generation") and keywords so calls map precisely.
            Keywords help the AI match phrasing variations.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" onClick={fetchCategories}><LuRefreshCw /> Refresh</Button>
          <Button onClick={openCreate}><LuPlus /> Add Query Type</Button>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center' }}><Spinner /> Loading…</div>
      ) : (
        <div className="management-table-wrap" style={{ marginTop: 16, overflowX: 'auto' }}>
          <table className="management-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Query Type</th>
                <th>Description</th>
                <th>Keywords</th>
                <th style={{ width: 70 }}>Colour</th>
                <th style={{ width: 90 }}>Status</th>
                <th style={{ width: 130 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td>{c.sortOrder}</td>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td style={{ color: 'var(--text-muted,#64748b)', maxWidth: 280 }}>{c.description}</td>
                  <td style={{ color: 'var(--text-muted,#64748b)', maxWidth: 240, fontSize: 12 }}>{c.keywords}</td>
                  <td>
                    <span title={c.color} style={{ display: 'inline-block', width: 22, height: 22, borderRadius: 6, background: c.color, border: '1px solid #00000022' }} />
                  </td>
                  <td>
                    <Badge variant={c.isActive ? 'success' : 'muted'}>{c.isActive ? 'Active' : 'Disabled'}</Badge>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button size="sm" variant="ghost" title="Edit" onClick={() => openEdit(c)}><LuPencil /></Button>
                      <Button size="sm" variant="ghost" title={c.isActive ? 'Disable' : 'Enable'} onClick={() => toggleActive(c)}>
                        {c.isActive ? <LuX /> : <LuCheck />}
                      </Button>
                      <Button size="sm" variant="ghost" title="Delete" onClick={() => setDeleteTarget(c)}><LuTrash2 /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted,#64748b)' }}>No query types yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Editor modal */}
      <Modal open={!!editor} onClose={() => setEditor(null)} maxWidth="520px">
        {editor && (
          <div style={{ padding: 4 }}>
            <h3 style={{ marginTop: 0 }}>{editor.id ? 'Edit Query Type' : 'Add Query Type'}</h3>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <Label>Name *</Label>
                <Input value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} placeholder="e.g. ATM/Debit PIN Generation" />
              </div>
              <div>
                <Label>Description</Label>
                <Input value={editor.description} onChange={(e) => setEditor({ ...editor, description: e.target.value })} placeholder="What this category covers" />
              </div>
              <div>
                <Label>Keywords (comma separated)</Label>
                <Input value={editor.keywords} onChange={(e) => setEditor({ ...editor, keywords: e.target.value })} placeholder="generate pin, reset pin, forgot pin" />
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div>
                  <Label>Colour</Label>
                  <input type="color" value={editor.color || '#6366f1'} onChange={(e) => setEditor({ ...editor, color: e.target.value })} style={{ width: 54, height: 38, border: 'none', background: 'none', cursor: 'pointer' }} />
                </div>
                <div style={{ width: 110 }}>
                  <Label>Sort order</Label>
                  <Input type="number" value={editor.sortOrder} onChange={(e) => setEditor({ ...editor, sortOrder: e.target.value })} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <input type="checkbox" checked={editor.isActive !== false} onChange={(e) => setEditor({ ...editor, isActive: e.target.checked })} />
                  Active
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <Button variant="ghost" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
              <Button onClick={saveDraft} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="420px">
        {deleteTarget && (
          <div style={{ padding: 4 }}>
            <h3 style={{ marginTop: 0 }}>Delete query type?</h3>
            <p>Delete <strong>{deleteTarget.name}</strong>? Existing calls keep their stored value; new calls will no longer be classified into this type.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" onClick={confirmDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
