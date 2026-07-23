import React, { useState, useEffect } from 'react';
import { Check, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';

export default function InventoryManagement({ API_BASE, systemDate, triggerRefresh }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Date selector for active snapshots entry (default to systemDate)
  const [activeDate, setActiveDate] = useState(systemDate);
  const [activeSnapshots, setActiveSnapshots] = useState([]);
  
  // Tracking form inputs
  const [editedSnaps, setEditedSnaps] = useState({}); // prod -> { prod_add, pur_rec, disp_out }
  const [saving, setSaving] = useState(false);

  const [products, setProducts] = useState(['AA', 'KMO', 'RETARDER', 'SDS', 'SMO']);

  useEffect(() => {
    fetch(`${API_BASE}/products`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setProducts(data);
        }
      })
      .catch(err => console.error(err));
  }, []);

  useEffect(() => {
    fetchInventory();
  }, [activeDate, systemDate, products]);

  const fetchInventory = () => {
    setLoading(true);
    fetch(`${API_BASE}/inventory`)
      .then(res => res.json())
      .then(data => {
        setSnapshots(data);
        
        // Filter for active date entry
        const todaysSnaps = data.filter(s => s.date === activeDate);
        setActiveSnapshots(todaysSnaps);

        // Prepopulate edit inputs
        const initialEdits = {};
        todaysSnaps.forEach(s => {
          initialEdits[s.product_type] = {
            opening_stock: s.opening_stock,
            production_added: s.production_added,
            purchased_material_received: s.purchased_material_received,
            dispatched_out: s.dispatched_out,
            confirmed: s.confirmed
          };
        });

        // If no snapshots exist for activeDate yet, let's create placeholders
        // Finding yesterday's closing stock for each product
        if (todaysSnaps.length === 0) {
          products.forEach(p => {
            // Find most recent snapshot before activeDate for this product
            const pastSnaps = data.filter(s => s.product_type === p && s.date < activeDate);
            const prevClosing = pastSnaps.length > 0 ? pastSnaps[0].closing_stock : 0.0;
            
            initialEdits[p] = {
              opening_stock: prevClosing,
              production_added: 0.0,
              purchased_material_received: 0.0,
              dispatched_out: 0.0,
              confirmed: 0
            };
          });
        }

        setEditedSnaps(initialEdits);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  const handleInputChange = (product, field, val) => {
    const value = parseFloat(val);
    if (isNaN(value) || value < 0) return;

    setEditedSnaps(prev => ({
      ...prev,
      [product]: {
        ...prev[product],
        [field]: value
      }
    }));
  };

  const handleSaveSnapshot = (product) => {
    const edit = editedSnaps[product];
    if (!edit) return;

    setSaving(true);
    const snapshotId = `${product}_${activeDate}`;
    
    fetch(`${API_BASE}/inventory/${snapshotId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edit)
    })
      .then(res => res.json())
      .then(data => {
        setSaving(false);
        if (data.error) {
          alert(`Error saving: ${data.error}`);
        } else {
          fetchInventory();
          triggerRefresh();
        }
      })
      .catch(err => {
        console.error(err);
        setSaving(false);
      });
  };

  const handleConfirmDay = () => {
    const products = Object.keys(editedSnaps);
    if (products.length === 0) return;

    // Verify all products are saved first or save them concurrently
    setSaving(true);
    
    // First, save all snapshots
    const savePromises = products.map(p => {
      const snapshotId = `${p}_${activeDate}`;
      return fetch(`${API_BASE}/inventory/${snapshotId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedSnaps[p])
      }).then(res => res.json());
    });

    Promise.all(savePromises)
      .then(() => {
        // Then, lock/confirm day snapshot
        return fetch(`${API_BASE}/inventory/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: activeDate,
            product_types: products,
            created_by: 'Logistics Planner'
          })
        });
      })
      .then(res => res.json())
      .then(data => {
        setSaving(false);
        if (data.error) {
          alert(`Error confirming day: ${data.error}`);
        } else {
          fetchInventory();
          triggerRefresh();
          alert(`Inventory snapshot for ${activeDate} has been locked and confirmed.`);
        }
      })
      .catch(err => {
        console.error(err);
        setSaving(false);
      });
  };

  // Check if active date is confirmed
  const isDayConfirmed = activeSnapshots.length > 0 && activeSnapshots.every(s => s.confirmed === 1);

  return (
    <>
      {/* Date and Action Toolbar */}
      <div className="card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <label style={{ margin: 0 }}>Review Stock On Date:</label>
            <input 
              type="date" 
              value={activeDate}
              onChange={(e) => setActiveDate(e.target.value)}
              style={{ height: '32px', width: '150px' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" style={{ padding: '6px 12px' }} onClick={fetchInventory}>
              <RefreshCw size={14} style={{ marginRight: '6px' }} />
              Reload Table
            </button>
            {!isDayConfirmed && (
              <button className="btn btn-primary" onClick={handleConfirmDay} disabled={saving}>
                <Check size={14} style={{ marginRight: '6px' }} />
                Confirm & Lock Day's Snapshot
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Snapshot Entry Form / Status Card */}
      <div className="card">
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="card-title">Daily Stock Reconciliation Matrix ({activeDate})</span>
          {isDayConfirmed ? (
            <span className="badge dispatched" style={{ display: 'flex', gap: '4px', textTransform: 'none' }}>
              <ShieldCheck size={14} /> Confirmed & Locked
            </span>
          ) : (
            <span className="badge onhold" style={{ display: 'flex', gap: '4px', textTransform: 'none' }}>
              <AlertTriangle size={14} /> Unconfirmed Snapshot (Editable)
            </span>
          )}
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
            <table className="sap-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Opening Stock (MT)</th>
                  <th>Production Added (MT)</th>
                  <th>Purchased Recv (MT)</th>
                  <th>Dispatched Out (MT)</th>
                  <th>Closing Stock (MT)</th>
                  <th>System Dispatches (Executed)</th>
                  <th>Reconcile Status</th>
                  {!isDayConfirmed && <th style={{ textAlign: 'right' }}>Save</th>}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="9" style={{ textAlign: 'center', padding: '16px' }}>Loading snapshot details...</td>
                  </tr>
                ) : Object.keys(editedSnaps).map(prod => {
                  const edit = editedSnaps[prod] || {};
                  
                  // Calculate Closing Stock: Open + Prod + Purchase - Dispatched
                  const calculatedClosing = Math.max(0, 
                    (edit.opening_stock || 0) + 
                    (edit.production_added || 0) + 
                    (edit.purchased_material_received || 0) - 
                    (edit.dispatched_out || 0)
                  );

                  // Retrieve system executed dispatches for this date/product to show mismatches
                  const snapInfo = activeSnapshots.find(s => s.product_type === prod);
                  const systemSum = snapInfo ? snapInfo.actual_dispatched_records_sum : 0.0;
                  const mismatch = snapInfo ? snapInfo.reconciliation_mismatch : Math.abs(edit.dispatched_out - systemSum) > 0.01;
                  const delta = snapInfo ? snapInfo.reconciliation_delta : Math.abs(edit.dispatched_out - systemSum);

                  return (
                    <tr key={prod}>
                      <td><strong>{prod}</strong></td>
                      <td className="mono">{edit.opening_stock?.toFixed(1) || '0.0'} MT</td>
                      
                      <td>
                        <input 
                          type="number" 
                          step="0.1"
                          disabled={isDayConfirmed}
                          value={edit.production_added === 0 ? '' : edit.production_added} 
                          placeholder="0.0"
                          onChange={(e) => handleInputChange(prod, 'production_added', e.target.value)}
                          style={{ width: '90px', padding: '3px 6px', fontSize: '12px', fontFamily: 'monospace' }}
                        />
                      </td>
                      
                      <td>
                        <input 
                          type="number" 
                          step="0.1"
                          disabled={isDayConfirmed}
                          value={edit.purchased_material_received === 0 ? '' : edit.purchased_material_received}
                          placeholder="0.0"
                          onChange={(e) => handleInputChange(prod, 'purchased_material_received', e.target.value)}
                          style={{ width: '90px', padding: '3px 6px', fontSize: '12px', fontFamily: 'monospace' }}
                        />
                      </td>

                      <td>
                        <input 
                          type="number" 
                          step="0.1"
                          disabled={isDayConfirmed}
                          value={edit.dispatched_out === 0 ? '' : edit.dispatched_out}
                          placeholder="0.0"
                          onChange={(e) => handleInputChange(prod, 'dispatched_out', e.target.value)}
                          style={{ width: '90px', padding: '3px 6px', fontSize: '12px', fontFamily: 'monospace' }}
                        />
                      </td>

                      <td className="mono" style={{ fontWeight: 600 }}>{calculatedClosing.toFixed(1)} MT</td>
                      
                      <td className="mono" style={{ color: '#64748B' }}>{systemSum.toFixed(1)} MT</td>
                      
                      <td>
                        {mismatch ? (
                          <span className="badge cancelled" style={{ fontSize: '9px', padding: '2px 4px', display: 'inline-flex', gap: '3px' }}>
                            <AlertTriangle size={10} /> MISMATCH ({delta.toFixed(1)} MT)
                          </span>
                        ) : (
                          <span style={{ color: 'green', fontSize: '11px' }}>Reconciled</span>
                        )}
                      </td>

                      {!isDayConfirmed && (
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-secondary" style={{ padding: '3px 8px', fontSize: '11px' }} onClick={() => handleSaveSnapshot(prod)} disabled={saving}>
                            Save
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Historical logs table */}
      <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="card-header">
          <span className="card-title">Inventory Snapshot Audit Log (Previous 30 Days)</span>
        </div>
        <div className="table-wrapper" style={{ flex: 1, overflowY: 'auto' }}>
          <table className="sap-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Product</th>
                <th>Opening Stock</th>
                <th>Production Added</th>
                <th>Purchased Material</th>
                <th>Dispatched Out</th>
                <th>Closing Stock</th>
                <th>Health Status</th>
                <th>Confirmation</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.slice(0, 180).map((snap, i) => (
                <tr key={`${snap.id}-${i}`}>
                  <td>{snap.date}</td>
                  <td><strong>{snap.product_type}</strong></td>
                  <td className="mono">{snap.opening_stock.toFixed(1)} MT</td>
                  <td className="mono">+{snap.production_added.toFixed(1)} MT</td>
                  <td className="mono">+{snap.purchased_material_received.toFixed(1)} MT</td>
                  <td className="mono">-{snap.dispatched_out.toFixed(1)} MT</td>
                  <td className="mono" style={{ fontWeight: 600 }}>{snap.closing_stock.toFixed(1)} MT</td>
                  <td>
                    <span className={`badge ${snap.health}`}>
                      {snap.health === 'green' ? 'Healthy' : snap.health === 'amber' ? 'Low Stock' : 'Critical'}
                    </span>
                  </td>
                  <td>
                    {snap.confirmed === 1 ? (
                      <span style={{ color: 'green', fontWeight: 500 }}>Locked</span>
                    ) : (
                      <span style={{ color: '#D97706', fontWeight: 500 }}>Draft</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
