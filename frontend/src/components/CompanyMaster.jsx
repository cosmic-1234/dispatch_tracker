import React, { useState, useEffect } from 'react';
import { Plus, Search, Edit2, X, AlertTriangle, ShieldCheck, History, RefreshCw } from 'lucide-react';

export default function CompanyMaster({ API_BASE, triggerRefresh }) {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  // History Drawer State
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [historyData, setHistoryData] = useState({ pos: [], dispatches: [] });
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyTab, setHistoryTab] = useState('pos'); // 'pos' or 'dispatches'

  // Search/Filters State
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('All');
  const [creditFilter, setCreditFilter] = useState('All');

  // Modals state
  const [showFormModal, setShowFormModal] = useState(false);
  const [formError, setFormError] = useState('');
  const [editingId, setEditingId] = useState(null);

  // Form Fields
  const [compId, setCompId] = useState('');
  const [compName, setCompName] = useState('');
  const [compTier, setCompTier] = useState('B');
  const [compContactPerson, setCompContactPerson] = useState('');
  const [compContactPhone, setCompContactPhone] = useState('');
  const [compCreditStatus, setCompCreditStatus] = useState('Active');
  const [products, setProducts] = useState(['Acetone', 'Benzene', 'DEP', 'Ethyl Acetate', 'Retarder', 'Toluene']);
  const [selectedProducts, setSelectedProducts] = useState({});

  useEffect(() => {
    fetchCompanies();
    fetch(`${API_BASE}/products`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setProducts(data);
          const initialProds = {};
          data.forEach(p => {
            initialProds[p] = false;
          });
          setSelectedProducts(initialProds);
        }
      })
      .catch(err => console.error(err));
  }, []);

  const fetchCompanies = () => {
    setLoading(true);
    fetch(`${API_BASE}/companies`)
      .then(res => res.json())
      .then(data => {
        setCompanies(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  const handleHistoryClick = (company) => {
    setSelectedCompany(company);
    setShowHistoryDrawer(true);
    setLoadingHistory(true);
    setHistoryTab('pos');
    
    fetch(`${API_BASE}/companies/${company.id}/history`)
      .then(res => res.json())
      .then(data => {
        setHistoryData(data);
        setLoadingHistory(false);
      })
      .catch(err => {
        console.error('Error fetching company history:', err);
        setLoadingHistory(false);
      });
  };

  const handleEditClick = (c) => {
    setFormError('');
    setEditingId(c.id);
    setCompId(c.id);
    setCompName(c.name);
    setCompTier(c.tier);
    setCompContactPerson(c.contact_person);
    setCompContactPhone(c.contact_phone);
    setCompCreditStatus(c.credit_status);

    // Map products
    const prodMap = {};
    products.forEach(p => {
      prodMap[p] = false;
    });
    c.primary_products.forEach(p => {
      if (prodMap[p] !== undefined) prodMap[p] = true;
    });
    setSelectedProducts(prodMap);
    setShowFormModal(true);
  };

  const handleAddClick = () => {
    setFormError('');
    setEditingId(null);
    setCompId('');
    setCompName('');
    setCompTier('B');
    setCompContactPerson('');
    setCompContactPhone('');
    setCompCreditStatus('Active');
    const initialProds = {};
    products.forEach(p => {
      initialProds[p] = false;
    });
    setSelectedProducts(initialProds);
    setShowFormModal(true);
  };

  const handleCheckboxChange = (prod) => {
    setSelectedProducts(prev => ({
      ...prev,
      [prod]: !prev[prod]
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setFormError('');

    if (!compId.trim()) return setFormError('Company ID is required.');
    if (!compName.trim()) return setFormError('Company name is required.');
    
    const products = Object.keys(selectedProducts).filter(k => selectedProducts[k]);
    if (products.length === 0) {
      return setFormError('Please select at least one primary product.');
    }

    const payload = {
      id: compId.trim().toUpperCase(),
      name: compName.trim(),
      tier: compTier,
      primary_products: products,
      contact_person: compContactPerson.trim(),
      contact_phone: compContactPhone.trim(),
      credit_status: compCreditStatus
    };

    const url = editingId ? `${API_BASE}/companies/${editingId}` : `${API_BASE}/companies`;
    const method = editingId ? 'PUT' : 'POST';

    fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setFormError(data.error);
        } else {
          setShowFormModal(false);
          fetchCompanies();
          triggerRefresh();
        }
      })
      .catch(err => {
        console.error(err);
        setFormError('Network communication error.');
      });
  };

  // Filter Companies list
  const filtered = companies.filter(c => {
    const matchesSearch = c.id.toLowerCase().includes(search.toLowerCase()) || 
                          c.name.toLowerCase().includes(search.toLowerCase()) ||
                          c.contact_person.toLowerCase().includes(search.toLowerCase());
    const matchesTier = tierFilter === 'All' || c.tier === tierFilter;
    const matchesCredit = creditFilter === 'All' || c.credit_status === creditFilter;

    return matchesSearch && matchesTier && matchesCredit;
  });

  return (
    <>
      {/* 1. Header controls */}
      <div className="card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: '#64748B' }} />
              <input 
                type="text" 
                placeholder="Search Client ID / Name..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: '32px', width: '220px', height: '32px' }}
              />
            </div>

            <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} style={{ height: '32px', padding: '4px 8px' }}>
              <option value="All">All Priority Tiers</option>
              <option value="A">Tier A</option>
              <option value="B">Tier B</option>
              <option value="C">Tier C</option>
            </select>

            <select value={creditFilter} onChange={(e) => setCreditFilter(e.target.value)} style={{ height: '32px', padding: '4px 8px' }}>
              <option value="All">All Credit Statuses</option>
              <option value="Active">Active</option>
              <option value="On Hold">On Hold</option>
            </select>
          </div>

          <button className="btn btn-primary" onClick={handleAddClick}>
            <Plus size={16} />
            <span>Add Client Company</span>
          </button>
        </div>
      </div>

      {/* 2. Companies Data Grid */}
      <div className="card">
        <div className="table-wrapper">
          <table className="sap-table">
            <thead>
              <tr>
                <th>Company ID</th>
                <th>Company Name</th>
                <th>Tier</th>
                <th>Primary Product lanes</th>
                <th>Contact Person</th>
                <th>Phone Number</th>
                <th>Credit Verification</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '16px' }}>Loading client companies directory...</td>
                </tr>
              ) : filtered.map(c => (
                <tr key={c.id}>
                  <td className="mono" style={{ fontWeight: 600 }}>{c.id}</td>
                  <td><strong>{c.name}</strong></td>
                  <td><span className={`tier-badge ${c.tier}`}>Tier {c.tier}</span></td>
                  <td>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {c.primary_products.map(p => (
                        <span key={p} style={{ fontSize: '10px', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', padding: '1px 4px', borderRadius: '2px', color: '#1E3A8A' }}>
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{c.contact_person}</td>
                  <td>{c.contact_phone}</td>
                  <td>
                    {c.credit_status === 'Active' ? (
                      <span className="badge dispatched" style={{ display: 'inline-flex', gap: '4px', textTransform: 'none' }}>
                        <ShieldCheck size={11} /> Active
                      </span>
                    ) : (
                      <span className="badge onhold" style={{ display: 'inline-flex', gap: '4px', textTransform: 'none' }}>
                        <AlertTriangle size={11} /> Credit Hold
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '8px', justifyContent: 'flex-end' }}>
                      <button 
                        className="btn btn-secondary" 
                        style={{ padding: '4px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center' }} 
                        onClick={() => handleHistoryClick(c)}
                      >
                        <History size={12} style={{ marginRight: '4px' }} />
                        <span>History</span>
                      </button>
                      <button 
                        className="btn btn-secondary" 
                        style={{ padding: '4px 8px', fontSize: '11px', display: 'inline-flex', alignItems: 'center' }} 
                        onClick={() => handleEditClick(c)}
                      >
                        <Edit2 size={12} style={{ marginRight: '4px' }} />
                        <span>Edit</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {(!loading && filtered.length === 0) && (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '16px', color: '#64748B' }}>No client companies found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. CRUD Form Modal */}
      {showFormModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '550px' }}>
            <div className="modal-header">
              <h3>{editingId ? 'Edit Customer Specifications' : 'Register New Client Company'}</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setShowFormModal(false)}>
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {formError && (
                  <div style={{ backgroundColor: '#FEE2E2', border: '1px solid #FCA5A5', color: '#991B1B', padding: '10px', fontSize: '12px', borderRadius: '4px' }}>
                    {formError}
                  </div>
                )}
                
                <div className="form-grid">
                  <div className="form-group">
                    <label>Company ID <span className="required-star">*</span></label>
                    <input 
                      type="text" 
                      placeholder="e.g. COMP-007" 
                      value={compId} 
                      onChange={(e) => setCompId(e.target.value)}
                      disabled={editingId !== null}
                    />
                  </div>

                  <div className="form-group">
                    <label>Company Name <span className="required-star">*</span></label>
                    <input 
                      type="text" 
                      placeholder="e.g. Alpha Solvents" 
                      value={compName} 
                      onChange={(e) => setCompName(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Priority Customer Tier</label>
                    <select value={compTier} onChange={(e) => setCompTier(e.target.value)}>
                      <option value="A">Tier A (First Priority)</option>
                      <option value="B">Tier B (Standard priority)</option>
                      <option value="C">Tier C (Opportunistic)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Credit Account Status</label>
                    <select value={compCreditStatus} onChange={(e) => setCompCreditStatus(e.target.value)}>
                      <option value="Active">Active (Clearances approved)</option>
                      <option value="On Hold">On Hold (Block new orders)</option>
                    </select>
                  </div>
                </div>

                <div className="form-grid">
                  <div className="form-group">
                    <label>Contact Person</label>
                    <input 
                      type="text" 
                      placeholder="e.g. John Doe" 
                      value={compContactPerson} 
                      onChange={(e) => setCompContactPerson(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label>Contact Phone</label>
                    <input 
                      type="text" 
                      placeholder="e.g. +91-98765-XXXXX" 
                      value={compContactPhone} 
                      onChange={(e) => setCompContactPhone(e.target.value)}
                    />
                  </div>
                </div>

                {/* Primary products checklist */}
                <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '12px' }}>
                  <label style={{ fontSize: '11px', marginBottom: '8px', display: 'block' }}>Primary Solvent Portfolios <span className="required-star">*</span></label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                    {Object.keys(selectedProducts).map(prod => (
                      <label key={prod} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', textTransform: 'none', fontWeight: 'normal', color: 'var(--text-primary)' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedProducts[prod]} 
                          onChange={() => handleCheckboxChange(prod)}
                        />
                        <span>{prod}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowFormModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Company Master</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* 4. Company History Side Drawer */}
      {showHistoryDrawer && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            zIndex: 1000,
            display: 'flex',
            justifyContent: 'flex-end',
            transition: 'opacity 0.25s ease'
          }}
          onClick={() => setShowHistoryDrawer(false)}
        >
          <div 
            style={{
              width: '650px',
              backgroundColor: '#F8FAF9',
              height: '100%',
              boxShadow: '-4px 0 15px rgba(0, 0, 0, 0.1)',
              display: 'flex',
              flexDirection: 'column',
              padding: '24px',
              boxSizing: 'border-box',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E2DCD0', paddingBottom: '16px', marginBottom: '20px' }}>
              <div>
                <div style={{ color: '#D4AF37', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>CLIENT DOSSIER</div>
                <h3 style={{ margin: '4px 0 0 0', color: '#1C2D5A', fontSize: '18px', fontWeight: 700 }}>
                  {selectedCompany?.name}
                </h3>
                <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className={`tier-badge ${selectedCompany?.tier}`} style={{ fontSize: '10px' }}>Tier {selectedCompany?.tier}</span>
                  <span>·</span>
                  <span>ID: <strong className="mono">{selectedCompany?.id}</strong></span>
                  <span>·</span>
                  <span>Contact: {selectedCompany?.contact_person} ({selectedCompany?.contact_phone})</span>
                </div>
              </div>
              <button 
                onClick={() => setShowHistoryDrawer(false)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#64748B', padding: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Loading Indicator */}
            {loadingHistory ? (
              <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
                <RefreshCw size={24} className="spin" style={{ color: '#1C2D5A' }} />
                <span style={{ fontSize: '14px', color: '#334155' }}>Loading ledger history...</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid #E2DCD0', marginBottom: '16px' }}>
                  <button
                    onClick={() => setHistoryTab('pos')}
                    style={{
                      padding: '10px 16px',
                      fontSize: '13px',
                      fontWeight: 600,
                      border: 'none',
                      background: 'none',
                      borderBottom: historyTab === 'pos' ? '2px solid #1C2D5A' : 'none',
                      color: historyTab === 'pos' ? '#1C2D5A' : '#64748B',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    Purchase Orders ({historyData.pos.length})
                  </button>
                  <button
                    onClick={() => setHistoryTab('dispatches')}
                    style={{
                      padding: '10px 16px',
                      fontSize: '13px',
                      fontWeight: 600,
                      border: 'none',
                      background: 'none',
                      borderBottom: historyTab === 'dispatches' ? '2px solid #1C2D5A' : 'none',
                      color: historyTab === 'dispatches' ? '#1C2D5A' : '#64748B',
                      cursor: 'pointer',
                      transition: 'all 0.15s'
                    }}
                  >
                    Allocated Dispatches ({historyData.dispatches.length})
                  </button>
                </div>

                {/* Tab content wrapper */}
                <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
                  
                  {/* Purchase Orders List */}
                  {historyTab === 'pos' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {historyData.pos.map(po => (
                        <div key={po.id} className="card" style={{ padding: '16px', border: '1px solid #E2DCD0', borderRadius: '8px', backgroundColor: '#FFFFFF' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                            <div>
                              <strong className="mono" style={{ fontSize: '13px', color: '#1C2D5A' }}>{po.id}</strong>
                              <span style={{ fontSize: '11px', color: '#64748B', marginLeft: '8px' }}>Recd: {po.date_received}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <span className={`badge ${po.status === 'Closed' ? 'dispatched' : 'received'}`} style={{ fontSize: '9px', textTransform: 'none' }}>
                                {po.status}
                              </span>
                              {po.commitment_status && (
                                <span className={`badge ${po.commitment_status === 'Honored' ? 'dispatched' : po.commitment_status === 'Breached' ? 'onhold' : 'received'}`} style={{ fontSize: '9px', textTransform: 'none' }}>
                                  {po.commitment_status}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Line items list */}
                          <div style={{ backgroundColor: '#F8FAF9', padding: '10px 12px', borderRadius: '6px', border: '1px solid #E2E8F0', marginTop: '8px' }}>
                            <div style={{ fontSize: '10px', color: '#64748B', fontWeight: 700, marginBottom: '6px', textTransform: 'uppercase' }}>Items ordered & allocated</div>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                                  <th style={{ fontSize: '10px', color: '#64748B', paddingBottom: '4px', textAlign: 'left' }}>Product</th>
                                  <th style={{ fontSize: '10px', color: '#64748B', paddingBottom: '4px', textAlign: 'right' }}>Ordered</th>
                                  <th style={{ fontSize: '10px', color: '#64748B', paddingBottom: '4px', textAlign: 'right' }}>Allocated</th>
                                  <th style={{ fontSize: '10px', color: '#64748B', paddingBottom: '4px', textAlign: 'right' }}>Pending</th>
                                </tr>
                              </thead>
                              <tbody>
                                {po.line_items?.map(li => {
                                  const pending = Math.max(0, li.quantity - li.allocated_quantity);
                                  return (
                                    <tr key={li.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                                      <td style={{ fontSize: '11px', padding: '6px 0', fontWeight: 600 }}>{li.product_type}</td>
                                      <td className="mono" style={{ fontSize: '11px', padding: '6px 0', textAlign: 'right' }}>{li.quantity.toFixed(1)} MT</td>
                                      <td className="mono" style={{ fontSize: '11px', padding: '6px 0', textAlign: 'right', color: '#0F766E' }}>{li.allocated_quantity.toFixed(1)} MT</td>
                                      <td className="mono" style={{ fontSize: '11px', padding: '6px 0', textAlign: 'right', color: pending > 0 ? '#C2410C' : 'inherit' }}>{pending.toFixed(1)} MT</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          
                          {po.notes && (
                            <div style={{ fontSize: '11px', color: '#64748B', fontStyle: 'italic', marginTop: '8px' }}>
                              Note: {po.notes}
                            </div>
                          )}
                        </div>
                      ))}
                      {historyData.pos.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '32px', color: '#64748B', fontStyle: 'italic', fontSize: '13px' }}>
                          No purchase orders recorded for this company.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Dispatches List */}
                  {historyTab === 'dispatches' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {historyData.dispatches.map(d => (
                        <div key={d.id} className="card" style={{ padding: '16px', border: '1px solid #E2DCD0', borderRadius: '8px', backgroundColor: '#FFFFFF' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                            <div>
                              <strong className="mono" style={{ fontSize: '13px', color: '#1C2D5A' }}>{d.id}</strong>
                              <span style={{ fontSize: '11px', color: '#64748B', marginLeft: '8px' }}>Planned: {d.planned_dispatch_date}</span>
                            </div>
                            <span className={`badge ${d.status === 'Executed' ? 'dispatched' : d.status === 'Cancelled' ? 'onhold' : 'received'}`} style={{ fontSize: '9px', textTransform: 'none' }}>
                              {d.status}
                            </span>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '12px', fontSize: '12px', padding: '8px 0', borderBottom: '1px solid #F1F5F9' }}>
                            <div>
                              <span style={{ color: '#64748B' }}>Product:</span> <strong>{d.product_type}</strong>
                            </div>
                            <div>
                              <span style={{ color: '#64748B' }}>Allocated:</span> <strong className="mono" style={{ color: '#0F766E' }}>{d.allocated_qty.toFixed(1)} MT</strong>
                            </div>
                            <div>
                              <span style={{ color: '#64748B' }}>Total Loaded:</span> <strong className="mono">{d.quantity.toFixed(1)} MT</strong>
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr', gap: '12px', fontSize: '11px', color: '#64748B', paddingTop: '8px' }}>
                            <div>
                              <span>Vehicle ID:</span> <strong className="mono" style={{ color: '#334155' }}>{d.vehicle_id}</strong>
                            </div>
                            {d.actual_dispatch_date && (
                              <div>
                                <span>Dispatched On:</span> <strong style={{ color: '#334155' }}>{d.actual_dispatch_date}</strong>
                              </div>
                            )}
                          </div>
                          
                          {d.cancellation_reason && (
                            <div style={{ fontSize: '11px', color: '#DC2626', fontWeight: 600, marginTop: '8px' }}>
                              Cancellation Reason: {d.cancellation_reason}
                            </div>
                          )}
                        </div>
                      ))}
                      {historyData.dispatches.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '32px', color: '#64748B', fontStyle: 'italic', fontSize: '13px' }}>
                          No dispatches allocated to this company yet.
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
