import React, { useState, useEffect, useRef } from 'react';
import { Truck, Check, RefreshCw, AlertTriangle, AlertCircle, Info, ShieldAlert, FlaskConical, Save, X } from 'lucide-react';


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

  // What-If Scenario Simulator state
  const [showSimulator, setShowSimulator] = useState(false);
  const [products, setProducts] = useState(['AA', 'KMO', 'RETARDER', 'SDS', 'SMO']);
  const [simProduct, setSimProduct] = useState('AA');
  const [simExtraDispatch, setSimExtraDispatch] = useState(0);
  const [simProductionBoost, setSimProductionBoost] = useState(0);
  const [scenarioName, setScenarioName] = useState('');
  const [scenarioAiNarration, setScenarioAiNarration] = useState('');
  const [savingScenario, setSavingScenario] = useState(false);
  const [leftWidth, setLeftWidth] = useState(40); // default 40%
  const containerRef = useRef(null);

  const handleMouseDown = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftWidth;
    
    if (!containerRef.current) return;
    const containerWidth = containerRef.current.getBoundingClientRect().width;

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaPercent = (deltaX / containerWidth) * 100;
      const newWidth = Math.min(Math.max(startWidth + deltaPercent, 20), 80);
      setLeftWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };


  // Fetch optimizer results
  useEffect(() => {
    fetchOptimizerData();
    fetch(`${API_BASE}/products`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setProducts(data);
          setSimProduct(data[0]);
        }
      })
      .catch(err => console.error(err));
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

  // ─── What-If Simulator Logic ────────────────────────────────────────────────
  const buildProjection = (extraDispatch, productionBoost) => {
    if (!optimizerData) return [];
    // Uses products state from component scope
    const baselineStocks = optimizerData.inventory_stocks || {};
    const startStock = baselineStocks[simProduct] || 0;
    const dailyProd = 7.5 + productionBoost; // rough daily estimate
    const dailyDispatch = 4.0 + extraDispatch;

    const baselinePoints = [];
    const scenarioPoints = [];
    for (let t = 0; t <= 7; t++) {
      baselinePoints.push({ day: t, stock: Math.max(0, startStock + t * 7.5 - t * 4.0) });
      scenarioPoints.push({ day: t, stock: Math.max(0, startStock + t * dailyProd - t * dailyDispatch) });
    }
    return { baseline: baselinePoints, scenario: scenarioPoints };
  };

  const buildNarration = () => {
    const proj = buildProjection(simExtraDispatch, simProductionBoost);
    if (!proj.baseline) return '';
    const baselineEnd = proj.baseline[7]?.stock.toFixed(1) || 0;
    const scenarioEnd = proj.scenario[7]?.stock.toFixed(1) || 0;
    const delta = (scenarioEnd - baselineEnd).toFixed(1);
    const impact = delta > 0 ? `an INCREASE of ${delta} MT` : `a DECREASE of ${Math.abs(delta)} MT`;
    return `Scenario Analysis for ${simProduct}: Under baseline conditions, projected 7-day stock is ${baselineEnd} MT. ` +
      `With +${simExtraDispatch} MT/day extra dispatch and +${simProductionBoost} MT/day production boost, ` +
      `the scenario projects ${scenarioEnd} MT — representing ${impact} vs baseline. ` +
      (scenarioEnd < 10 ? '⚠ CAUTION: Scenario stock is critically low. Consider increasing production or deferring dispatches.' : '✓ Stock levels are sustainable under this scenario.');
  };

  const handleSaveScenario = () => {
    const proj = buildProjection(simExtraDispatch, simProductionBoost);
    if (!scenarioName.trim()) return alert('Please enter a scenario name.');
    setSavingScenario(true);
    const narration = buildNarration();
    fetch(`${API_BASE}/scenarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: scenarioName,
        snapshot_json: { product: simProduct, extra_dispatch: simExtraDispatch, production_boost: simProductionBoost, projection: proj },
        ai_narration: narration,
        created_by: 'Logistics Planner'
      })
    })
      .then(r => r.json())
      .then(d => { setSavingScenario(false); if (d.success) alert('Scenario saved successfully.'); })
      .catch(() => setSavingScenario(false));
  };

  // ─── SVG Dual-Series Chart ───────────────────────────────────────────────────
  const renderDualChart = () => {
    const proj = buildProjection(simExtraDispatch, simProductionBoost);
    if (!proj.baseline) return null;
    const W = 520, H = 180, PAD = 30;
    const allVals = [...proj.baseline.map(p => p.stock), ...proj.scenario.map(p => p.stock)];
    const maxV = Math.max(...allVals, 1);
    const scaleX = (d) => PAD + (d / 7) * (W - PAD * 2);
    const scaleY = (v) => H - PAD - (v / maxV) * (H - PAD * 2);
    const makePath = (pts) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(p.day).toFixed(1)} ${scaleY(p.stock).toFixed(1)}`).join(' ');
    return (
      <svg width={W} height={H} style={{ fontFamily: 'monospace', overflow: 'visible' }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(r => (
          <line key={r} x1={PAD} y1={scaleY(maxV * r)} x2={W - PAD} y2={scaleY(maxV * r)}
            stroke="#E2E8F0" strokeWidth="1" />
        ))}
        {/* Baseline series */}
        <path d={makePath(proj.baseline)} fill="none" stroke="#94A3B8" strokeWidth="2" strokeDasharray="4 3" />
        {/* Scenario series */}
        <path d={makePath(proj.scenario)} fill="none" stroke="#3B82F6" strokeWidth="2.5" />
        {proj.scenario.map((p, i) => (
          <circle key={i} cx={scaleX(p.day)} cy={scaleY(p.stock)} r="3"
            fill={p.stock < 10 ? 'var(--danger)' : 'var(--info)'} />
        ))}
        {/* Axis labels */}
        {proj.baseline.map((p, i) => (
          <text key={i} x={scaleX(p.day)} y={H - 8} textAnchor="middle" fontSize="9" fill="#94A3B8">D+{p.day}</text>
        ))}
        {/* Legend */}
        <line x1={PAD} y1={12} x2={PAD + 20} y2={12} stroke="#94A3B8" strokeWidth="2" strokeDasharray="4 3" />
        <text x={PAD + 24} y={16} fontSize="9" fill="#64748B">Baseline</text>
        <line x1={PAD + 80} y1={12} x2={PAD + 100} y2={12} stroke="#3B82F6" strokeWidth="2.5" />
        <text x={PAD + 104} y={16} fontSize="9" fill="#3B82F6">Scenario</text>
      </svg>
    );
  };


  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px' }}>
        <div style={{ width: '20px', height: '20px', border: '3px solid #E2E8F0', borderTopColor: 'var(--primary-blue)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <span>Synthesizing inventory snapshots and running prioritizer...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      <div className="split-pane" ref={containerRef} style={{ gap: 0 }}>
        
        {/* LEFT PANE: Today's Actionable PO Pool */}
        <div className="pane-left card" style={{ flex: `0 0 ${leftWidth}%` }}>
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
                          <span className="score-cell badge" style={{ backgroundColor: item.score >= 100 ? 'var(--success-bg)' : item.score >= 60 ? 'var(--info-bg)' : 'var(--bg-subtle)', color: item.score >= 100 ? 'var(--success)' : item.score >= 60 ? 'var(--info)' : 'var(--text-primary)' }}>
                            {item.score}
                            <span className="score-tooltip">
                              <div style={{ fontWeight: 'bold', marginBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.2)', paddingBottom: '4px' }}>AI Prioritization Score Details</div>
                              <div className="tooltip-row"><span>Base (Tier {item.company_tier}):</span> <span>+{item.base_points} pts</span></div>
                              <div className="tooltip-row"><span>Age ({item.order_age_days}d × 2):</span> <span>+{item.age_points} pts</span></div>
                              <div className="tooltip-row"><span>Stock Deficit Check:</span> <span>{item.stock_penalty} pts</span></div>
                              {item.commitment_points > 0 && (
                                <div className="tooltip-row" style={{ color: 'var(--warning)' }}><span>Commitment Urgency:</span> <span>+{item.commitment_points} pts</span></div>
                              )}
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
                      <td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>No unallocated PO lines found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Resizer Divider */}
        <div 
          onMouseDown={handleMouseDown}
          className="pane-resizer"
          style={{
            width: '12px',
            margin: '0 -6px',
            cursor: 'col-resize',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            alignSelf: 'stretch',
          }}
          title="Drag to resize panels"
        >
          <div style={{ width: '4px', height: '40px', borderRadius: '2px', backgroundColor: 'var(--border-strong)', transition: 'background-color 0.2s' }} />
        </div>

        {/* RIGHT PANE: AI-Recommended Dispatch Runs */}
        <div className="pane-right card" style={{ flex: `1 1 0%` }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Truck size={16} color="#1C6BF4" />
              Proposed Consolidation Runs
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '11px', color: 'var(--info)', borderColor: 'var(--info-border)', display: 'flex', alignItems: 'center', gap: '5px' }}
                onClick={() => { setShowSimulator(true); setScenarioAiNarration(''); }}>
                <FlaskConical size={12} /> Simulate Scenario
              </button>
              <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={fetchOptimizerData}>
                <RefreshCw size={12} style={{ marginRight: '4px' }} />
                Reset Runs
              </button>
            </div>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
            
            {/* Projected Stock Remainder */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', backgroundColor: 'var(--bg-subtle)', padding: '10px 14px', borderRadius: '4px', border: '1px solid #E2E8F0' }}>
              <div style={{ width: '100%', fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px' }}>Projected Remaining Stock After Plan Exec:</div>
              {Object.entries(remainingStocks).map(([prod, stock]) => {
                const isWarning = stock < 10; // generic threshold check
                return (
                  <div key={prod} style={{ display: 'flex', gap: '6px', fontSize: '11px', borderRight: '1px solid #E2E8F0', paddingRight: '10px' }}>
                    <span>{prod}:</span>
                    <strong style={{ color: isWarning ? 'var(--danger)' : 'var(--success)', fontFamily: 'monospace' }}>{stock.toFixed(0)} MT</strong>
                  </div>
                );
              })}
            </div>

            {/* Run Items list */}
            {editableRuns.map((run, runIdx) => (
              <div key={run.run_id} style={{ border: '1px solid #E2E8F0', borderRadius: '4px', background: 'var(--bg-elevated)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid #E2E8F0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="badge planned" style={{ fontSize: '10px', fontWeight: 'bold' }}>{run.run_id}</span>
                    <span style={{ fontSize: '13px', fontWeight: 600 }}>Product: <strong>{run.product_type}</strong></span>
                  </div>
                  <div style={{ fontSize: '12px' }}>
                    Consolidated Weight: <strong className="mono" style={{ color: run.total_quantity > 32 ? 'var(--warning)' : 'var(--success)' }}>{run.total_quantity.toFixed(1)} MT</strong> / 32 MT
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
                                  <span style={{ fontSize: '8px', color: 'var(--danger)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '2px' }}>
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
                              <button className="btn btn-secondary" style={{ padding: '3px 6px', fontSize: '10px', color: 'var(--danger)', borderColor: 'var(--danger-border)' }} onClick={() => handleRemoveAllocation(runIdx, allocIdx)}>
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
              <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
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

      {/* What-If Scenario Simulator Overlay */}
      {showSimulator && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '640px' }}>
            <div className="modal-header" style={{ background: 'linear-gradient(135deg, #1E1B4B, #312E81)', borderBottom: '1px solid #4C1D95' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'white' }}>
                <FlaskConical size={18} />
                <h3 style={{ color: 'white', margin: 0 }}>What-If Scenario Simulator</h3>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'white' }} onClick={() => setShowSimulator(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', background: 'var(--bg-subtle)', padding: '10px 12px', borderRadius: '4px', border: '1px solid #E2E8F0' }}>
                Adjust parameters below to see how changes in dispatch volume or production output affect 7-day inventory projections. Baseline (gray dashed) vs Scenario (blue solid).
              </div>

              {/* Controls */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label>Product</label>
                  <select value={simProduct} onChange={e => setSimProduct(e.target.value)}>
                    {products.map(p => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Extra Dispatch +{simExtraDispatch} MT/day</label>
                  <input type="range" min="0" max="20" step="1" value={simExtraDispatch}
                    onChange={e => setSimExtraDispatch(parseInt(e.target.value))}
                    style={{ width: '100%', marginTop: '6px' }} />
                </div>
                <div className="form-group">
                  <label>Production Boost +{simProductionBoost} MT/day</label>
                  <input type="range" min="0" max="20" step="1" value={simProductionBoost}
                    onChange={e => setSimProductionBoost(parseInt(e.target.value))}
                    style={{ width: '100%', marginTop: '6px' }} />
                </div>
              </div>

              {/* Dual-series Chart */}
              <div style={{ background: 'var(--bg-subtle)', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '12px', overflowX: 'auto' }}>
                {renderDualChart()}
              </div>

              {/* AI Narration */}
              <div style={{ background: 'var(--info-bg)', border: '1px solid #BFDBFE', borderRadius: '6px', padding: '12px' }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--info)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>AI Scenario Analysis</div>
                <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-primary)', lineHeight: 1.6 }}>{buildNarration()}</p>
              </div>

              {/* Save Scenario */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flex: 1, margin: 0 }}>
                  <label>Scenario Name</label>
                  <input type="text" placeholder="e.g. High-demand Acetone week" value={scenarioName}
                    onChange={e => setScenarioName(e.target.value)} />
                </div>
                <button className="btn btn-primary" style={{ padding: '8px 16px', height: '36px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  disabled={savingScenario} onClick={handleSaveScenario}>
                  <Save size={13} /> {savingScenario ? 'Saving...' : 'Save Scenario'}
                </button>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowSimulator(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Credit Hold Override Modal */}
      {showOverrideModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <div className="modal-header" style={{ backgroundColor: 'var(--warning-bg)', borderBottomColor: 'var(--warning-border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--warning)' }}>
                <ShieldAlert size={18} />
                <h3>Credit Hold Override Authorization</h3>
              </div>
            </div>
            <form onSubmit={handleOverrideSubmit}>
              <div className="modal-body">
                {overrideError && (
                  <div style={{ backgroundColor: 'var(--danger-bg)', border: '1px solid #FCA5A5', color: 'var(--danger)', padding: '10px', fontSize: '12px', borderRadius: '4px', marginBottom: '16px' }}>
                    {overrideError}
                  </div>
                )}
                
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                  The following allocations target customer companies currently flagged on **Credit Hold**. Allocating inventory to these clients requires explicitly logging a manager override reason.
                </p>

                {getOnHoldAllocations().map(alloc => (
                  <div key={alloc.po_id} style={{ border: '1px solid #E2E8F0', padding: '12px', borderRadius: '4px', marginBottom: '12px', backgroundColor: 'var(--bg-subtle)' }}>
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
                <button type="submit" className="btn btn-primary" style={{ backgroundColor: 'var(--warning)' }}>Authorize & Commit</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
