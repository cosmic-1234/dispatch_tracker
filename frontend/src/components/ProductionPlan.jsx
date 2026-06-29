import React, { useState, useEffect } from 'react';
import { Calendar, Save, AlertTriangle, CheckCircle, ArrowUpDown } from 'lucide-react';

export default function ProductionPlan({ API_BASE, systemDate, triggerRefresh }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  // New plan form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProduct, setNewProduct] = useState('Acetone');
  const [newWeekDate, setNewWeekDate] = useState('2026-06-29');
  const [newPlanned, setNewPlanned] = useState('');
  const [newActual, setNewActual] = useState('');
  const [formError, setFormError] = useState('');

  // Editing state
  const [editingId, setEditingId] = useState(null);
  const [editPlanned, setEditPlanned] = useState('');
  const [editActual, setEditActual] = useState('');

  useEffect(() => {
    fetchProductionPlans();
  }, []);

  const fetchProductionPlans = () => {
    setLoading(true);
    fetch(`${API_BASE}/production`)
      .then(res => res.json())
      .then(data => {
        setPlans(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  const handleEditClick = (plan) => {
    setEditingId(plan.id);
    setEditPlanned(plan.planned_quantity);
    setEditActual(plan.actual_quantity);
  };

  const handleSaveEdit = (plan) => {
    const planned = parseFloat(editPlanned);
    const actual = parseFloat(editActual);

    if (isNaN(planned) || planned < 0 || isNaN(actual) || actual < 0) {
      alert('Quantities must be positive numbers.');
      return;
    }

    fetch(`${API_BASE}/production`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_type: plan.product_type,
        week_start_date: plan.week_start_date,
        planned_quantity: planned,
        actual_quantity: actual
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          alert(data.error);
        } else {
          setEditingId(null);
          fetchProductionPlans();
          triggerRefresh();
        }
      })
      .catch(err => console.error(err));
  };

  const handleAddSubmit = (e) => {
    e.preventDefault();
    setFormError('');

    const planned = parseFloat(newPlanned);
    const actual = parseFloat(newActual || 0);

    if (isNaN(planned) || planned < 0) {
      return setFormError('Planned quantity must be a positive number.');
    }

    fetch(`${API_BASE}/production`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_type: newProduct,
        week_start_date: newWeekDate,
        planned_quantity: planned,
        actual_quantity: actual
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setFormError(data.error);
        } else {
          setShowAddForm(false);
          setNewPlanned('');
          setNewActual('');
          fetchProductionPlans();
          triggerRefresh();
        }
      })
      .catch(err => console.error(err));
  };

  return (
    <>
      {/* Controls Card */}
      <div className="card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Calendar size={16} color="#1C6BF4" />
            <span style={{ fontSize: '13px', fontWeight: 500 }}>Production Operations Plan Tracker</span>
          </div>

          <button className="btn btn-primary" onClick={() => setShowAddForm(true)}>
            Add Weekly Target
          </button>
        </div>
      </div>

      {/* Add New Plan form popup */}
      {showAddForm && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px' }}>
            <div className="modal-header">
              <h3>Create Weekly Target</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setShowAddForm(false)}>X</button>
            </div>
            <form onSubmit={handleAddSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {formError && (
                  <div style={{ backgroundColor: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '8px', fontSize: '11px' }}>
                    {formError}
                  </div>
                )}
                
                <div className="form-group">
                  <label>Product Type</label>
                  <select value={newProduct} onChange={(e) => setNewProduct(e.target.value)}>
                    <option value="Acetone">Acetone</option>
                    <option value="Benzene">Benzene</option>
                    <option value="DEP">DEP</option>
                    <option value="Ethyl Acetate">Ethyl Acetate</option>
                    <option value="Retarder">Retarder</option>
                    <option value="Toluene">Toluene</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Week Start Date (Monday)</label>
                  <input type="date" value={newWeekDate} onChange={(e) => setNewWeekDate(e.target.value)} />
                </div>

                <div className="form-group">
                  <label>Planned Output (MT)</label>
                  <input type="number" step="0.1" placeholder="e.g. 50.0" value={newPlanned} onChange={(e) => setNewPlanned(e.target.value)} />
                </div>

                <div className="form-group">
                  <label>Actual Output (MT) [Optional]</label>
                  <input type="number" step="0.1" placeholder="e.g. 48.0" value={newActual} onChange={(e) => setNewActual(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Weekly Plan</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Production Plan Grid */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Weekly Target Plans & Production Variance Log</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
            <table className="sap-table">
              <thead>
                <tr>
                  <th>Week Starting</th>
                  <th>Product</th>
                  <th>Planned Qty (MT)</th>
                  <th>Actual Qty (MT)</th>
                  <th>Variance (MT)</th>
                  <th>Fulfillment Rate</th>
                  <th>Target Warning Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: 'center', padding: '16px' }}>Loading targets table...</td>
                  </tr>
                ) : plans.map(plan => {
                  const isEditing = editingId === plan.id;
                  const planned = isEditing ? parseFloat(editPlanned) : plan.planned_quantity;
                  const actual = isEditing ? parseFloat(editActual) : plan.actual_quantity;

                  // Calculate Variance & Rates
                  const variance = actual - planned;
                  const rate = planned > 0 ? (actual / planned) * 100 : 0;
                  const isUnderperforming = rate < 90 && plan.week_start_date <= systemDate;

                  return (
                    <tr key={plan.id}>
                      <td className="mono">{plan.week_start_date}</td>
                      <td><strong>{plan.product_type}</strong></td>
                      
                      <td>
                        {isEditing ? (
                          <input 
                            type="number" 
                            step="0.1" 
                            value={editPlanned} 
                            onChange={(e) => setEditPlanned(e.target.value)}
                            style={{ width: '80px', padding: '3px 6px', fontSize: '12px' }}
                          />
                        ) : (
                          <span className="mono">{plan.planned_quantity} MT</span>
                        )}
                      </td>

                      <td>
                        {isEditing ? (
                          <input 
                            type="number" 
                            step="0.1" 
                            value={editActual} 
                            onChange={(e) => setEditActual(e.target.value)}
                            style={{ width: '80px', padding: '3px 6px', fontSize: '12px' }}
                          />
                        ) : (
                          <span className="mono">{plan.actual_quantity} MT</span>
                        )}
                      </td>

                      <td className="mono" style={{ color: variance < 0 ? '#DC2626' : variance > 0 ? '#16A34A' : 'inherit', fontWeight: 600 }}>
                        {variance >= 0 ? '+' : ''}{variance.toFixed(1)} MT
                      </td>

                      <td className="mono" style={{ fontWeight: 500 }}>{rate.toFixed(1)}%</td>

                      <td>
                        {isUnderperforming ? (
                          <span className="badge onhold" style={{ fontSize: '9px', display: 'inline-flex', gap: '3px', textTransform: 'none' }}>
                            <AlertTriangle size={10} /> Under Target (&lt;90%)
                          </span>
                        ) : plan.week_start_date > systemDate ? (
                          <span className="badge received" style={{ fontSize: '9px', textTransform: 'none' }}>Scheduled</span>
                        ) : (
                          <span className="badge dispatched" style={{ fontSize: '9px', display: 'inline-flex', gap: '3px', textTransform: 'none' }}>
                            <CheckCircle size={10} /> Target Met
                          </span>
                        )}
                      </td>

                      <td style={{ textAlign: 'right' }}>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                            <button className="btn btn-primary" style={{ padding: '3px 6px' }} onClick={() => handleSaveEdit(plan)}>
                              <Save size={12} />
                            </button>
                            <button className="btn btn-secondary" style={{ padding: '3px 6px' }} onClick={() => setEditingId(null)}>X</button>
                          </div>
                        ) : (
                          <button className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: '11px' }} onClick={() => handleEditClick(plan)}>
                            Update
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
