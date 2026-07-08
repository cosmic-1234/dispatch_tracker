import React, { useState, useEffect } from 'react';
import { Plus, Search, Eye, Filter, ArrowUpDown, X, PlusCircle, Trash2, Calendar, Clock, RefreshCw, AlertTriangle } from 'lucide-react';


export default function POManagement({ API_BASE, systemDate, triggerRefresh }) {
  const [pos, setPos] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filtering & Sorting State
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [tierFilter, setTierFilter] = useState('All');
  const [productFilter, setProductFilter] = useState('All');
  const [sortField, setSortField] = useState('date_received');
  const [sortAsc, setSortAsc] = useState(false); // Default newest first

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 50;

  // Modals / Actions State
  const [detailPoId, setDetailPoId] = useState(null);
  const [poDetail, setPoDetail] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New PO Form State
  const [newPoId, setNewPoId] = useState('');
  const [newCompanyId, setNewCompanyId] = useState('');
  const [newDateReceived, setNewDateReceived] = useState(systemDate);
  const [newCommittedDate, setNewCommittedDate] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newItems, setNewItems] = useState([
    { product_type: 'Acetone', quantity: '' }
  ]);
  const [formError, setFormError] = useState('');

  // Renegotiation Modal State
  const [showRenegotiateModal, setShowRenegotiateModal] = useState(false);
  const [renegotiatePoId, setRenegotiatePoId] = useState(null);
  const [renegotiateNewDate, setRenegotiateNewDate] = useState('');
  const [renegotiateReason, setRenegotiateReason] = useState('');
  const [renegotiateError, setRenegotiateError] = useState('');
  const [renegotiating, setRenegotiating] = useState(false);


  // Load POs and Companies
  useEffect(() => {
    fetchPOs();
    fetch(`${API_BASE}/companies`)
      .then(res => res.json())
      .then(data => setCompanies(data))
      .catch(err => console.error(err));
  }, []);

  const fetchPOs = () => {
    setLoading(true);
    fetch(`${API_BASE}/pos`)
      .then(res => res.json())
      .then(data => {
        setPos(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const loadPoDetails = (id) => {
    fetch(`${API_BASE}/pos/${id}`)
      .then(res => res.json())
      .then(data => {
        setPoDetail(data);
        setDetailPoId(id);
      })
      .catch(err => console.error(err));
  };

  // Filters calculation
  const filteredPOs = pos.filter(po => {
    const matchesSearch = po.id.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          po.company_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'All' || po.status === statusFilter;
    const matchesTier = tierFilter === 'All' || po.company_tier === tierFilter;
    
    const poProducts = po.items.map(i => i.product_type);
    const matchesProduct = productFilter === 'All' || poProducts.includes(productFilter);

    return matchesSearch && matchesStatus && matchesTier && matchesProduct;
  });

  // Sorting calculation
  const sortedPOs = [...filteredPOs].sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];

    if (sortField === 'total_qty') {
      aVal = a.total_qty;
      bVal = b.total_qty;
    } else if (sortField === 'pending_qty') {
      aVal = a.total_qty - a.allocated_qty;
      bVal = b.total_qty - b.allocated_qty;
    }

    if (aVal === undefined || aVal === null) return 1;
    if (bVal === undefined || bVal === null) return -1;

    if (typeof aVal === 'string') {
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    } else {
      return sortAsc ? aVal - bVal : bVal - aVal;
    }
  });

  // Pagination calculation
  const indexOfLastRow = currentPage * rowsPerPage;
  const indexOfFirstRow = indexOfLastRow - rowsPerPage;
  const currentRows = sortedPOs.slice(indexOfFirstRow, indexOfLastRow);
  const totalPages = Math.ceil(sortedPOs.length / rowsPerPage) || 1;

  // Form Handlers
  const handleAddItemRow = () => {
    setNewItems([...newItems, { product_type: 'Acetone', quantity: '' }]);
  };

  const handleRemoveItemRow = (idx) => {
    setNewItems(newItems.filter((_, i) => i !== idx));
  };

  const handleItemChange = (idx, field, value) => {
    const updated = [...newItems];
    updated[idx][field] = value;
    setNewItems(updated);
  };

  const handleCreatePOSubmit = (e) => {
    e.preventDefault();
    setFormError('');

    if (!newPoId.trim()) return setFormError('Purchase Order ID is required.');
    if (!newCompanyId) return setFormError('Company selection is required.');
    if (!newDateReceived) return setFormError('Date Received is required.');
    if (newItems.length === 0) return setFormError('At least one product line item is required.');

    // Check duplicate products inside form
    const productTypes = newItems.map(i => i.product_type);
    const duplicates = productTypes.filter((item, index) => productTypes.indexOf(item) !== index);
    if (duplicates.length > 0) {
      return setFormError(`Duplicate line items found for product: ${duplicates.join(', ')}.`);
    }

    // Validate quantities
    const cleanedItems = [];
    for (const item of newItems) {
      const qty = parseFloat(item.quantity);
      if (isNaN(qty) || qty <= 0) {
        return setFormError(`Quantity for product ${item.product_type} must be a positive number.`);
      }
      cleanedItems.push({
        product_type: item.product_type,
        quantity: qty
      });
    }

    // Call API
    fetch(`${API_BASE}/pos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newPoId.trim(),
        company_id: newCompanyId,
        date_received: newDateReceived,
        committed_dispatch_date: newCommittedDate || undefined,
        notes: newNotes,
        items: cleanedItems
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setFormError(data.error);
        } else {
          // Reset and close
          setShowCreateModal(false);
          setNewPoId('');
          setNewCompanyId('');
          setNewDateReceived(systemDate);
          setNewCommittedDate('');
          setNewNotes('');
          setNewItems([{ product_type: 'Acetone', quantity: '' }]);
          fetchPOs();
          triggerRefresh();
        }
      })
      .catch(err => {
        console.error(err);
        setFormError('Failed to establish network connection to backend server.');
      });
  };

  return (
    <>
      {/* 1. Header Toolbar */}
      <div className="card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          {/* Filters Group */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: '#64748B' }} />
              <input 
                type="text" 
                placeholder="Search PO ID / Company..." 
                value={searchTerm} 
                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                style={{ paddingLeft: '32px', width: '220px', height: '32px' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Filter size={12} color="#64748B" />
              <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }} style={{ height: '32px', padding: '4px 8px' }}>
                <option value="All">All Statuses</option>
                <option value="Received">Received</option>
                <option value="Partially Allocated">Partially Allocated</option>
                <option value="Fully Allocated">Fully Allocated</option>
                <option value="Dispatched">Dispatched</option>
                <option value="Closed">Closed</option>
              </select>
            </div>

            <select value={tierFilter} onChange={(e) => { setTierFilter(e.target.value); setCurrentPage(1); }} style={{ height: '32px', padding: '4px 8px' }}>
              <option value="All">All Tiers</option>
              <option value="A">Tier A</option>
              <option value="B">Tier B</option>
              <option value="C">Tier C</option>
            </select>

            <select value={productFilter} onChange={(e) => { setProductFilter(e.target.value); setCurrentPage(1); }} style={{ height: '32px', padding: '4px 8px' }}>
              <option value="All">All Products</option>
              <option value="Acetone">Acetone</option>
              <option value="Benzene">Benzene</option>
              <option value="DEP">DEP</option>
              <option value="Ethyl Acetate">Ethyl Acetate</option>
              <option value="Retarder">Retarder</option>
              <option value="Toluene">Toluene</option>
            </select>
          </div>

          <button className="btn btn-primary" onClick={() => { setFormError(''); setShowCreateModal(true); }}>
            <Plus size={16} />
            <span>Create Purchase Order</span>
          </button>
        </div>
      </div>

      {/* 2. Main PO Data Grid */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div className="table-wrapper" style={{ flex: 1, overflowY: 'auto' }}>
          <table className="sap-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('id')}>PO ID <ArrowUpDown size={10} style={{ marginLeft: '4px' }} /></th>
                <th onClick={() => handleSort('company_name')}>Company <ArrowUpDown size={10} style={{ marginLeft: '4px' }} /></th>
                <th onClick={() => handleSort('company_tier')}>Tier <ArrowUpDown size={10} style={{ marginLeft: '4px' }} /></th>
                <th>Products</th>
                <th onClick={() => handleSort('total_qty')}>Ordered Qty (MT) <ArrowUpDown size={10} style={{ marginLeft: '4px' }} /></th>
                <th onClick={() => handleSort('pending_qty')}>Pending Qty (MT) <ArrowUpDown size={10} style={{ marginLeft: '4px' }} /></th>
                <th onClick={() => handleSort('date_received')}>Date Received <ArrowUpDown size={10} style={{ marginLeft: '4px' }} /></th>
                <th onClick={() => handleSort('order_age')}>Order Age <ArrowUpDown size={10} style={{ marginLeft: '4px' }} /></th>
                <th onClick={() => handleSort('committed_dispatch_date')}>Committed Date <ArrowUpDown size={10} style={{ marginLeft: '4px' }} /></th>
                <th onClick={() => handleSort('status')}>Status <ArrowUpDown size={10} style={{ marginLeft: '4px' }} /></th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="10" style={{ textAlign: 'center', padding: '24px' }}>Loading Purchase Orders database...</td>
                </tr>
              ) : currentRows.map(po => {
                const pending = po.total_qty - po.allocated_qty;
                return (
                  <tr key={po.id}>
                    <td className="mono" style={{ fontWeight: 600 }}>{po.id}</td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span>{po.company_name}</span>
                        {po.anomaly_flag === 1 && (
                          <span style={{ fontSize: '9px', color: '#B45309', fontWeight: 600 }}>⚠️ ANOMALY VOLUME</span>
                        )}
                        {po.company_credit_status === 'On Hold' && (
                          <span style={{ fontSize: '9px', color: '#DC2626', fontWeight: 600 }}>🚫 CREDIT HOLD</span>
                        )}
                        {po.relationship_risk_flag === 1 && (
                          <span style={{ fontSize: '9px', color: '#7C3AED', fontWeight: 600 }}>⚡ RELATIONSHIP RISK</span>
                        )}
                      </div>
                    </td>
                    <td><span className={`tier-badge ${po.company_tier}`}>{po.company_tier}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {po.items.map(item => (
                          <span key={item.product_type} style={{ fontSize: '10px', backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', padding: '1px 4px', borderRadius: '2px' }}>
                            {item.product_type} ({item.quantity} MT)
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="mono" style={{ fontWeight: 500 }}>{po.total_qty.toFixed(1)} MT</td>
                    <td className="mono" style={{ fontWeight: 500, color: pending > 0 ? '#1C6BF4' : 'inherit' }}>{pending.toFixed(1)} MT</td>
                    <td>{po.date_received}</td>
                    <td>{po.order_age} day(s)</td>
                    <td>
                      {po.committed_dispatch_date ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '11px' }}>{po.committed_dispatch_date}</span>
                          {po.commitment_status && (
                            <span style={{
                              fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                              background: po.commitment_status === 'Honored' ? '#D1FAE5' : po.commitment_status === 'Missed' ? '#FEE2E2' : po.commitment_status === 'Renegotiated' ? '#FEF3C7' : '#EFF6FF',
                              color: po.commitment_status === 'Honored' ? '#065F46' : po.commitment_status === 'Missed' ? '#991B1B' : po.commitment_status === 'Renegotiated' ? '#92400E' : '#1E40AF',
                            }}>{po.commitment_status}</span>
                          )}
                        </div>
                      ) : <span style={{ color: '#94A3B8', fontSize: '10px' }}>Not set</span>}
                    </td>
                    <td><span className={`badge ${po.status.toLowerCase().replace(' ', '_')}`}>{po.status}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => loadPoDetails(po.id)}>
                        <Eye size={12} style={{ marginRight: '4px' }} />
                        <span>Inspect</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
              {(!loading && currentRows.length === 0) && (
                <tr>
                  <td colSpan="10" style={{ textAlign: 'center', padding: '24px', color: '#64748B' }}>No Purchase Orders matching filters found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="pagination">
          <span>Showing {indexOfFirstRow + 1} to {Math.min(indexOfLastRow, sortedPOs.length)} of {sortedPOs.length} rows</span>
          <div className="pagination-controls">
            <button className="btn btn-secondary" style={{ padding: '4px 8px' }} disabled={currentPage === 1} onClick={() => setCurrentPage(prev => prev - 1)}>Prev</button>
            <span style={{ margin: '0 8px', display: 'flex', alignItems: 'center' }}>Page {currentPage} of {totalPages}</span>
            <button className="btn btn-secondary" style={{ padding: '4px 8px' }} disabled={currentPage === totalPages} onClick={() => setCurrentPage(prev => prev + 1)}>Next</button>
          </div>
        </div>
      </div>

      {/* 3. Create PO Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '650px' }}>
            <div className="modal-header">
              <h3>Create New Purchase Order</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setShowCreateModal(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleCreatePOSubmit}>
              <div className="modal-body">
                {formError && (
                  <div style={{ backgroundColor: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '10px', fontSize: '12px', borderRadius: '4px', marginBottom: '16px' }}>
                    {formError}
                  </div>
                )}
                
                <div className="form-grid">
                  <div className="form-group">
                    <label>PO Identifier <span className="required-star">*</span></label>
                    <input 
                      type="text" 
                      placeholder="e.g. PO-2026-0006" 
                      value={newPoId}
                      onChange={(e) => setNewPoId(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Customer Company <span className="required-star">*</span></label>
                    <select value={newCompanyId} onChange={(e) => setNewCompanyId(e.target.value)}>
                      <option value="">-- Select Company --</option>
                      {companies.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} (Tier {c.tier}) {c.credit_status === 'On Hold' ? '[CREDIT HOLD]' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Received Date <span className="required-star">*</span></label>
                    <input 
                      type="date" 
                      value={newDateReceived}
                      onChange={(e) => setNewDateReceived(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Calendar size={12} /> Committed Dispatch Date
                      <span style={{ fontSize: '10px', color: '#94A3B8', fontWeight: 400 }}>(optional)</span>
                    </label>
                    <input 
                      type="date" 
                      value={newCommittedDate}
                      onChange={(e) => setNewCommittedDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group full-width" style={{ marginBottom: '16px' }}>
                  <label>Order Notes</label>
                  <textarea 
                    rows="2" 
                    placeholder="Enter special shipping notes or logistics instructions..."
                    value={newNotes}
                    onChange={(e) => setNewNotes(e.target.value)}
                  />
                </div>

                {/* Line Items Builder */}
                <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--primary-navy)' }}>Order Line Items</label>
                    <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '11px', display: 'flex', gap: '4px' }} onClick={handleAddItemRow}>
                      <PlusCircle size={12} />
                      <span>Add Product Line</span>
                    </button>
                  </div>

                  {newItems.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '8px' }}>
                      <div className="form-group" style={{ flex: 1.8 }}>
                        <select 
                          value={item.product_type} 
                          onChange={(e) => handleItemChange(idx, 'product_type', e.target.value)}
                          style={{ width: '100%' }}
                        >
                          <option value="Acetone">Acetone</option>
                          <option value="Benzene">Benzene</option>
                          <option value="DEP">DEP</option>
                          <option value="Ethyl Acetate">Ethyl Acetate</option>
                          <option value="Retarder">Retarder</option>
                          <option value="Toluene">Toluene</option>
                        </select>
                      </div>

                      <div className="form-group" style={{ flex: 1.2 }}>
                        <input 
                          type="number" 
                          step="0.1" 
                          placeholder="Qty (MT)" 
                          value={item.quantity}
                          onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                          style={{ width: '100%' }}
                        />
                      </div>

                      <button 
                        type="button" 
                        className="btn btn-secondary" 
                        style={{ padding: '6px', color: '#EF4444', borderColor: '#FCA5A5' }}
                        disabled={newItems.length === 1}
                        onClick={() => handleRemoveItemRow(idx)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Purchase Order</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detailPoId && poDetail && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '680px' }}>
            <div className="modal-header">
              <h3>PO Specification: {poDetail.id}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => { setDetailPoId(null); setPoDetail(null); }}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px', backgroundColor: '#F8FAFC', padding: '12px', borderRadius: '4px', border: '1px solid #E2E8F0' }}>
                <div>Company Name: <strong>{poDetail.company_name}</strong></div>
                <div>Customer Priority: <span className={`tier-badge ${poDetail.company_tier}`}>Tier {poDetail.company_tier}</span></div>
                <div>Credit Verification: <strong style={{ color: poDetail.company_credit_status === 'Active' ? 'green' : 'red' }}>{poDetail.company_credit_status}</strong></div>
                <div>Received Date: <strong>{poDetail.date_received}</strong></div>
                <div style={{ gridColumn: 'span 2' }}>System Audit Status: <span className={`badge ${poDetail.status.toLowerCase().replace(' ', '_')}`}>{poDetail.status}</span></div>
                {poDetail.notes && (
                  <div style={{ gridColumn: 'span 2', borderTop: '1px solid #E2E8F0', paddingTop: '8px', marginTop: '4px' }}>
                    Notes: <span style={{ color: 'var(--text-secondary)' }}>{poDetail.notes}</span>
                  </div>
                )}
              </div>

              {/* Commitment Section */}
              {poDetail.committed_dispatch_date && (
                <div style={{ background: '#F0F7FF', border: '1px solid #BFDBFE', borderRadius: '6px', padding: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Clock size={13} color="#3B82F6" />
                      <span style={{ fontWeight: 700, fontSize: '12px', color: '#1E40AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Commitment Tracking</span>
                    </div>
                    <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '11px', color: '#D97706', borderColor: '#FCD34D' }}
                      onClick={() => { setRenegotiatePoId(poDetail.id); setRenegotiateNewDate(''); setRenegotiateReason(''); setRenegotiateError(''); setShowRenegotiateModal(true); }}>
                      Renegotiate Date
                    </button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '12px' }}>
                    <div>Committed Date: <strong style={{ color: poDetail.commitment_status === 'Missed' ? '#DC2626' : '#1E293B' }}>{poDetail.committed_dispatch_date}</strong></div>
                    <div>Status: <span style={{
                      padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700,
                      background: poDetail.commitment_status === 'Honored' ? '#D1FAE5' : poDetail.commitment_status === 'Missed' ? '#FEE2E2' : poDetail.commitment_status === 'Renegotiated' ? '#FEF3C7' : '#EFF6FF',
                      color: poDetail.commitment_status === 'Honored' ? '#065F46' : poDetail.commitment_status === 'Missed' ? '#991B1B' : poDetail.commitment_status === 'Renegotiated' ? '#92400E' : '#1E40AF',
                    }}>{poDetail.commitment_status}</span></div>
                    {poDetail.commitment_health_score !== null && poDetail.commitment_health_score !== undefined && (
                      <div>Company Health Score: <strong>{Math.round(poDetail.commitment_health_score)}%</strong></div>
                    )}
                  </div>
                  {/* Commitment History Timeline */}
                  {poDetail.commitment_history && poDetail.commitment_history.length > 0 && (
                    <div style={{ marginTop: '12px', borderTop: '1px solid #BFDBFE', paddingTop: '10px' }}>
                      <div style={{ fontSize: '10px', fontWeight: 700, color: '#1E40AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Commitment History</div>
                      {poDetail.commitment_history.map((h, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '8px' }}>
                          <div style={{ width: '7px', height: '7px', borderRadius: '50%', marginTop: '4px', flexShrink: 0,
                            background: h.status === 'Honored' ? '#10B981' : h.status === 'Missed' ? '#EF4444' : h.status === 'Renegotiated' ? '#F59E0B' : '#3B82F6' }} />
                          <div style={{ fontSize: '11px' }}>
                            <span style={{ fontWeight: 600 }}>{h.status}</span>
                            {h.committed_date && <span style={{ color: '#64748B' }}> — {h.committed_date}</span>}
                            {h.reason && <div style={{ color: '#94A3B8', marginTop: '1px' }}>{h.reason}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <h4 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--primary-navy)', marginBottom: '8px', textTransform: 'uppercase' }}>Line Item Allocation Matrix</h4>
                <div className="table-wrapper">
                  <table className="sap-table">
                    <thead>
                      <tr>
                        <th>Product Type</th>
                        <th>Ordered Quantity (MT)</th>
                        <th>Allocated Quantity (MT)</th>
                        <th>90-Day Avg Order</th>
                        <th>Anomaly Flag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {poDetail.items.map(item => (
                        <tr key={item.id}>
                          <td><strong>{item.product_type}</strong></td>
                          <td className="mono">{item.quantity} MT</td>
                          <td className="mono" style={{ color: '#1C6BF4', fontWeight: 600 }}>{item.allocated_quantity} MT</td>
                          <td className="mono">{item.avg_90day ? `${item.avg_90day.toFixed(1)} MT` : 'N/A'}</td>
                          <td>
                            {item.is_anomalous ? (
                              <span className="badge onhold" style={{ fontSize: '9px', padding: '1px 4px' }}>ANOMALOUS (&gt;2x)</span>
                            ) : (
                              <span style={{ color: 'green', fontSize: '11px' }}>Nominal</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h4 style={{ fontSize: '12px', fontWeight: 600, color: 'var(--primary-navy)', marginBottom: '8px', textTransform: 'uppercase' }}>Linked Dispatch Allocations Log</h4>
                <div className="table-wrapper">
                  <table className="sap-table">
                    <thead>
                      <tr>
                        <th>Dispatch ID</th>
                        <th>Vehicle/Run</th>
                        <th>Product</th>
                        <th>Quantity</th>
                        <th>Dispatch Date</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {poDetail.allocations && poDetail.allocations.map(alloc => (
                        <tr key={alloc.id}>
                          <td className="mono">{alloc.dispatch_id}</td>
                          <td className="mono">{alloc.vehicle_id}</td>
                          <td>{poDetail.items.find(i => i.id === alloc.po_line_item_id)?.product_type || 'Unknown'}</td>
                          <td className="mono">{alloc.quantity} MT</td>
                          <td>{alloc.actual_dispatch_date || alloc.planned_dispatch_date}</td>
                          <td><span className={`badge ${alloc.dispatch_status.toLowerCase()}`}>{alloc.dispatch_status}</span></td>
                        </tr>
                      ))}
                      {(!poDetail.allocations || poDetail.allocations.length === 0) && (
                        <tr>
                          <td colSpan="6" style={{ textAlign: 'center', padding: '12px', color: '#64748B' }}>No dispatches scheduled yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setDetailPoId(null); setPoDetail(null); }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Renegotiation Modal */}
      {showRenegotiateModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h3>Renegotiate Committed Date</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setShowRenegotiateModal(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {renegotiateError && (
                <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: '4px', padding: '10px', fontSize: '12px', color: '#DC2626' }}>
                  <AlertTriangle size={12} style={{ marginRight: '5px' }} />{renegotiateError}
                </div>
              )}
              <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '4px', padding: '10px', fontSize: '12px', color: '#92400E' }}>
                <strong>PO ID:</strong> {renegotiatePoId} — This action will create a permanent audit record in the commitment history.
              </div>
              <div className="form-group">
                <label>New Committed Dispatch Date <span className="required-star">*</span></label>
                <input type="date" value={renegotiateNewDate} onChange={e => setRenegotiateNewDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Reason for Renegotiation <span className="required-star">*</span></label>
                <textarea rows="3" placeholder="e.g. Vehicle unavailability, production delay, customer-requested reschedule..."
                  value={renegotiateReason} onChange={e => setRenegotiateReason(e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowRenegotiateModal(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={renegotiating} onClick={() => {
                if (!renegotiateNewDate) return setRenegotiateError('New committed date is required.');
                if (!renegotiateReason.trim()) return setRenegotiateError('Reason is required for audit trail.');
                setRenegotiating(true);
                fetch(`${API_BASE}/pos/${renegotiatePoId}/renegotiate`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ new_committed_date: renegotiateNewDate, reason: renegotiateReason })
                })
                  .then(r => r.json())
                  .then(d => {
                    setRenegotiating(false);
                    if (d.error) { setRenegotiateError(d.error); }
                    else {
                      setShowRenegotiateModal(false);
                      // Reload the PO detail to refresh commitment history
                      if (detailPoId) { loadPoDetails(detailPoId); }
                      fetchPOs();
                      triggerRefresh();
                    }
                  })
                  .catch(e => { setRenegotiating(false); setRenegotiateError(e.message); });
              }}>
                {renegotiating ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite', marginRight: '5px' }} />Saving...</> : 'Confirm Renegotiation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
