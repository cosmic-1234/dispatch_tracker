import React, { useState, useEffect } from 'react';
import { Download, Calendar, BarChart, FileSpreadsheet } from 'lucide-react';

export default function Reports({ API_BASE, systemDate }) {
  const [activeTab, setActiveTab] = useState('monthly');
  
  // Date filters (Default 30 days range)
  const getPastDateStr = (days) => {
    const d = new Date(systemDate);
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  };

  const [startDate, setStartDate] = useState(getPastDateStr(30));
  const [endDate, setEndDate] = useState(systemDate);
  
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReportData();
  }, [startDate, endDate]);

  const fetchReportData = () => {
    setLoading(true);
    fetch(`${API_BASE}/reports?start_date=${startDate}&end_date=${endDate}`)
      .then(res => res.json())
      .then(data => {
        setReportData(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  // Helper to convert JSON to CSV and download
  const downloadCSV = (title, headers, rows, mapper) => {
    if (!rows || rows.length === 0) {
      alert("No data available to export.");
      return;
    }

    const csvContent = [
      headers.join(','),
      ...rows.map(row => mapper(row).map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${title.toLowerCase().replace(/\s+/g, '_')}_${startDate}_to_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportCurrentReport = () => {
    if (!reportData) return;

    if (activeTab === 'monthly') {
      downloadCSV(
        "Monthly_Dispatch_Summary",
        ["Customer Company", "Product Portfolio", "Month Period", "Dispatched Qty (MT)", "Pending Balance (MT)"],
        reportData.monthly_summary,
        r => [r.company_name, r.product_type, r.month, r.total_dispatched_qty, r.pending_balance || 0]
      );
    } else if (activeTab === 'movement') {
      downloadCSV(
        "Inventory_Movement_Report",
        ["Date", "Product", "Opening Stock (MT)", "Production Added (MT)", "Purchased Material (MT)", "Dispatched Out (MT)", "Closing Stock (MT)", "Locked Status"],
        reportData.inventory_movement,
        r => [r.date, r.product_type, r.opening_stock, r.production_added, r.purchased_material_received, r.dispatched_out, r.closing_stock, r.confirmed === 1 ? 'Locked' : 'Draft']
      );
    } else if (activeTab === 'fulfillment') {
      downloadCSV(
        "PO_Fulfillment_Performance",
        ["Priority Customer Tier", "Total Placed Order Lines", "Fulfilled in 7 Days (%)", "Fulfilled in 14 Days (%)", "Fulfilled in 30 Days (%)"],
        reportData.fulfillment_rate,
        r => [r.tier, r.total_orders, `${r.rate_7d}%`, `${r.rate_14d}%`, `${r.rate_30d}%`]
      );
    } else if (activeTab === 'aivsactual') {
      downloadCSV(
        "AI_vs_Actual_Accuracy",
        ["Reporting Date", "Product", "AI Suggested dispatch (MT)", "Actual planner dispatched (MT)", "Variance Difference (MT)"],
        reportData.ai_vs_actual,
        r => [r.date, r.product_type, r.ai_recommended_qty, r.actual_dispatched_qty, r.actual_dispatched_qty - r.ai_recommended_qty]
      );
    }
  };

  return (
    <>
      {/* Date Filters Bar */}
      <div className="card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <Calendar size={16} color="#64748B" />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ margin: 0 }}>Start Date:</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ height: '32px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ margin: 0 }}>End Date:</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ height: '32px' }} />
            </div>
          </div>

          <button className="btn btn-secondary" onClick={exportCurrentReport} style={{ display: 'flex', gap: '6px' }} disabled={loading}>
            <Download size={14} />
            <span>Export to CSV Spreadsheet</span>
          </button>
        </div>
      </div>

      {/* Reports Module Wrapper */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div className="card-header" style={{ display: 'flex', padding: 0, borderBottom: '1px solid var(--border-color)', backgroundColor: '#F8FAFC' }}>
          <button 
            className={`chart-tab`} 
            style={{ border: 'none', borderRight: '1px solid var(--border-color)', borderRadius: 0, padding: '12px 20px', backgroundColor: activeTab === 'monthly' ? '#FFFFFF' : '#F8FAFC', fontWeight: activeTab === 'monthly' ? 600 : 500, color: activeTab === 'monthly' ? 'var(--primary-navy)' : 'var(--text-secondary)', cursor: 'pointer' }}
            onClick={() => setActiveTab('monthly')}
          >
            Monthly Dispatch Summary
          </button>
          <button 
            className={`chart-tab`} 
            style={{ border: 'none', borderRight: '1px solid var(--border-color)', borderRadius: 0, padding: '12px 20px', backgroundColor: activeTab === 'movement' ? '#FFFFFF' : '#F8FAFC', fontWeight: activeTab === 'movement' ? 600 : 500, color: activeTab === 'movement' ? 'var(--primary-navy)' : 'var(--text-secondary)', cursor: 'pointer' }}
            onClick={() => setActiveTab('movement')}
          >
            Inventory Movement
          </button>
          <button 
            className={`chart-tab`} 
            style={{ border: 'none', borderRight: '1px solid var(--border-color)', borderRadius: 0, padding: '12px 20px', backgroundColor: activeTab === 'fulfillment' ? '#FFFFFF' : '#F8FAFC', fontWeight: activeTab === 'fulfillment' ? 600 : 500, color: activeTab === 'fulfillment' ? 'var(--primary-navy)' : 'var(--text-secondary)', cursor: 'pointer' }}
            onClick={() => setActiveTab('fulfillment')}
          >
            PO Fulfillment Rate
          </button>
          <button 
            className={`chart-tab`} 
            style={{ border: 'none', borderRadius: 0, padding: '12px 20px', backgroundColor: activeTab === 'aivsactual' ? '#FFFFFF' : '#F8FAFC', fontWeight: activeTab === 'aivsactual' ? 600 : 500, color: activeTab === 'aivsactual' ? 'var(--primary-navy)' : 'var(--text-secondary)', cursor: 'pointer' }}
            onClick={() => setActiveTab('aivsactual')}
          >
            AI vs Actual Comparison
          </button>
        </div>

        <div className="card-body" style={{ flex: 1, padding: 0, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '30px' }}>Querying SCM reporting ledger...</div>
          ) : (
            <>
              {/* TAB 1: Monthly Summary */}
              {activeTab === 'monthly' && (
                <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                  <table className="sap-table">
                    <thead>
                      <tr>
                        <th>Customer Company</th>
                        <th>Product Portfolio</th>
                        <th>Month Period</th>
                        <th>Total Dispatched Qty (MT)</th>
                        <th>Pending Delivery Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.monthly_summary.map((r, i) => (
                        <tr key={i}>
                          <td><strong>{r.company_name}</strong></td>
                          <td>{r.product_type}</td>
                          <td className="mono">{r.month}</td>
                          <td className="mono" style={{ fontWeight: 600 }}>{r.total_dispatched_qty.toFixed(1)} MT</td>
                          <td className="mono" style={{ color: r.pending_balance > 0 ? '#1C6BF4' : 'inherit' }}>
                            {r.pending_balance ? `${r.pending_balance.toFixed(1)} MT` : '0.0 MT'}
                          </td>
                        </tr>
                      ))}
                      {reportData.monthly_summary.length === 0 && (
                        <tr><td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: '#64748B' }}>No dispatch summary logs found for range.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* TAB 2: Inventory Movement */}
              {activeTab === 'movement' && (
                <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                  <table className="sap-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Solvent Product</th>
                        <th>Opening Stock</th>
                        <th>Production Added</th>
                        <th>Purchased Material</th>
                        <th>Dispatched Out</th>
                        <th>Closing Stock</th>
                        <th>Confirmation Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.inventory_movement.map((r, i) => (
                        <tr key={i}>
                          <td className="mono">{r.date}</td>
                          <td><strong>{r.product_type}</strong></td>
                          <td className="mono">{r.opening_stock.toFixed(1)} MT</td>
                          <td className="mono">+{r.production_added.toFixed(1)} MT</td>
                          <td className="mono">+{r.purchased_material_received.toFixed(1)} MT</td>
                          <td className="mono">-{r.dispatched_out.toFixed(1)} MT</td>
                          <td className="mono" style={{ fontWeight: 600 }}>{r.closing_stock.toFixed(1)} MT</td>
                          <td>
                            <span className={`badge ${r.confirmed === 1 ? 'dispatched' : 'onhold'}`} style={{ fontSize: '9px' }}>
                              {r.confirmed === 1 ? 'Locked' : 'Draft'}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {reportData.inventory_movement.length === 0 && (
                        <tr><td colSpan="8" style={{ textAlign: 'center', padding: '20px', color: '#64748B' }}>No inventory logs found for range.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* TAB 3: PO Fulfillment Rate */}
              {activeTab === 'fulfillment' && (
                <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                  <table className="sap-table">
                    <thead>
                      <tr>
                        <th>Priority Customer Tier</th>
                        <th>Total Placed Order Lines</th>
                        <th>Fulfillment within 7 Days (%)</th>
                        <th>Fulfillment within 14 Days (%)</th>
                        <th>Fulfillment within 30 Days (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.fulfillment_rate.map((r, i) => (
                        <tr key={i}>
                          <td><span className={`tier-badge ${r.tier}`}>Tier {r.tier} Priority</span></td>
                          <td className="mono" style={{ fontWeight: 600 }}>{r.total_orders} line items</td>
                          <td className="mono" style={{ color: r.rate_7d > 75 ? 'green' : 'inherit' }}>{r.rate_7d}%</td>
                          <td className="mono">{r.rate_14d}%</td>
                          <td className="mono">{r.rate_30d}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* TAB 4: AI vs Actual */}
              {activeTab === 'aivsactual' && (
                <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
                  <table className="sap-table">
                    <thead>
                      <tr>
                        <th>Reporting Date</th>
                        <th>Solvent Product</th>
                        <th>AI Recommended Dispatch (MT)</th>
                        <th>Actual Planner Dispatched (MT)</th>
                        <th>Accuracy Variance (MT)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.ai_vs_actual.map((r, i) => {
                        const variance = r.actual_dispatched_qty - r.ai_recommended_qty;
                        return (
                          <tr key={i}>
                            <td className="mono">{r.date}</td>
                            <td><strong>{r.product_type}</strong></td>
                            <td className="mono">{r.ai_recommended_qty.toFixed(1)} MT</td>
                            <td className="mono" style={{ fontWeight: 600 }}>{r.actual_dispatched_qty.toFixed(1)} MT</td>
                            <td className="mono" style={{ color: Math.abs(variance) > 5 ? '#D97706' : 'inherit' }}>
                              {variance >= 0 ? '+' : ''}{variance.toFixed(1)} MT
                            </td>
                          </tr>
                        );
                      })}
                      {reportData.ai_vs_actual.length === 0 && (
                        <tr><td colSpan="5" style={{ textAlign: 'center', padding: '20px', color: '#64748B' }}>No AI variance analysis logs found for range.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
