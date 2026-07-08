import React, { useState, useEffect } from 'react';
import { HeartPulse, AlertTriangle, CheckCircle2, Clock, RefreshCw, Minus, ChevronDown, ChevronUp } from 'lucide-react';

const STATUS_COLORS = {
  Honored: { bg: '#D1FAE5', color: '#065F46', border: '#A7F3D0' },
  Missed:  { bg: '#FEE2E2', color: '#991B1B', border: '#FECACA' },
  Renegotiated: { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
  Pending: { bg: '#EFF6FF', color: '#1E40AF', border: '#BFDBFE' },
};

function HealthScore({ score }) {
  if (score === null || score === undefined) return <span style={{ color: '#94A3B8', fontSize: '11px' }}>N/A</span>;
  const pct = Math.round(score);
  const color = pct >= 80 ? '#10B981' : pct >= 60 ? '#F59E0B' : '#EF4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '80px', height: '6px', borderRadius: '3px', background: '#E2E8F0', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ fontSize: '11px', fontWeight: 600, color }}>{pct}%</span>
    </div>
  );
}

function StatusChip({ status }) {
  const s = STATUS_COLORS[status] || { bg: '#F1F5F9', color: '#64748B', border: '#CBD5E1' };
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', color: '#64748B', gap: '8px' }}>
      <RefreshCw size={16} style={{ animation: 'spin 1.5s linear infinite' }} /> Loading commitment health data...
    </div>
  );

  if (error) return (
    <div style={{ padding: '24px', color: '#EF4444' }}>
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
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#1E293B' }}>Commitment Health Dashboard</h2>
          <span style={{ fontSize: '11px', color: '#64748B', background: '#F1F5F9', border: '1px solid #E2E8F0', borderRadius: '4px', padding: '2px 8px' }}>
            SCM Date: {data?.system_date || systemDate}
          </span>
        </div>
        <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={loadData}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {[
          { label: 'At-Risk Companies', value: riskCompanies.length, color: '#EF4444', bg: '#FEF2F2' },
          { label: 'Missed POs', value: data?.missed_pos?.length || 0, color: '#F59E0B', bg: '#FFFBEB' },
          { label: 'Total Commitments Tracked', value: (data?.companies || []).reduce((s, c) => s + (parseInt(c.total_commitments) || 0), 0), color: '#3B82F6', bg: '#EFF6FF' },
          { label: 'Total Companies', value: (data?.companies || []).length, color: '#10B981', bg: '#F0FDF4' },
        ].map(kpi => (
          <div key={kpi.label} style={{ background: kpi.bg, border: `1px solid ${kpi.color}22`, borderRadius: '8px', padding: '16px' }}>
            <div style={{ fontSize: '24px', fontWeight: 800, color: kpi.color }}>{kpi.value}</div>
            <div style={{ fontSize: '11px', color: '#64748B', marginTop: '4px', fontWeight: 500 }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* At-Risk Companies Section */}
      {riskCompanies.length > 0 && (
        <div style={{ background: '#FFF5F5', border: '1px solid #FECACA', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ background: '#FEE2E2', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #FECACA' }}>
            <AlertTriangle size={14} color="#DC2626" />
            <span style={{ fontWeight: 700, fontSize: '12px', color: '#991B1B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Relationship Risk — {riskCompanies.length} Company(s) Flagged
            </span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#FEF2F2' }}>
                {['Company', 'Tier', 'Health Score', 'Total', 'Honored', 'Missed', 'Renegotiated', 'Pending'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#7F1D1D', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #FECACA' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {riskCompanies.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #FEE2E2' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: '#1E293B' }}>{c.name}</td>
                  <td style={{ padding: '10px 12px' }}><span style={{ fontWeight: 700, color: c.tier === 'A' ? '#059669' : c.tier === 'B' ? '#2563EB' : '#64748B' }}>{c.tier}</span></td>
                  <td style={{ padding: '10px 12px' }}><HealthScore score={c.commitment_health_score} /></td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>{c.total_commitments || 0}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', color: '#059669', fontWeight: 600 }}>{c.honored || 0}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', color: '#DC2626', fontWeight: 700 }}>{c.missed || 0}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', color: '#D97706', fontWeight: 600 }}>{c.renegotiated || 0}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', color: '#3B82F6', fontWeight: 600 }}>{c.pending || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Missed POs Table */}
      {data?.missed_pos?.length > 0 && (
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertTriangle size={13} color="#EF4444" />
            <span style={{ fontWeight: 700, fontSize: '12px', color: '#1E293B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Overdue Commitments — Open POs</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['PO ID', 'Company', 'Tier', 'Committed Date', 'Status', 'Health Score'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.missed_pos.map(po => (
                <tr key={po.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 600, color: '#1E293B' }}>{po.id}</td>
                  <td style={{ padding: '10px 12px', color: '#334155' }}>{po.company_name}</td>
                  <td style={{ padding: '10px 12px' }}><span style={{ fontWeight: 700, color: po.tier === 'A' ? '#059669' : po.tier === 'B' ? '#2563EB' : '#64748B' }}>{po.tier}</span></td>
                  <td style={{ padding: '10px 12px', color: '#EF4444', fontWeight: 600 }}>{po.committed_dispatch_date}</td>
                  <td style={{ padding: '10px 12px' }}><StatusChip status={po.commitment_status} /></td>
                  <td style={{ padding: '10px 12px' }}><HealthScore score={po.commitment_health_score} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* All Companies Table */}
      <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: '8px', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
          <span style={{ fontWeight: 700, fontSize: '12px', color: '#1E293B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>All Companies — Commitment Overview</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['Company', 'Tier', 'Health Score', 'Risk', 'Total', 'Honored', 'Missed', 'Renegotiated', 'Pending'].map(h => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#475569', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.companies || []).map(c => (
              <tr key={c.id} style={{ borderBottom: '1px solid #F1F5F9', background: c.relationship_risk_flag ? '#FFFBEB' : 'white' }}>
                <td style={{ padding: '10px 12px', fontWeight: 600, color: '#1E293B' }}>{c.name}</td>
                <td style={{ padding: '10px 12px' }}><span style={{ fontWeight: 700, color: c.tier === 'A' ? '#059669' : c.tier === 'B' ? '#2563EB' : '#64748B' }}>{c.tier}</span></td>
                <td style={{ padding: '10px 12px' }}><HealthScore score={c.commitment_health_score} /></td>
                <td style={{ padding: '10px 12px' }}>
                  {c.relationship_risk_flag
                    ? <span style={{ color: '#DC2626', fontWeight: 700, fontSize: '10px' }}>⚠ AT RISK</span>
                    : <span style={{ color: '#10B981', fontSize: '10px' }}>✓ OK</span>}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center' }}>{c.total_commitments || 0}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#059669', fontWeight: 600 }}>{c.honored || 0}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#DC2626', fontWeight: 700 }}>{c.missed || 0}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#D97706', fontWeight: 600 }}>{c.renegotiated || 0}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', color: '#3B82F6', fontWeight: 600 }}>{c.pending || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
