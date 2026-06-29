import React, { useState, useEffect } from 'react';
import { 
  AlertTriangle, 
  ArrowRight, 
  TrendingUp, 
  Layers, 
  CheckCircle,
  Truck,
  Layers2
} from 'lucide-react';

export default function Dashboard({ data, loading, onNavigate, API_BASE }) {
  const [selectedProductChart, setSelectedProductChart] = useState('Acetone');
  
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px' }}>
        <div style={{ width: '20px', height: '20px', border: '3px solid #E2E8F0', borderTopColor: '#1C6BF4', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <span>Loading Operations Dashboard data...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!data) return <div>No dashboard data available.</div>;

  const {
    system_date,
    unconfirmed_snapshots_count,
    open_po_tier_counts,
    inventory_statuses,
    anomalous_pos,
    shortage_alerts,
    forward_projections
  } = data;

  // Render SVG Chart for forward projections
  const renderProjectionChart = (productType) => {
    const projection = forward_projections[productType];
    if (!projection || projection.length === 0) return null;

    const chartHeight = 160;
    const chartWidth = 500;
    const paddingLeft = 45;
    const paddingBottom = 25;
    const paddingTop = 15;
    const paddingRight = 15;

    const plotWidth = chartWidth - paddingLeft - paddingRight;
    const plotHeight = chartHeight - paddingTop - paddingBottom;

    // Find max value in projection to scale the chart
    const maxVal = Math.max(...projection.map(p => p.stock), 100);
    const minVal = 0;
    const valRange = maxVal - minVal;

    // Safety threshold
    const statusInfo = inventory_statuses.find(i => i.product_type === productType);
    const threshold = statusInfo ? statusInfo.threshold : 0.0;

    // Map points to SVG coordinates
    const points = projection.map((p, index) => {
      const x = paddingLeft + (index / 7) * plotWidth;
      const y = paddingTop + plotHeight - ((p.stock - minVal) / valRange) * plotHeight;
      return { x, y, val: p.stock, date: p.date };
    });

    const thresholdY = paddingTop + plotHeight - ((threshold - minVal) / valRange) * plotHeight;

    const pathData = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');

    return (
      <svg width="100%" height="200" viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
          const y = paddingTop + plotHeight * ratio;
          const val = (minVal + (1 - ratio) * valRange).toFixed(0);
          return (
            <g key={idx}>
              <line x1={paddingLeft} y1={y} x2={chartWidth - paddingRight} y2={y} stroke="#E2E8F0" strokeWidth="1" strokeDasharray="3 3" />
              <text x={paddingLeft - 8} y={y + 4} textAnchor="end" fontSize="9" fill="#64748B" fontFamily="monospace">{val} MT</text>
            </g>
          );
        })}

        {/* X axis labels */}
        {points.map((p, idx) => {
          return (
            <g key={idx}>
              <line x1={p.x} y1={paddingTop} x2={p.x} y2={paddingTop + plotHeight} stroke="#E2E8F0" strokeWidth="0.5" />
              <text x={p.x} y={paddingTop + plotHeight + 16} textAnchor="middle" fontSize="9" fill="#64748B">
                {idx === 0 ? 'Today' : `D+${idx}`}
              </text>
            </g>
          );
        })}

        {/* Threshold Safety Line */}
        {thresholdY >= paddingTop && thresholdY <= paddingTop + plotHeight && (
          <g>
            <line x1={paddingLeft} y1={thresholdY} x2={chartWidth - paddingRight} y2={thresholdY} stroke="#DC2626" strokeWidth="1.5" strokeDasharray="4 2" />
            <text x={chartWidth - paddingRight - 4} y={thresholdY - 4} textAnchor="end" fontSize="8" fill="#DC2626" fontWeight="bold">SAFETY LIMIT ({threshold} MT)</text>
          </g>
        )}

        {/* Main Line path */}
        <path d={pathData} fill="none" stroke="#1C6BF4" strokeWidth="2.5" />

        {/* Highlight points */}
        {points.map((p, idx) => (
          <g key={idx} className="chart-dot-group">
            <circle cx={p.x} cy={p.y} r="4" fill="#1C6BF4" stroke="#FFFFFF" strokeWidth="1.5" />
            <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="9" fill="#1C2B4A" fontWeight="600" fontFamily="monospace" className="chart-dot-text">{p.val}MT</text>
          </g>
        ))}
      </svg>
    );
  };

  return (
    <>
      {/* Active Alerts Bar */}
      {(unconfirmed_snapshots_count > 0 || shortage_alerts.length > 0 || anomalous_pos.length > 0) && (
        <div className="card" style={{ borderColor: '#FDE68A', backgroundColor: '#FFFDF5' }}>
          <div className="card-header" style={{ borderBottomColor: '#FEF3C7', padding: '10px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#B45309', fontWeight: 600, fontSize: '12px' }}>
              <AlertTriangle size={16} />
              <span>ACTIVE PLANNING ALERTS AND ANOMALIES ({unconfirmed_snapshots_count + shortage_alerts.length + anomalous_pos.length})</span>
            </div>
          </div>
          <div className="card-body" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {unconfirmed_snapshots_count > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                <span style={{ color: '#92400E' }}>⚠️ <strong>Reconciliation Pending:</strong> End-of-day snapshots are not confirmed. You must reconcile and confirm the day's dispatches.</span>
                <button className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: '11px' }} onClick={() => onNavigate('inventory')}>Reconcile Inventory</button>
              </div>
            )}
            
            {shortage_alerts.map((alert, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', borderTop: '1px solid #FEF3C7', paddingTop: '8px' }}>
                <span style={{ color: '#B91C1C' }}>
                  🚨 <strong>Critical Stockout Risk:</strong> projected closing stock for <strong>{alert.product_type}</strong> falls to <strong>{alert.projected_stock} MT</strong> on <strong>{alert.projected_date}</strong> (in {alert.days_out} days), breaching the safety threshold of {alert.min_threshold} MT. 
                  {alert.production_ratio_alert && ` Note: Production performance ratio is low (${(alert.production_ratio_alert * 100).toFixed(0)}%).`}
                </span>
                <button className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: '11px' }} onClick={() => onNavigate('dispatch')}>Adjust Allocations</button>
              </div>
            ))}

            {anomalous_pos.map((anomaly, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', borderTop: '1px solid #FEF3C7', paddingTop: '8px' }}>
                <span style={{ color: '#B45309' }}>
                  ⚠️ <strong>Anomalous Order Volume:</strong> PO <strong>{anomaly.po_id}</strong> (from {anomaly.company_name}) requests <strong>{anomaly.qty} MT</strong> of {anomaly.product_type}, exceeding 2× their 90-day average of {anomaly.avg_90day?.toFixed(1) || 0} MT.
                </span>
                <button className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: '11px' }} onClick={() => onNavigate('po')}>Inspect PO</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dashboard-grid">
        {/* A. Inventory Gauges Bar */}
        <div className="inventory-bar-container card">
          <div className="card-header">
            <span className="card-title">Current Safety Stock Levels</span>
            <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 500 }}>System Date: {system_date}</span>
          </div>
          <div className="card-body" style={{ padding: '12px' }}>
            <div className="inventory-bar-flex">
              {inventory_statuses.map(stat => (
                <div key={stat.product_type} className="inventory-gauge-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, fontSize: '12px' }}>{stat.product_type}</span>
                    <span className={`badge ${stat.status}`} style={{ fontSize: '9px', padding: '1px 4px' }}>
                      {stat.status === 'green' ? 'OK' : stat.status === 'amber' ? 'LOW' : 'CRIT'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'monospace' }}>{stat.stock.toFixed(1)} <span style={{ fontSize: '11px', fontWeight: 500, color: '#64748B' }}>MT</span></span>
                    <span style={{ fontSize: '10px', color: '#64748B' }}>Min. Safe: {stat.threshold} MT</span>
                  </div>
                  <div className="gauge-health-line">
                    <div 
                      className={`gauge-fill ${stat.status}`} 
                      style={{ width: `${Math.min(100, (stat.stock / (stat.threshold * 2)) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* B. Metrics and PO Tiers counts */}
        <div className="stat-row">
          <div className="stat-card">
            <div>
              <span className="card-title" style={{ fontSize: '10px' }}>Tier A Pending POs</span>
              <div className="stat-val" style={{ color: '#065F46' }}>{open_po_tier_counts.A}</div>
            </div>
            <span style={{ fontSize: '11px', color: '#065F46', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} onClick={() => onNavigate('po')}>
              View Priority Queue <ArrowRight size={12} />
            </span>
          </div>

          <div className="stat-card">
            <div>
              <span className="card-title" style={{ fontSize: '10px' }}>Tier B Pending POs</span>
              <div className="stat-val" style={{ color: '#1E3A8A' }}>{open_po_tier_counts.B}</div>
            </div>
            <span style={{ fontSize: '11px', color: '#1E3A8A', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} onClick={() => onNavigate('po')}>
              View Queue <ArrowRight size={12} />
            </span>
          </div>

          <div className="stat-card">
            <div>
              <span className="card-title" style={{ fontSize: '10px' }}>Tier C Pending POs</span>
              <div className="stat-val" style={{ color: '#374151' }}>{open_po_tier_counts.C}</div>
            </div>
            <span style={{ fontSize: '11px', color: '#374151', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} onClick={() => onNavigate('po')}>
              View Queue <ArrowRight size={12} />
            </span>
          </div>

          <div className="stat-card" style={{ borderLeft: '4px solid #1C6BF4' }}>
            <div>
              <span className="card-title" style={{ fontSize: '10px' }}>EOD Status Confirm</span>
              <div className="stat-val" style={{ fontSize: '18px', display: 'flex', alignItems: 'center', gap: '6px', color: unconfirmed_snapshots_count === 0 ? '#16A34A' : '#D97706', marginTop: '6px' }}>
                {unconfirmed_snapshots_count === 0 ? (
                  <>
                    <CheckCircle size={18} />
                    <span>Confirmed</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={18} />
                    <span>Pending Locking</span>
                  </>
                )}
              </div>
            </div>
            <span style={{ fontSize: '11px', color: '#1C6BF4', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} onClick={() => onNavigate('inventory')}>
              Go to Snapshots <ArrowRight size={12} />
            </span>
          </div>
        </div>

        {/* C. SVG Chart For 7-Day projections */}
        <div className="card chart-card">
          <div className="card-header">
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <TrendingUp size={16} color="#1C6BF4" />
              7-Day Forward Inventory Projections
            </span>
            <div className="chart-selector">
              {['Acetone', 'Benzene', 'DEP', 'Ethyl Acetate', 'Retarder', 'Toluene'].map(prod => (
                <div 
                  key={prod} 
                  className={`chart-tab ${selectedProductChart === prod ? 'active' : ''}`}
                  onClick={() => setSelectedProductChart(prod)}
                >
                  {prod}
                </div>
              ))}
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
              <div style={{ flex: 1.8 }}>
                {renderProjectionChart(selectedProductChart)}
              </div>
              <div style={{ flex: 1.2, backgroundColor: '#FAFBFD', border: '1px solid #E2E8F0', padding: '16px', borderRadius: '4px', fontSize: '13px' }}>
                <h4 style={{ fontWeight: 600, color: 'var(--primary-navy)', marginBottom: '10px', textTransform: 'uppercase', fontSize: '12px' }}>Projection Engine Details</h4>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  Forward stock balances are projected based on:
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px', fontFamily: 'monospace' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Opening Level:</span>
                    <strong>{inventory_statuses.find(i => i.product_type === selectedProductChart)?.stock.toFixed(1)} MT</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Est. Daily Prod:</span>
                    <strong>+{( (data.forward_projections[selectedProductChart]?.[1]?.stock - data.forward_projections[selectedProductChart]?.[0]?.stock + (data.forward_projections[selectedProductChart]?.[0]?.demand || 0)) || 10 ).toFixed(1)} MT/d</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Daily Safety Level:</span>
                    <strong style={{ color: '#DC2626' }}>{inventory_statuses.find(i => i.product_type === selectedProductChart)?.threshold} MT</strong>
                  </div>
                </div>
                <div style={{ marginTop: '12px', borderTop: '1px solid #E2E8F0', paddingTop: '10px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                  💡 Projections are automatically scaled down if production history variance shows underperformance.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* D. Today's AI Dispatch Recommendations */}
        <div className="card" style={{ gridColumn: 'span 12' }}>
          <div className="card-header">
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Truck size={16} color="#1C6BF4" />
              Automated Dispatch Plan Action Panel (Today)
            </span>
            <button className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => onNavigate('dispatch')}>
              Go to Planning Board
            </button>
          </div>
          <div className="card-body" style={{ padding: '0' }}>
            <div className="table-wrapper" style={{ border: 'none', borderRadius: '0' }}>
              <table className="sap-table">
                <thead>
                  <tr>
                    <th>PO ID</th>
                    <th>Customer</th>
                    <th>Tier</th>
                    <th>Product</th>
                    <th>Order Age</th>
                    <th>Pending Qty (MT)</th>
                    <th>AI Priority Score</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.actionable_po_pool && data.actionable_po_pool.slice(0, 5).map(po => (
                    <tr key={`${po.po_id}-${po.product_type}`}>
                      <td className="mono">{po.po_id}</td>
                      <td>{po.company_name}</td>
                      <td><span className={`tier-badge ${po.company_tier}`}>{po.company_tier}</span></td>
                      <td>{po.product_type}</td>
                      <td>{po.order_age_days} days</td>
                      <td className="mono">{po.pending_quantity} MT</td>
                      <td>
                        <span className="badge" style={{ backgroundColor: po.score >= 100 ? '#D1FAE5' : po.score >= 60 ? '#DBEAFE' : '#F3F4F6', color: po.score >= 100 ? '#065F46' : po.score >= 60 ? '#1E3A8A' : '#374151', fontWeight: 700 }}>
                          {po.score} pts
                        </span>
                      </td>
                      <td><span className={`badge ${po.status.toLowerCase()}`}>{po.status}</span></td>
                    </tr>
                  ))}
                  {(!data.actionable_po_pool || data.actionable_po_pool.length === 0) && (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', padding: '16px', color: '#64748B' }}>No pending orders requiring dispatch.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
