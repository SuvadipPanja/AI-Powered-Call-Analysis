/**
 * Bank configuration panel — terminology, glossaries, taboo words for AI accuracy.
 */
import { useState, useEffect, useCallback } from 'react';
import { LuBuilding2, LuPlus, LuTrash2, LuSave, LuRefreshCw, LuShieldAlert } from 'react-icons/lu';
import apiClient from '../../utils/apiClient';
import { Button, Input, Label, Spinner } from '../ui';

const SUPPORTED_LANGUAGES = [
  'Hindi', 'Hinglish', 'English', 'Bengali', 'Tamil', 'Telugu', 'Marathi',
  'Gujarati', 'Kannada', 'Malayalam', 'Punjabi', 'Odia', 'Assamese', 'Urdu', 'Any',
];

const DEFAULT_BANKING_TERMS = [
  'account', 'balance', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'KYC', 'OTP',
  'FD', 'RD', 'loan', 'EMI', 'branch', 'IFSC', 'passbook', 'cheque',
  'debit card', 'credit card', 'RBI', 'CIBIL', 'overdraft',
].join(', ');

const DEFAULT_NON_BANKING_TERMS = [
  'order', 'order ID', 'tracking', 'delivery', 'return', 'refund',
  'warranty', 'subscription', 'invoice', 'support ticket', 'escalation',
  'callback', 'complaint', 'activation', 'recharge', 'plan upgrade',
].join(', ');

function emptyGlossaryRow() {
  return { source: '', target: '', note: '', language: 'Hindi' };
}

function emptyTabooRow() {
  return { word: '', language: 'Any', severity: 'medium', appliesTo: 'agent', category: 'policy' };
}

