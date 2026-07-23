import React, { useState, useEffect } from 'react';
import { HeartPulse, AlertTriangle, CheckCircle2, Clock, RefreshCw, Minus, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDate } from '../App';

// ... (other components)


const STATUS_COLORS = {
  Honored: { bg: 'var(--success-bg)', color: 'var(--success)', border: 'var(--success-border)' },
  Missed:  { bg: 'var(--danger-bg)', color: 'var(--danger)', border: 'var(--danger-border)' },
  Renegotiated: { bg: 'var(--warning-bg)', color: 'var(--warning)', border: 'var(--warning-border)' },
  Pending: { bg: 'var(--info-bg)', color: 'var(--info)', border: 'var(--info-border)' },
};

function HealthScore({ score }) {
  if (score === null || score === undefined) return <span style={{ color: 'var(--text-disabled)', fontSize: '11px' }}>N/A</span>;
  const pct = Math.round(score);
  const color = pct >= 80 ? 'var(--success)' : pct >= 60 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '80px', height: '6px', borderRadius: '3px', background: 'var(--border-color)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: '11px', fontWeight: 600, color }}>{pct}%</span>
    </div>
  );
}

function StatusChip({ status }) {
  const s = STATUS_COLORS[status] || { bg: 'var(--bg-subtle)', color: 'var(--text-muted)', border: 'var(--border-strong)' };
  return (
    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {status}
    </span>
  );
}

export default function CommitmentHealth({ API_BASE, systemDate, onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedCompany, setExpandedCompany] = useState(null);

  const loadData = () => {
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/commitment-health`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  };

  useEffect(() => { loadData(); }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', color: 'var(--text-muted)', gap: '8px' }}>
      <RefreshCw size={16} style={{ animation: 'spin 1.5s linear infinite' }} /> Loading commitment health data...
    </div>
  );

  if (error) return (
    <div style={{ padding: '24px', color: 'var(--danger)' }}>
      <AlertTriangle size={14} style={{ marginRight: '6px' }} /> {error}
    </div>
  );

  const riskCompanies = (data?.companies || []).filter(c => c.relationship_risk_flag === 1);
  const healthyCompanies = (data?.companies || []).filter(c => c.relationship_risk_flag !== 1);

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <HeartPulse size={20} color="#EF4444" />
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>Commitment Health Dashboard</h2>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-subtle)', border: '1px solid #E2E8F0', borderRadius: '4px', padding: '2px 8px' }}>
            SCM Date: {formatDate(data?.system_date || systemDate)}
          </span>
        </div>
        <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={loadData}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {[
          { label: 'At-Risk Companies', value: riskCompanies.length, color: 'var(--danger)', bg: 'var(--danger-bg)' },
          { label: 'Missed POs', value: data?.missed_pos?.length || 0, color: 'var(--warning)', bg: 'var(--warning-bg)' },
          { label: 'Total Commitments Tracked', value: (data?.companies || []).reduce((s, c) => s + (parseInt(c.total_commitments) || 0), 0), color: 'var(--info)', bg: 'var(--info-bg)' },
          { label: 'Total Companies', value: (data?.companies || []).length, color: 'var(--success)', bg: 'var(--success-bg)' },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: kpi.bg, border: `1px solid ${kpi.color}22`, borderRadius: '8px', padding: '16px' }}>
            <div style={{ fontSize: '24px', fontWeight: 800, color: kpi.color }}>{kpi.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 500 }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* At-Risk Companies Section */}
      {riskCompanies.length > 0 && (
        <div className="card card-table-container" style={{ display: 'flex', flexDirection: 'column', borderLeft: '4px solid #DC2626' }}>
          <div className="card-header" style={{ background: 'var(--danger-bg)', borderBottomColor: 'var(--danger-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={14} color="#DC2626" />
              <span className="card-title" style={{ color: 'var(--danger)' }}>
                Relationship Risk — {riskCompanies.length} Company(s) Flagged
              </span>
            </div>
          </div>
          <table className="sap-table">
            <thead>
              <tr>
                {['Company', 'Tier', 'Health Score', 'Total', 'Honored', 'Missed', 'Renegotiated', 'Pending'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {riskCompanies.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td><span className={`tier-badge ${c.tier}`}>{c.tier}</span></td>
                  <td><HealthScore score={c.commitment_health_score} /></td>
                  <td className="mono">{c.total_commitments || 0}</td>
                  <td className="mono" style={{ color: 'var(--success)', fontWeight: 600 }}>{c.honored || 0}</td>
                  <td className="mono" style={{ color: 'var(--danger)', fontWeight: 700 }}>{c.missed || 0}</td>
                  <td className="mono" style={{ color: 'var(--warning)', fontWeight: 600 }}>{c.renegotiated || 0}</td>
                  <td className="mono" style={{ color: 'var(--primary-blue)', fontWeight: 600 }}>{c.pending || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Missed POs Table */}
      {data?.missed_pos?.length > 0 && (
        <div className="card card-table-container" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-header" style={{ background: 'var(--bg-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlertTriangle size={13} color="#EF4444" />
              <span className="card-title">Overdue Commitments — Open POs</span>
            </div>
          </div>
          <table className="sap-table">
            <thead>
              <tr>
                {['PO ID', 'Company', 'Tier', 'Committed Date', 'Status', 'Health Score'].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.missed_pos.map(po => (
                <tr key={po.id}>
                  <td className="mono" style={{ fontWeight: 600, textAlign: 'left' }}>{po.id}</td>
                  <td>{po.company_name}</td>
                  <td><span className={`tier-badge ${po.tier}`}>{po.tier}</span></td>
                  <td className="mono" style={{ color: 'var(--danger)', fontWeight: 600, textAlign: 'left' }}>{formatDate(po.committed_dispatch_date)}</td>
                  <td><StatusChip status={po.commitment_status} /></td>
                  <td><HealthScore score={po.commitment_health_score} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* All Companies Table */}
      <div className="card card-table-container" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="card-header" style={{ background: 'var(--bg-subtle)' }}>
          <span className="card-title">All Companies — Commitment Overview</span>
        </div>
        <table className="sap-table">
          <thead>
            <tr>
              {['Company', 'Tier', 'Health Score', 'Risk', 'Total', 'Honored', 'Missed', 'Renegotiated', 'Pending'].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.companies || []).map(c => (
              <tr key={c.id} className={c.relationship_risk_flag ? 'relationship-risk-row' : ''}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td><span className={`tier-badge ${c.tier}`}>{c.tier}</span></td>
                <td><HealthScore score={c.commitment_health_score} /></td>
                <td>
                  {c.relationship_risk_flag
                    ? <span className="badge cancelled" style={{ fontSize: '10px' }}>⚠ AT RISK</span>
                    : <span className="badge dispatched" style={{ fontSize: '10px' }}>✓ OK</span>}
                </td>
                <td className="mono">{c.total_commitments || 0}</td>
                <td className="mono" style={{ color: 'var(--success)', fontWeight: 600 }}>{c.honored || 0}</td>
                <td className="mono" style={{ color: 'var(--danger)', fontWeight: 700 }}>{c.missed || 0}</td>
                <td className="mono" style={{ color: 'var(--warning)', fontWeight: 600 }}>{c.renegotiated || 0}</td>
                <td className="mono" style={{ color: 'var(--primary-blue)', fontWeight: 600 }}>{c.pending || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
