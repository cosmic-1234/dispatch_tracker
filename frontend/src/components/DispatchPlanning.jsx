import React, { useState, useEffect } from 'react';
import { Truck, Check, RefreshCw, AlertTriangle, AlertCircle, Info, ShieldAlert } from 'lucide-react';

export default function DispatchPlanning({ API_BASE, systemDate, triggerRefresh }) {
  const [optimizerData, setOptimizerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Editable state for active recommendations (runs)
  const [editableRuns, setEditableRuns] = useState([]);
  const [remainingStocks, setRemainingStocks] = useState({});

  // Credit Hold Override state
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideReasons, setOverrideReasons] = useState({}); // poId -> reason text
  const [overrideError, setOverrideError] = useState('');

  // Fetch optimizer results
  useEffect(() => {
    fetchOptimizerData();
  }, []);

  const fetchOptimizerData = () => {
    setLoading(true);
    fetch(`${API_BASE}/optimizer`)
      .then(res => res.json())
      .then(data => {
        setOptimizerData(data);
        setEditableRuns(data.recommended_runs || []);
        setRemainingStocks(data.remaining_stocks || {});
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  // Re-calculate remaining stock when allocations change
  const recalculateRemainingStock = (updatedRuns) => {
    const originalStocks = { ...optimizerData.inventory_stocks };
    
    // Deduct quantities allocated in updatedRuns
    updatedRuns.forEach(run => {
      let totalRunQty = 0;
      run.allocations.forEach(alloc => {
        originalStocks[run.product_type] -= alloc.quantity;
        totalRunQty += alloc.quantity;
      });
      run.total_quantity = totalRunQty;
    });

    setRemainingStocks(originalStocks);
  };

  const handleUpdateAllocationQty = (runIndex, allocIndex, val) => {
    const updated = JSON.parse(JSON.stringify(editableRuns));
    const qty = parseFloat(val);
    if (isNaN(qty) || qty < 0) return;

    updated[runIndex].allocations[allocIndex].quantity = qty;
    
    // Remove if quantity set to 0
    updated[runIndex].allocations = updated[runIndex].allocations.filter(a => a.quantity > 0);
    
    // Remove run if no allocations left
    const runsFiltered = updated.filter(r => r.allocations.length > 0);

    setEditableRuns(runsFiltered);
    recalculateRemainingStock(runsFiltered);
  };

  const handleRemoveAllocation = (runIndex, allocIndex) => {
    const updated = JSON.parse(JSON.stringify(editableRuns));
    updated[runIndex].allocations.splice(allocIndex, 1);
    
    // Filter empty runs
    const runsFiltered = updated.filter(r => r.allocations.length > 0);

    setEditableRuns(runsFiltered);
    recalculateRemainingStock(runsFiltered);
  };

  // Check if any allocation belongs to a company on Credit Hold
  const getOnHoldAllocations = () => {
    const list = [];
    editableRuns.forEach(run => {
      run.allocations.forEach(alloc => {
        // Find PO in the pool to check credit_status
        const poolItem = optimizerData.actionable_po_pool.find(p => p.po_id === alloc.po_id);
        if (poolItem && poolItem.credit_status === 'On Hold') {
          list.push({
            po_id: alloc.po_id,
            company_id: alloc.company_id,
            company_name: alloc.company_name,
            product_type: run.product_type,
            quantity: alloc.quantity
          });
        }
      });
    });
    return list;
  };

  const handleAcceptPlanClick = () => {
    const onHoldAllocs = getOnHoldAllocations();
    if (onHoldAllocs.length > 0) {
      // Prompt for override reasons
      setOverrideError('');
      const initialReasons = {};
      onHoldAllocs.forEach(a => {
        initialReasons[a.po_id] = '';
      });
      setOverrideReasons(initialReasons);
      setShowOverrideModal(true);
    } else {
      submitPlan([]);
    }
  };

  const handleOverrideSubmit = (e) => {
    e.preventDefault();
    setOverrideError('');

    const onHoldAllocs = getOnHoldAllocations();
    const overrides = [];

    for (const alloc of onHoldAllocs) {
      const reason = overrideReasons[alloc.po_id];
      if (!reason || !reason.trim()) {
        setOverrideError(`Please enter a manager's override authorization reason for ${alloc.company_name}.`);
        return;
      }
      overrides.push({
        company_id: alloc.company_id,
        po_id: alloc.po_id,
        reason: reason.trim()
      });
    }

    setShowOverrideModal(false);
    submitPlan(overrides);
  };

  const submitPlan = (overrides) => {
    setSaving(true);
    fetch(`${API_BASE}/optimizer/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runs: editableRuns,
        override_logs: overrides,
        created_by: 'Logistics Planner'
      })
    })
      .then(res => res.json())
      .then(data => {
        setSaving(false);
        if (data.error) {
          alert(`Error saving dispatch plan: ${data.error}`);
        } else {
          // Success
          fetchOptimizerData();
          triggerRefresh();
          alert('AI Dispatch Plan accepted. Scheduled planned runs created successfully.');
        }
      })
      .catch(err => {
        console.error(err);
        setSaving(false);
        alert('Network connection error.');
      });
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px' }}>
        <div style={{ width: '20px', height: '20px', border: '3px solid #E2E8F0', borderTopColor: '#1C6BF4', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <span>Synthesizing inventory snapshots and running prioritizer...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      <div className="split-pane">
        
        {/* LEFT PANE: Today's Actionable PO Pool */}
        <div className="pane-left card">
          <div className="card-header">
            <span className="card-title">Actionable PO Pool ({optimizerData.actionable_po_pool.length} items)</span>
            <span className="badge received" style={{ fontSize: '10px' }}>Unallocated / Pending</span>
          </div>
          <div className="card-body" style={{ padding: '0', overflowY: 'auto' }}>
            <div className="table-wrapper" style={{ border: 'none', borderRadius: '0' }}>
              <table className="sap-table">
                <thead>
                  <tr>
                    <th>Score</th>
                    <th>PO ID</th>
                    <th>Customer</th>
                    <th>Product</th>
                    <th>Age</th>
                    <th>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {optimizerData.actionable_po_pool.map(item => {
                    const isCreditHold = item.credit_status === 'On Hold';
                    return (
                      <tr key={`${item.id}-${item.product_type}`} style={{ opacity: isCreditHold ? 0.6 : 1 }}>
                        <td>
                          <span className="score-cell badge" style={{ backgroundColor: item.score >= 100 ? '#D1FAE5' : item.score >= 60 ? '#DBEAFE' : '#F3F4F6', color: item.score >= 100 ? '#065F46' : item.score >= 60 ? '#1E3A8A' : '#374151' }}>
                            {item.score}
                            <span className="score-tooltip">
                              <div style={{ fontWeight: 'bold', marginBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: '4px' }}>AI Prioritization Score Details</div>
                              <div className="tooltip-row"><span>Base (Tier {item.company_tier}):</span> <span>+{item.base_points} pts</span></div>
                              <div className="tooltip-row"><span>Age ({item.order_age_days}d × 2):</span> <span>+{item.age_points} pts</span></div>
                              <div className="tooltip-row"><span>Stock Deficit Check:</span> <span>{item.stock_penalty} pts</span></div>
                              <div className="tooltip-row total"><span>Final Priority Score:</span> <span>{item.score} pts</span></div>
                            </span>
                          </span>
                        </td>
                        <td className="mono">{item.po_id}</td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span>{item.company_name}</span>
                            {isCreditHold && (
                              <span className="badge onhold" style={{ fontSize: '8px', padding: '0 3px', width: 'fit-content' }}>On Credit Hold</span>
                            )}
                          </div>
                        </td>
                        <td><strong>{item.product_type}</strong></td>
                        <td>{item.order_age_days}d</td>
                        <td className="mono" style={{ fontWeight: 600 }}>{item.pending_quantity} MT</td>
                      </tr>
                    );
                  })}
                  {optimizerData.actionable_po_pool.length === 0 && (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>No unallocated PO lines found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* RIGHT PANE: AI-Recommended Dispatch Runs */}
        <div className="pane-right card">
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Truck size={16} color="#1C6BF4" />
              Proposed Consolidation Runs
            </span>
            <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={fetchOptimizerData}>
              <RefreshCw size={12} style={{ marginRight: '4px' }} />
              Reset Runs
            </button>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
            
            {/* Projected Stock Remainder */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', backgroundColor: '#FAFBFD', padding: '10px 14px', borderRadius: '4px', border: '1px solid #E2E8F0' }}>
              <div style={{ width: '100%', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px' }}>Projected Remaining Stock After Plan Exec:</div>
              {Object.entries(remainingStocks).map(([prod, stock]) => {
                const isWarning = stock < 10; // generic threshold check
                return (
                  <div key={prod} style={{ display: 'flex', gap: '6px', fontSize: '11px', borderRight: '1px solid #E2E8F0', paddingRight: '10px' }}>
                    <span>{prod}:</span>
                    <strong style={{ color: isWarning ? '#DC2626' : '#16A34A', fontFamily: 'monospace' }}>{stock.toFixed(0)} MT</strong>
                  </div>
                );
              })}
            </div>

            {/* Run Items list */}
            {editableRuns.map((run, runIdx) => (
              <div key={run.run_id} style={{ border: '1px solid #E2E8F0', borderRadius: '4px', background: '#FFFFFF' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="badge planned" style={{ fontSize: '10px', fontWeight: 'bold' }}>{run.run_id}</span>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>Product: <strong>{run.product_type}</strong></span>
                  </div>
                  <div style={{ fontSize: '12px' }}>
                    Consolidated Weight: <strong className="mono" style={{ color: run.total_quantity > 32 ? '#B45309' : '#16A34A' }}>{run.total_quantity.toFixed(1)} MT</strong> / 32 MT
                  </div>
                </div>

                <div className="table-wrapper" style={{ border: 'none', borderRadius: '0' }}>
                  <table className="sap-table">
                    <thead>
                      <tr>
                        <th>PO ID</th>
                        <th>Customer</th>
                        <th>Qty (MT)</th>
                        <th style={{ textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.allocations.map((alloc, allocIdx) => {
                        // Check if PO company is on credit hold to alert planner
                        const poolItem = optimizerData.actionable_po_pool.find(p => p.po_id === alloc.po_id);
                        const hasCreditWarning = poolItem?.credit_status === 'On Hold';
                        
                        return (
                          <tr key={`${alloc.po_id}-${allocIdx}`}>
                            <td className="mono">{alloc.po_id}</td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span>{alloc.company_name}</span>
                                {hasCreditWarning && (
                                  <span style={{ fontSize: '8px', color: '#DC2626', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '2px' }}>
                                    <ShieldAlert size={10} /> CREDIT HOLD - OVERRIDE REQUIRED
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              <input 
                                type="number" 
                                step="0.1" 
                                value={alloc.quantity}
                                onChange={(e) => handleUpdateAllocationQty(runIdx, allocIdx, e.target.value)}
                                style={{ width: '80px', padding: '3px 6px', fontSize: '12px', fontFamily: 'monospace' }}
                              />
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button className="btn btn-secondary" style={{ padding: '3px 6px', fontSize: '10px', color: '#EF4444', borderColor: '#FCA5A5' }} onClick={() => handleRemoveAllocation(runIdx, allocIdx)}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {editableRuns.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px', color: '#64748B' }}>
                <AlertCircle size={24} style={{ margin: '0 auto 8px auto', opacity: 0.6 }} />
                <span>No consolidation runs active. Adjust safety thresholds or receive new POs.</span>
              </div>
            )}

            {editableRuns.length > 0 && (
              <button className="btn btn-primary" style={{ marginTop: '10px', width: '100%', height: '42px' }} disabled={saving} onClick={handleAcceptPlanClick}>
                <Check size={16} />
                <span>Accept & Commit AI Dispatch Plan ({editableRuns.length} Runs)</span>
              </button>
            )}

          </div>
        </div>
      </div>

      {/* Credit Hold Override Modal */}
      {showOverrideModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div className="modal-header" style={{ backgroundColor: '#FFFBEB', borderBottomColor: '#FDE68A' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#B45309' }}>
                <ShieldAlert size={18} />
                <h3>Credit Hold Override Authorization</h3>
              </div>
            </div>
            <form onSubmit={handleOverrideSubmit}>
              <div className="modal-body">
                {overrideError && (
                  <div style={{ backgroundColor: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '10px', fontSize: '12px', borderRadius: '4px', marginBottom: '16px' }}>
                    {overrideError}
                  </div>
                )}
                
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  The following allocations target customer companies currently flagged on **Credit Hold**. Allocating inventory to these clients requires explicitly logging a manager override reason.
                </p>

                {getOnHoldAllocations().map(alloc => (
                  <div key={alloc.po_id} style={{ border: '1px solid #E2E8F0', padding: '12px', borderRadius: '4px', marginBottom: '12px', backgroundColor: '#F8FAFC' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
                      <strong>{alloc.company_name}</strong>
                      <span className="badge onhold">Credit Hold</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                      Order: {alloc.po_id} | Product: {alloc.product_type} | Qty: {alloc.quantity} MT
                    </div>
                    <div className="form-group">
                      <label>Manager Override Reason <span className="required-star">*</span></label>
                      <input 
                        type="text" 
                        placeholder="e.g. Approved by CFO / Bank Guarantee received"
                        value={overrideReasons[alloc.po_id] || ''}
                        onChange={(e) => setOverrideReasons({ ...overrideReasons, [alloc.po_id]: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowOverrideModal(false)}>Cancel Plan</button>
                <button type="submit" className="btn btn-primary" style={{ backgroundColor: '#D97706' }}>Authorize & Commit</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