export default function AdminBankConfigPanel({ showNotice }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankNameLocal, setBankNameLocal] = useState('');
  const [productTerms, setProductTerms] = useState('');
  const [nonBankingTerms, setNonBankingTerms] = useState('');
  const [glossary, setGlossary] = useState([emptyGlossaryRow()]);
  const [tabooWords, setTabooWords] = useState([emptyTabooRow()]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [updatedBy, setUpdatedBy] = useState('');

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/api/admin/bank-settings');
      if (data.success && data.config) {
        const c = data.config;
        setBankName(c.bankName || '');
        setBankNameLocal(c.bankNameLocal || '');
        setProductTerms((c.productTerms || []).join(', ') || DEFAULT_BANKING_TERMS);
        setNonBankingTerms((c.nonBankingTerms || []).join(', ') || DEFAULT_NON_BANKING_TERMS);
        setGlossary(
          c.glossary?.length
            ? c.glossary.map((g) => ({
              source: g.source || '',
              target: g.target || '',
              note: g.note || '',
              language: g.language || 'Hindi',
            }))
            : [emptyGlossaryRow()],
        );
        setTabooWords(
          c.tabooWords?.length
            ? c.tabooWords.map((t) => ({
              word: t.word || '',
              language: t.language || 'Any',
              severity: t.severity || 'medium',
              appliesTo: t.appliesTo || 'agent',
              category: t.category || 'policy',
            }))
            : [emptyTabooRow()],
        );
        setUpdatedAt(c.updatedAt || null);
        setUpdatedBy(c.updatedBy || '');
      }
    } catch (err) {
      showNotice(err?.response?.data?.message || 'Failed to load bank settings', 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotice]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const updateGlossary = (index, field, value) => {
    setGlossary((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const updateTaboo = (index, field, value) => {
    setTabooWords((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const addGlossaryRow = () => setGlossary((prev) => [...prev, emptyGlossaryRow()]);
  const removeGlossaryRow = (index) => {
    setGlossary((prev) => (prev.length <= 1 ? [emptyGlossaryRow()] : prev.filter((_, i) => i !== index)));
  };

  const addTabooRow = () => setTabooWords((prev) => [...prev, emptyTabooRow()]);
  const removeTabooRow = (index) => {
    setTabooWords((prev) => (prev.length <= 1 ? [emptyTabooRow()] : prev.filter((_, i) => i !== index)));
  };

  const splitTerms = (text) => text.split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);

  const saveConfig = async () => {
    if (!bankName.trim()) {
      showNotice('Organization / bank name is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        bankName: bankName.trim(),
        bankNameLocal: bankNameLocal.trim(),
        productTerms: splitTerms(productTerms),
        nonBankingTerms: splitTerms(nonBankingTerms),
        glossary: glossary
          .map((g) => ({
            source: g.source.trim(),
            target: g.target.trim(),
            note: g.note.trim(),
            language: g.language || 'Hindi',
          }))
          .filter((g) => g.source || g.target),
        tabooWords: tabooWords
          .map((t) => ({
            word: t.word.trim(),
            language: t.language || 'Any',
            severity: t.severity || 'medium',
            appliesTo: t.appliesTo || 'agent',
            category: t.category || 'policy',
          }))
          .filter((t) => t.word),
      };
      const { data } = await apiClient.put('/api/admin/bank-settings', payload);
      if (data.success) {
        showNotice('Settings saved. New calls will use updated glossaries and taboo rules.');
        if (data.config) {
          setUpdatedAt(data.config.updatedAt || null);
          setUpdatedBy(data.config.updatedBy || '');
        }
      } else {
        showNotice(data.message || 'Save failed', 'error');
      }
    } catch (err) {
      showNotice(err?.response?.data?.message || 'Error saving settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-settings__loading">
        <Spinner />
      </div>
    );
  }

  return (
    <section className="admin-settings__panel">
      <header className="admin-settings__panel-head">
        <div>
          <h3><LuBuilding2 size={18} /> Call Center Configuration</h3>
          <p>
            Configure organization name, banking &amp; non-banking terms, multi-language translation
            glossary, and prohibited phrases (taboo words) for scoring and compliance.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={fetchConfig} disabled={saving}>
          <LuRefreshCw size={14} /> Refresh
        </Button>
      </header>

      <div className="admin-settings__form-grid">
        <div className="admin-settings__field">
          <Label htmlFor="bank-name">Organization / bank name (English)</Label>
          <Input
            id="bank-name"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="e.g. UCO Bank or Generic Call Center"
          />
        </div>
        <div className="admin-settings__field">
          <Label htmlFor="bank-name-local">Name in local script (optional)</Label>
          <Input
            id="bank-name-local"
            value={bankNameLocal}
            onChange={(e) => setBankNameLocal(e.target.value)}
            placeholder="e.g. यूको बैंक"
          />
        </div>
        <div className="admin-settings__field admin-settings__field--wide">
          <Label htmlFor="product-terms">Banking product terms (comma-separated)</Label>
          <Input
            id="product-terms"
            value={productTerms}
            onChange={(e) => setProductTerms(e.target.value)}
            placeholder="NEFT, RTGS, UPI, KYC, ..."
          />
        </div>
        <div className="admin-settings__field admin-settings__field--wide">
          <Label htmlFor="non-banking-terms">Non-banking / general support terms</Label>
          <Input
            id="non-banking-terms"
            value={nonBankingTerms}
            onChange={(e) => setNonBankingTerms(e.target.value)}
            placeholder="order, tracking, refund, warranty, ..."
          />
          <p className="admin-settings__field-hint">
            Used for e-commerce, telecom, and general call-center calls (not only banking).
          </p>
        </div>
      </div>

      <div className="admin-settings__subsection">
        <div className="admin-settings__subsection-head">
          <h4>Translation glossary (all languages)</h4>
          <p>Map source phrases to preferred English per language (Hindi, Bengali, Tamil, etc.).</p>
        </div>
        <div className="admin-settings__glossary-table admin-settings__glossary-table--wide">
          <div className="admin-settings__glossary-header">
            <span>Language</span>
            <span>Source phrase</span>
            <span>English translation</span>
            <span>Context</span>
            <span />
          </div>
          {glossary.map((row, index) => (
            <div key={`glossary-${index}`} className="admin-settings__glossary-row admin-settings__glossary-row--wide">
              <select
                className="ui-input"
                value={row.language}
                onChange={(e) => updateGlossary(index, 'language', e.target.value)}
              >
                {SUPPORTED_LANGUAGES.filter((l) => l !== 'Any').map((lang) => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
              <Input
                value={row.source}
                onChange={(e) => updateGlossary(index, 'source', e.target.value)}
                placeholder="खाता / order cancel"
              />
              <Input
                value={row.target}
                onChange={(e) => updateGlossary(index, 'target', e.target.value)}
                placeholder="account"
              />
              <Input
                value={row.note}
                onChange={(e) => updateGlossary(index, 'note', e.target.value)}
                placeholder="banking / non-banking"
              />
              <Button variant="secondary" size="sm" onClick={() => removeGlossaryRow(index)} title="Remove row">
                <LuTrash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={addGlossaryRow}>
          <LuPlus size={14} /> Add glossary term
        </Button>
      </div>

      <div className="admin-settings__subsection">
        <div className="admin-settings__subsection-head">
          <h4><LuShieldAlert size={16} style={{ verticalAlign: 'middle' }} /> Taboo / prohibited words</h4>
          <p>
            Phrases flagged in transcripts. Agent violations reduce Polite Tone, Protocol, and Overall score.
            Results show word, speaker, audio timestamp, and score impact.
          </p>
        </div>
        <div className="admin-settings__glossary-table admin-settings__glossary-table--taboo">
          <div className="admin-settings__glossary-header admin-settings__glossary-header--taboo">
            <span>Word / phrase</span>
            <span>Language</span>
            <span>Severity</span>
            <span>Applies to</span>
            <span>Category</span>
            <span />
          </div>
          {tabooWords.map((row, index) => (
            <div key={`taboo-${index}`} className="admin-settings__glossary-row admin-settings__glossary-row--taboo">
              <Input
                value={row.word}
                onChange={(e) => updateTaboo(index, 'word', e.target.value)}
                placeholder="guaranteed profit / पागल"
              />
              <select
                className="ui-input"
                value={row.language}
                onChange={(e) => updateTaboo(index, 'language', e.target.value)}
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
              <select
                className="ui-input"
                value={row.severity}
                onChange={(e) => updateTaboo(index, 'severity', e.target.value)}
              >
                <option value="low">Low (-5 overall)</option>
                <option value="medium">Medium (-10 overall)</option>
                <option value="high">High (-20 overall)</option>
              </select>
              <select
                className="ui-input"
                value={row.appliesTo}
                onChange={(e) => updateTaboo(index, 'appliesTo', e.target.value)}
              >
                <option value="agent">Agent only</option>
                <option value="customer">Customer only</option>
                <option value="both">Both</option>
              </select>
              <select
                className="ui-input"
                value={row.category}
                onChange={(e) => updateTaboo(index, 'category', e.target.value)}
              >
                <option value="rude">Rude / unprofessional</option>
                <option value="compliance">Compliance / mis-selling</option>
                <option value="policy">Policy violation</option>
              </select>
              <Button variant="secondary" size="sm" onClick={() => removeTabooRow(index)} title="Remove row">
                <LuTrash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={addTabooRow}>
          <LuPlus size={14} /> Add taboo word
        </Button>
      </div>

      {(updatedAt || updatedBy) && (
        <p className="admin-settings__field-hint">
          Last updated{updatedBy ? ` by ${updatedBy}` : ''}
          {updatedAt ? ` — ${new Date(updatedAt).toLocaleString()}` : ''}
        </p>
      )}

      <div className="admin-settings__actions">
        <Button variant="primary" onClick={saveConfig} disabled={saving || !bankName.trim()}>
          {saving ? <LuRefreshCw className="spin-icon" size={14} /> : <LuSave size={14} />}
          Save configuration
        </Button>
      </div>
    </section>
  );
}
