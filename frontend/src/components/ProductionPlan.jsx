import React, { useState, useEffect } from 'react';
import { 
  Calendar as CalendarIcon, 
  Save, 
  AlertTriangle, 
  CheckCircle, 
  Edit2, 
  X, 
  RefreshCw, 
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2
} from 'lucide-react';

export default function ProductionPlan({ API_BASE, systemDate, triggerRefresh }) {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState('Planning Schedule');
  
  // Product sub-tabs dynamically loaded from database
  const [products, setProducts] = useState(['AA', 'KMO', 'RETARDER', 'SDS', 'SMO']);
  const [selectedSubTab, setSelectedSubTab] = useState('AA');

  // Loading states
  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState([]);
  const [pos, setPos] = useState([]);
  const [dispatches, setDispatches] = useState([]);
  const [companies, setCompanies] = useState([]);

  // Calendar Cell Quick Edit States
  const [editingDate, setEditingDate] = useState(null);
  const [editProdQty, setEditProdQty] = useState('0');
  const [editPurchasedQty, setEditPurchasedQty] = useState('0');
  const [editDispatchCompanyId, setEditDispatchCompanyId] = useState('');
  const [editDispatchQty, setEditDispatchQty] = useState('0');
  const [savingEdit, setSavingEdit] = useState(false);

  // Active planning month
  const [selectedMonth, setSelectedMonth] = useState('2026-07'); // Default to July 2026

  // Form inputs - Log Entry
  const [logEntryDate, setLogEntryDate] = useState('2026-07-13');
  const [prodQty, setProdQty] = useState('0');
  const [purchasedQty, setPurchasedQty] = useState('0');
  const [entryNotes, setEntryNotes] = useState('');
  const [submittingEntry, setSubmittingEntry] = useState(false);

  // Form inputs - Log Dispatch
  const [logDispatchDate, setLogDispatchDate] = useState('2026-07-13');
  const [dispatchCompanyId, setDispatchCompanyId] = useState('');
  const [dispatchQty, setDispatchQty] = useState('0');
  const [dispatchPrice, setDispatchPrice] = useState('0');
  const [submittingDispatch, setSubmittingDispatch] = useState(false);

  // Add Company Modal state
  const [showAddCompany, setShowAddCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyTier, setNewCompanyTier] = useState('B');
  const [newCompanyProduct, setNewCompanyProduct] = useState('Ethyl Acetate');
  const [submittingCompany, setSubmittingCompany] = useState(false);

  const activeProduct = selectedSubTab;

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch Products list first
      const prodRes = await fetch(`${API_BASE}/products`);
      const prodData = await prodRes.json();
      if (Array.isArray(prodData) && prodData.length > 0) {
        setProducts(prodData);
        if (!prodData.includes(selectedSubTab)) {
          setSelectedSubTab(prodData[0]);
        }
      }

      // 1. Fetch inventory snapshots (with include_future=true)
      const snapRes = await fetch(`${API_BASE}/inventory?include_future=true`);
      const snapData = await snapRes.json();
      setSnapshots(snapData);

      // 2. Fetch POs
      const poRes = await fetch(`${API_BASE}/pos`);
      const poData = await poRes.json();
      setPos(poData);

      // 3. Fetch Dispatches
      const dispRes = await fetch(`${API_BASE}/dispatch`);
      const dispData = await dispRes.json();
      setDispatches(dispData);

      // 4. Fetch Companies
      const coRes = await fetch(`${API_BASE}/companies`);
      const coData = await coRes.json();
      setCompanies(coData);
      
      if (coData.length > 0 && !dispatchCompanyId) {
        setDispatchCompanyId(coData[0].id);
      }
    } catch (err) {
      console.error('Error fetching dispatch ledger data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Log production & purchase entry
  const handleAddEntry = async (e) => {
    e.preventDefault();
    if (!logEntryDate) {
      alert('Please select a valid date.');
      return;
    }

    const prodVal = parseFloat(prodQty || 0);
    const purVal = parseFloat(purchasedQty || 0);

    if (isNaN(prodVal) || prodVal < 0 || isNaN(purVal) || purVal < 0) {
      alert('Quantities must be positive numbers.');
      return;
    }

    setSubmittingEntry(true);
    try {
      const snapId = `${activeProduct}_${logEntryDate}`;
      const existing = snapshots.find(s => s.id === snapId);

      const response = await fetch(`${API_BASE}/inventory/${snapId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opening_stock: existing ? existing.opening_stock : 0.0,
          production_added: prodVal,
          purchased_material_received: purVal,
          dispatched_out: existing ? existing.dispatched_out : 0.0,
          confirmed: existing ? existing.confirmed : 0
        })
      });

      const data = await response.json();
      if (data.error) {
        alert(data.error);
      } else {
        setProdQty('0');
        setPurchasedQty('0');
        setEntryNotes('');
        await fetchData();
        if (triggerRefresh) triggerRefresh();
      }
    } catch (err) {
      console.error('Error saving entry:', err);
    } finally {
      setSubmittingEntry(false);
    }
  };

  // Log dispatch entry
  const handleAddDispatch = async (e) => {
    e.preventDefault();
    if (!logDispatchDate || !dispatchCompanyId) {
      alert('Date and Company are required.');
      return;
    }

    const qtyVal = parseFloat(dispatchQty || 0);
    const priceVal = parseFloat(dispatchPrice || 0);

    if (isNaN(qtyVal) || qtyVal <= 0) {
      alert('Quantity must be greater than 0.');
      return;
    }

    setSubmittingDispatch(true);
    try {
      const response = await fetch(`${API_BASE}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: dispatchCompanyId,
          product_type: activeProduct,
          quantity: qtyVal,
          date: logDispatchDate,
          price: priceVal > 0 ? priceVal : null
        })
      });

      const data = await response.json();
      if (data.error) {
        alert(data.error);
      } else {
        setDispatchQty('0');
        setDispatchPrice('0');
        await fetchData();
        if (triggerRefresh) triggerRefresh();
      }
    } catch (err) {
      console.error('Error logging dispatch:', err);
    } finally {
      setSubmittingDispatch(false);
    }
  };

  // Calendar quick edit functions
  const startEditing = (dateStr, snap) => {
    setEditingDate(dateStr);
    setEditProdQty(snap ? String(snap.production_added || 0) : '0');
    setEditPurchasedQty(snap ? String(snap.purchased_material_received || 0) : '0');
    
    if (companies.length > 0) {
      setEditDispatchCompanyId(companies[0].id);
    } else {
      setEditDispatchCompanyId('');
    }
    setEditDispatchQty('0');
  };

  const handleSaveEditProduction = async (dateStr) => {
    const prodVal = parseFloat(editProdQty || 0);
    const purVal = parseFloat(editPurchasedQty || 0);

    if (isNaN(prodVal) || prodVal < 0 || isNaN(purVal) || purVal < 0) {
      alert('Quantities must be positive numbers.');
      return;
    }

    setSavingEdit(true);
    try {
      const snapId = `${activeProduct}_${dateStr}`;
      const existing = snapshots.find(s => s.id === snapId);

      const response = await fetch(`${API_BASE}/inventory/${snapId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opening_stock: existing ? existing.opening_stock : 0.0,
          production_added: prodVal,
          purchased_material_received: purVal,
          dispatched_out: existing ? existing.dispatched_out : 0.0,
          confirmed: existing ? existing.confirmed : 0
        })
      });

      const data = await response.json();
      if (data.error) {
        alert(data.error);
      } else {
        await fetchData();
        if (triggerRefresh) triggerRefresh();
        setEditingDate(null);
      }
    } catch (err) {
      console.error('Error saving quick edit production:', err);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleAddEditDispatch = async (dateStr) => {
    if (!editDispatchCompanyId) {
      alert('Company is required.');
      return;
    }

    const qtyVal = parseFloat(editDispatchQty || 0);
    if (isNaN(qtyVal) || qtyVal <= 0) {
      alert('Quantity must be greater than 0.');
      return;
    }

    setSavingEdit(true);
    try {
      const response = await fetch(`${API_BASE}/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: editDispatchCompanyId,
          product_type: activeProduct,
          quantity: qtyVal,
          date: dateStr,
          price: null
        })
      });

      const data = await response.json();
      if (data.error) {
        alert(data.error);
      } else {
        await fetchData();
        if (triggerRefresh) triggerRefresh();
        setEditingDate(null);
      }
    } catch (err) {
      console.error('Error saving quick edit dispatch:', err);
    } finally {
      setSavingEdit(false);
    }
  };

  // Add new company helper
  const handleCreateCompany = async (e) => {
    e.preventDefault();
    if (!newCompanyName.trim()) return;

    setSubmittingCompany(true);
    try {
      const response = await fetch(`${API_BASE}/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCompanyName.trim(),
          tier: newCompanyTier,
          primary_products: [newCompanyProduct]
        })
      });

      const data = await response.json();
      if (data.error) {
        alert(data.error);
      } else {
        setNewCompanyName('');
        setShowAddCompany(false);
        await fetchData();
      }
    } catch (err) {
      console.error('Error adding company:', err);
    } finally {
      setSubmittingCompany(false);
    }
  };

  // Sunday-to-Saturday week array constructor
  const getWeeksForMonth = (monthStr) => {
    const [year, month] = monthStr.split('-').map(Number);
    const firstDayOfMonth = new Date(year, month - 1, 1);
    const lastDayOfMonth = new Date(year, month, 0);

    // Find the Sunday of the week containing firstDayOfMonth
    const dayOfFirst = firstDayOfMonth.getDay();
    const diffToSunday = -dayOfFirst;
    const startDate = new Date(firstDayOfMonth);
    startDate.setDate(firstDayOfMonth.getDate() + diffToSunday);

    // Find the Saturday of the week containing lastDayOfMonth
    const dayOfLast = lastDayOfMonth.getDay();
    const diffToSaturday = 6 - dayOfLast;
    const endDate = new Date(lastDayOfMonth);
    endDate.setDate(lastDayOfMonth.getDate() + diffToSaturday);

    const days = [];
    let curr = new Date(startDate);
    while (curr <= endDate) {
      const y = curr.getFullYear();
      const m = String(curr.getMonth() + 1).padStart(2, '0');
      const d = String(curr.getDate()).padStart(2, '0');
      days.push(`${y}-${m}-${d}`);
      curr.setDate(curr.getDate() + 1);
    }

    const weeks = [];
    for (let i = 0; i < days.length; i += 7) {
      weeks.push(days.slice(i, i + 7));
    }
    return weeks;
  };

  const weeks = getWeeksForMonth(selectedMonth);

  // Group dispatches by date for fast lookup
  const dispMap = {};
  dispatches.forEach(d => {
    if (d.product_type === activeProduct) {
      const dateKey = d.actual_dispatch_date || d.planned_dispatch_date;
      if (dateKey) {
        if (!dispMap[dateKey]) dispMap[dateKey] = [];
        dispMap[dateKey].push(d);
      }
    }
  });

  // Pre-calculate running stock and daily quantities for all calendar dates
  const sortedSnaps = [...snapshots]
    .filter(s => s.product_type === activeProduct)
    .sort((a, b) => a.date.localeCompare(b.date));

  const calendarData = {};
  if (weeks.length > 0) {
    const startDateStr = weeks[0][0];
    const endDateStr = weeks[weeks.length - 1][6];
    
    // Find initial running stock before the calendar start date
    let runningStock = 0;
    const priorSnaps = sortedSnaps.filter(s => s.date < startDateStr);
    if (priorSnaps.length > 0) {
      runningStock = priorSnaps[priorSnaps.length - 1].closing_stock;
    }
    
    let currDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);
    
    while (currDate <= endDate) {
      const y = currDate.getFullYear();
      const m = String(currDate.getMonth() + 1).padStart(2, '0');
      const d = String(currDate.getDate()).padStart(2, '0');
      const dateKey = `${y}-${m}-${d}`;
      
      const snap = sortedSnaps.find(s => s.date === dateKey);
      const dayDispatches = dispMap[dateKey] || [];
      const dispatchQty = dayDispatches.reduce((sum, d) => sum + (d.quantity || 0), 0);
      
      let prodQty = 0;
      let purchasedQty = 0;
      let closingStock = runningStock;
      
      if (snap) {
        prodQty = snap.production_added || 0;
        purchasedQty = snap.purchased_material_received || 0;
        closingStock = snap.closing_stock || 0;
      } else {
        closingStock = Math.max(0, runningStock - dispatchQty);
      }
      
      calendarData[dateKey] = {
        prodQty,
        purchasedQty,
        stockQty: closingStock,
        dispatchQty,
        snap,
      };
      
      runningStock = closingStock;
      
      // Advance by 1 day local time
      currDate.setDate(currDate.getDate() + 1);
    }
  }

  // Aggregate Customer Orders Summary (Right Table / Parties Tab)
  const customerOrdersSummary = {};
  pos.forEach(po => {
    const poMonth = po.date_received ? po.date_received.slice(0, 7) : '';
    if (poMonth === selectedMonth) {
      let orderQty = 0;
      if (po.line_items) {
        po.line_items.forEach(li => {
          if (li.product_type === activeProduct) {
            orderQty += parseFloat(li.quantity || 0);
          }
        });
      }

      if (orderQty > 0) {
        const coName = po.company_name;
        if (!customerOrdersSummary[coName]) {
          customerOrdersSummary[coName] = {
            company: coName,
            ordered: 0,
            delivered: 0,
          };
        }
        customerOrdersSummary[coName].ordered += orderQty;
      }
    }
  });

  dispatches.forEach(d => {
    const dispMonth = (d.actual_dispatch_date || d.planned_dispatch_date || '').slice(0, 7);
    if (dispMonth === selectedMonth && d.product_type === activeProduct && d.status === 'Executed') {
      if (d.allocations) {
        d.allocations.forEach(alloc => {
          const coName = alloc.company_name;
          if (customerOrdersSummary[coName]) {
            customerOrdersSummary[coName].delivered += parseFloat(alloc.allocated_quantity || 0);
          } else {
            customerOrdersSummary[coName] = {
              company: coName,
              ordered: 0,
              delivered: parseFloat(alloc.allocated_quantity || 0),
            };
          }
        });
      }
    }
  });

  const customerRows = Object.values(customerOrdersSummary);
  const totalOrdered = customerRows.reduce((sum, r) => sum + r.ordered, 0);
  const totalDelivered = customerRows.reduce((sum, r) => sum + r.delivered, 0);
  const totalRemaining = customerRows.reduce((sum, r) => sum + (r.ordered - r.delivered), 0);

  // Month navigation helpers
  const handlePrevMonth = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const prevDate = new Date(year, month - 2, 1);
    const mStr = String(prevDate.getMonth() + 1).padStart(2, '0');
    setSelectedMonth(`${prevDate.getFullYear()}-${mStr}`);
  };

  const handleNextMonth = () => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const nextDate = new Date(year, month, 1);
    const mStr = String(nextDate.getMonth() + 1).padStart(2, '0');
    setSelectedMonth(`${nextDate.getFullYear()}-${mStr}`);
  };

  const formatMonthName = (monthStr) => {
    const [year, month] = monthStr.split('-');
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const handleDayClick = (dateStr) => {
    setLogEntryDate(dateStr);
    setLogDispatchDate(dateStr);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '400px', gap: '12px' }}>
        <RefreshCw size={24} className="spin" style={{ color: '#1C6BF4' }} />
        <span>Loading Dispatch Ledger data...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', backgroundColor: '#F7F5F0', padding: '24px', borderRadius: '12px', minHeight: '80vh', border: '1px solid #E4E2DC' }}>
      
      {/* Top Banner and Navigation Tabs */}
      <div style={{ backgroundColor: 'var(--primary-navy)', padding: '24px 24px 0 24px', borderRadius: '8px 8px 0 0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div>
          <div style={{ color: '#D4AF37', fontSize: '11px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase' }}>DISPATCH LEDGER</div>
          <h2 style={{ margin: '4px 0 0 0', color: '#FFFFFF', fontSize: '22px', fontWeight: 700 }}>Dynamic Dispatch Planning Center</h2>
        </div>
        {/* Tab selector */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {['Dashboard', 'Planning Schedule', 'Parties & PO', 'Products'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '10px 20px',
                fontSize: '13px',
                fontWeight: 600,
                border: 'none',
                background: activeTab === tab ? '#F7F5F0' : 'transparent',
                color: activeTab === tab ? 'var(--primary-navy)' : 'rgba(255, 255, 255, 0.7)',
                borderRadius: '6px 6px 0 0',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Main Tab Content Branching */}
      {activeTab === 'Planning Schedule' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Product Sub-tabs */}
          <div style={{ display: 'flex', gap: '8px', paddingBottom: '4px' }}>
            {products.map(tab => (
              <button
                key={tab}
                onClick={() => setSelectedSubTab(tab)}
                style={{
                  padding: '8px 24px',
                  fontSize: '13px',
                  fontWeight: 700,
                  borderRadius: '6px',
                  border: '1px solid #CBD5E1',
                  backgroundColor: selectedSubTab === tab ? 'var(--primary-navy)' : '#FFFFFF',
                  color: selectedSubTab === tab ? '#FFFFFF' : '#334155',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Form Rows - Log Entry & Log Dispatch */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            
            {/* Form Card 1: Log Entry */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #E2DCD0', borderRadius: '8px' }}>
              <div style={{ backgroundColor: '#E5DED0', padding: '12px 16px', fontSize: '13px', fontWeight: 700, color: 'var(--primary-navy)', borderBottom: '1px solid #E2DCD0' }}>
                Log entry — {selectedSubTab}
              </div>
              <form onSubmit={handleAddEntry} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 2fr', gap: '12px' }}>
                  <div className="form-group">
                    <label style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Date</label>
                    <input 
                      type="date" 
                      value={logEntryDate} 
                      onChange={(e) => setLogEntryDate(e.target.value)} 
                      style={{ padding: '8px 12px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '6px', width: '100%', backgroundColor: '#FFFFFF', color: '#334155' }}
                    />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Production qty</label>
                    <input 
                      type="number" 
                      step="0.1"
                      value={prodQty} 
                      onChange={(e) => setProdQty(e.target.value)} 
                      style={{ padding: '8px 12px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '6px', width: '100%', backgroundColor: '#FFFFFF', color: '#334155' }}
                    />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Purchased qty</label>
                    <input 
                      type="number" 
                      step="0.1"
                      value={purchasedQty} 
                      onChange={(e) => setPurchasedQty(e.target.value)} 
                      style={{ padding: '8px 12px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '6px', width: '100%', backgroundColor: '#FFFFFF', color: '#334155' }}
                    />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Notes</label>
                    <input 
                      type="text" 
                      placeholder="optional" 
                      value={entryNotes} 
                      onChange={(e) => setEntryNotes(e.target.value)} 
                      style={{ padding: '8px 12px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '6px', width: '100%', backgroundColor: '#FFFFFF', color: '#334155' }}
                    />
                  </div>
                </div>

                <button 
                  type="submit" 
                  disabled={submittingEntry}
                  style={{
                    backgroundColor: 'var(--primary-blue)',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '8px 20px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    alignSelf: 'flex-start',
                    marginTop: '8px',
                    height: '34px',
                    transition: 'background-color 0.2s'
                  }}
                  className="btn-primary-action"
                >
                  Add entry
                </button>
              </form>
            </div>

            {/* Form Card 2: Log Dispatch */}
            <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid #E2DCD0', borderRadius: '8px' }}>
              <div style={{ backgroundColor: '#E5DED0', padding: '12px 16px', fontSize: '13px', fontWeight: 700, color: 'var(--primary-navy)', borderBottom: '1px solid #E2DCD0' }}>
                Log dispatch — {selectedSubTab}
              </div>
              <form onSubmit={handleAddDispatch} style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr 1.2fr', gap: '12px' }}>
                  <div className="form-group">
                    <label style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Date</label>
                    <input 
                      type="date" 
                      value={logDispatchDate} 
                      onChange={(e) => setLogDispatchDate(e.target.value)} 
                      style={{ padding: '8px 12px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '6px', width: '100%', backgroundColor: '#FFFFFF', color: '#334155' }}
                    />
                  </div>
                  
                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <label style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>Company</label>
                      <button 
                        type="button" 
                        onClick={() => setShowAddCompany(true)}
                        style={{ border: 'none', background: 'none', color: '#0369A1', fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                      >
                        + new company
                      </button>
                    </div>
                    <select
                      value={dispatchCompanyId}
                      onChange={(e) => setDispatchCompanyId(e.target.value)}
                      style={{ padding: '8px 12px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '6px', width: '100%', outline: 'none', backgroundColor: '#FFFFFF', color: '#334155' }}
                    >
                      {companies.map(co => (
                        <option key={co.id} value={co.id}>{co.name}</option>
                      ))}
                      {companies.length === 0 && <option value="">No companies loaded</option>}
                    </select>
                  </div>

                  <div className="form-group">
                    <label style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Quantity</label>
                    <input 
                      type="number" 
                      step="0.1"
                      value={dispatchQty} 
                      onChange={(e) => setDispatchQty(e.target.value)} 
                      style={{ padding: '8px 12px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '6px', width: '100%', backgroundColor: '#FFFFFF', color: '#334155' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginTop: '4px' }}>
                  <div className="form-group" style={{ flex: '0 0 180px', margin: 0 }}>
                    <label style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Price / unit (optional)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      value={dispatchPrice} 
                      onChange={(e) => setDispatchPrice(e.target.value)} 
                      style={{ padding: '8px 12px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '6px', width: '100%', backgroundColor: '#FFFFFF', color: '#334155' }}
                    />
                  </div>

                  <button 
                    type="submit" 
                    disabled={submittingDispatch}
                    style={{
                      backgroundColor: '#235E52',
                      color: '#FFFFFF',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '8px 20px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      height: '34px',
                      transition: 'background-color 0.2s'
                    }}
                  >
                    Add dispatch
                  </button>
                </div>
                
                {companies.length === 0 && (
                  <div style={{ fontSize: '11px', color: '#64748B', fontStyle: 'italic', marginTop: '4px' }}>
                    No companies yet — click "+ new company" to add one.
                  </div>
                )}
              </form>
            </div>

          </div>

          {/* Month Navigation Control */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: 'transparent' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button 
                onClick={handlePrevMonth}
                style={{ 
                  width: '32px', 
                  height: '32px', 
                  borderRadius: '6px', 
                  border: 'none', 
                  background: 'var(--primary-blue)', 
                  color: '#FFFFFF', 
                  cursor: 'pointer', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  transition: 'background-color 0.2s'
                }}
                className="nav-arrow-btn"
              >
                <ChevronLeft size={16} />
              </button>
              <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--primary-navy)', minWidth: '120px', textAlign: 'center' }}>
                {formatMonthName(selectedMonth)}
              </span>
              <button 
                onClick={handleNextMonth}
                style={{ 
                  width: '32px', 
                  height: '32px', 
                  borderRadius: '6px', 
                  border: 'none', 
                  background: 'var(--primary-blue)', 
                  color: '#FFFFFF', 
                  cursor: 'pointer', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  transition: 'background-color 0.2s'
                }}
                className="nav-arrow-btn"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <button 
              onClick={() => setSelectedMonth(systemDate.slice(0, 7))}
              style={{ background: 'none', border: 'none', textDecoration: 'underline', color: '#0369A1', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
            >
              Today
            </button>
          </div>

          {/* Sunday-to-Saturday Calendar Grid */}
          <div style={{ backgroundColor: '#FAF6EE', padding: '16px', borderRadius: '24px', border: '1px solid #E2DCD0' }}>
            <div style={{ borderRadius: '16px', overflow: 'hidden', backgroundColor: '#FFFFFF', border: '1px solid #E2E8F0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--primary-navy)', borderBottom: '1px solid #E2E8F0' }}>
                    {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map(day => (
                      <th key={day} style={{ padding: '12px 6px', fontSize: '11px', fontWeight: 700, color: '#FFFFFF', textAlign: 'center', width: '14.28%' }}>
                        {day}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week, wIdx) => (
                    <tr key={wIdx} style={{ borderBottom: wIdx === weeks.length - 1 ? 'none' : '1px solid #E2E8F0' }}>
                      {week.map((dateStr, dIdx) => {
                        const isCurrentMonth = dateStr.startsWith(selectedMonth);
                        const dayNum = parseInt(dateStr.split('-')[2], 10);
                        const dayData = calendarData[dateStr] || { prodQty: 0, purchasedQty: 0, stockQty: 0, dispatchQty: 0, snap: null };
                        const snap = dayData.snap;
                        const dayDispatches = dispMap[dateStr] || [];

                        const prodQty = dayData.prodQty + dayData.purchasedQty;
                        const stockQty = dayData.stockQty;
                        const dispatchQty = dayData.dispatchQty;

                        const total = prodQty + stockQty + dispatchQty;

                        let prodWidth = 0;
                        let stockWidth = 0;
                        let dispatchWidth = 0;

                        if (total > 0) {
                          prodWidth = (prodQty / total) * 100;
                          stockWidth = (stockQty / total) * 100;
                          dispatchWidth = (dispatchQty / total) * 100;
                        }

                        const isSelected = logEntryDate === dateStr;

                        const tooltipText = snap ? 
                          `Date: ${dateStr}\n` +
                          `Production: +${prodQty.toFixed(1)} MT\n` +
                          `Stock: ${stockQty.toFixed(1)} MT\n` +
                          `Dispatch: ${dispatchQty.toFixed(1)} MT` +
                          (dayDispatches.length > 0 ? ` (${dayDispatches.map(d => `${d.allocations?.[0]?.company_name || 'Customer'}: ${d.quantity} MT`).join(', ')})` : '')
                          : `Date: ${dateStr}\nNo data recorded`;

                        return (
                          <td 
                            key={dIdx} 
                            onClick={() => handleDayClick(dateStr)}
                            title={tooltipText}
                            className={`calendar-cell ${isSelected ? 'selected' : ''}`}
                            style={{ 
                              padding: '12px 10px', 
                              height: '110px', 
                              verticalAlign: 'top', 
                              borderRight: dIdx === 6 ? 'none' : '1px solid #E2E8F0', 
                              cursor: 'pointer',
                              position: 'relative',
                              backgroundColor: isSelected ? '#DCEFEA' : '#FFFFFF',
                            }}
                          >
                            {/* Day number */}
                            <div style={{ 
                              fontSize: '13px', 
                              fontWeight: 700, 
                              color: isCurrentMonth ? '#1E293B' : '#CBD5E1',
                              marginBottom: '4px',
                              opacity: isCurrentMonth ? 1 : 0.5
                            }}>
                              {dayNum}
                            </div>

                            {/* Quantities Text Details */}
                            <div style={{ 
                              display: 'flex', 
                              flexDirection: 'column', 
                              gap: '2px', 
                              minHeight: '44px',
                              opacity: isCurrentMonth ? 1 : 0.5 
                            }}>
                              {prodQty > 0 && (
                                <div style={{ fontSize: '10px', color: '#78350F', display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace' }}>
                                  <span>Prod:</span>
                                  <span style={{ fontWeight: 700 }}>+{prodQty.toFixed(1)}</span>
                                </div>
                              )}
                              {stockQty > 0 && (
                                <div style={{ fontSize: '10px', color: '#0F766E', display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace' }}>
                                  <span>Stock:</span>
                                  <span style={{ fontWeight: 700 }}>{stockQty.toFixed(1)}</span>
                                </div>
                              )}
                              {dispatchQty > 0 && (
                                <div style={{ fontSize: '10px', color: '#C2410C', display: 'flex', justifyContent: 'space-between', fontFamily: 'monospace' }}>
                                  <span>Disp:</span>
                                  <span style={{ fontWeight: 700 }}>-{dispatchQty.toFixed(1)}</span>
                                </div>
                              )}
                              {total === 0 && (
                                <div style={{ fontSize: '10px', color: '#94A3B8', fontStyle: 'italic', marginTop: '2px' }}>
                                  No ops
                                </div>
                              )}
                            </div>

                            {/* Indicators Progress Bar */}
                            {total > 0 ? (
                              <div style={{ 
                                display: 'flex', 
                                height: '5px', 
                                width: '100%', 
                                borderRadius: '3px', 
                                overflow: 'hidden', 
                                backgroundColor: '#F1F5F9',
                                marginTop: '6px',
                                opacity: isCurrentMonth ? 1 : 0.4
                              }}>
                                {prodQty > 0 && (
                                  <div style={{ 
                                    width: `${prodWidth}%`, 
                                    backgroundColor: '#E5DEC9', 
                                    height: '100%' 
                                  }} />
                                )}
                                {stockQty > 0 && (
                                  <div style={{ 
                                    width: `${stockWidth}%`, 
                                    backgroundColor: '#BCE3E2', 
                                    height: '100%' 
                                  }} />
                                )}
                                {dispatchQty > 0 && (
                                  <div style={{ 
                                    width: `${dispatchWidth}%`, 
                                    backgroundColor: '#DFB26C', 
                                    height: '100%' 
                                  }} />
                                )}
                              </div>
                            ) : (
                              // Spacer to keep layout alignment consistent
                              <div style={{ height: '5px', marginTop: '6px' }} />
                            )}

                            {/* Quick Edit Button */}
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                startEditing(dateStr, snap);
                              }}
                              className="quick-edit-btn"
                            >
                              Quick Edit
                            </button>

                            {/* Floating Popover Editor Card */}
                            {editingDate === dateStr && (
                              <div 
                                onClick={(e) => e.stopPropagation()}
                                style={{
                                  position: 'absolute',
                                  top: '-15px',
                                  left: dIdx > 4 ? '-130px' : '-10px', // Prevent overflow on rightmost columns
                                  width: '240px',
                                  backgroundColor: '#FFFFFF',
                                  border: '2px solid var(--primary-navy)',
                                  borderRadius: '12px',
                                  boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
                                  padding: '12px',
                                  zIndex: 100,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '10px',
                                  textAlign: 'left'
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #E2E8F0', paddingBottom: '6px' }}>
                                  <strong style={{ fontSize: '12px', color: 'var(--primary-navy)' }}>Edit Planning ({dayNum})</strong>
                                  <button 
                                    onClick={() => setEditingDate(null)}
                                    style={{ border: 'none', background: 'none', color: '#64748B', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}
                                  >
                                    ✕
                                  </button>
                                </div>

                                {/* Production & Stock Form */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Production & Stock</div>
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <div style={{ flex: 1 }}>
                                      <label style={{ fontSize: '9px', color: '#64748B', display: 'block', marginBottom: '2px' }}>Prod Qty</label>
                                      <input 
                                        type="number" 
                                        step="0.1"
                                        value={editProdQty}
                                        onChange={(e) => setEditProdQty(e.target.value)}
                                        style={{ width: '100%', padding: '4px 6px', fontSize: '11px', border: '1px solid #CBD5E1', borderRadius: '4px', boxSizing: 'border-box' }}
                                      />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <label style={{ fontSize: '9px', color: '#64748B', display: 'block', marginBottom: '2px' }}>Purch Qty</label>
                                      <input 
                                        type="number" 
                                        step="0.1"
                                        value={editPurchasedQty}
                                        onChange={(e) => setEditPurchasedQty(e.target.value)}
                                        style={{ width: '100%', padding: '4px 6px', fontSize: '11px', border: '1px solid #CBD5E1', borderRadius: '4px', boxSizing: 'border-box' }}
                                      />
                                    </div>
                                  </div>
                                  <button 
                                    onClick={() => handleSaveEditProduction(dateStr)}
                                    disabled={savingEdit}
                                    style={{
                                      backgroundColor: 'var(--primary-blue)',
                                      color: '#FFFFFF',
                                      border: 'none',
                                      borderRadius: '4px',
                                      padding: '4px 8px',
                                      fontSize: '11px',
                                      fontWeight: 600,
                                      cursor: 'pointer',
                                      alignSelf: 'flex-start',
                                      marginTop: '2px'
                                    }}
                                  >
                                    {savingEdit ? 'Saving...' : 'Save Production'}
                                  </button>
                                </div>

                                <div style={{ borderTop: '1px solid #E2E8F0', marginTop: '4px', paddingTop: '6px' }} />

                                {/* Dispatch Form */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>Log Dispatch</div>
                                  
                                  <div>
                                    <label style={{ fontSize: '9px', color: '#64748B', display: 'block', marginBottom: '2px' }}>Company</label>
                                    <select
                                      value={editDispatchCompanyId}
                                      onChange={(e) => setEditDispatchCompanyId(e.target.value)}
                                      style={{ width: '100%', padding: '4px 6px', fontSize: '11px', border: '1px solid #CBD5E1', borderRadius: '4px', outline: 'none', boxSizing: 'border-box', backgroundColor: '#FFFFFF' }}
                                    >
                                      {companies.map(co => (
                                        <option key={co.id} value={co.id}>{co.name}</option>
                                      ))}
                                      {companies.length === 0 && <option value="">No companies</option>}
                                    </select>
                                  </div>

                                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                                    <div style={{ flex: 1 }}>
                                      <label style={{ fontSize: '9px', color: '#64748B', display: 'block', marginBottom: '2px' }}>Qty (MT)</label>
                                      <input 
                                        type="number" 
                                        step="0.1"
                                        value={editDispatchQty}
                                        onChange={(e) => setEditDispatchQty(e.target.value)}
                                        style={{ width: '100%', padding: '4px 6px', fontSize: '11px', border: '1px solid #CBD5E1', borderRadius: '4px', boxSizing: 'border-box' }}
                                      />
                                    </div>
                                    <button 
                                      onClick={() => handleAddEditDispatch(dateStr)}
                                      disabled={savingEdit}
                                      style={{
                                        backgroundColor: '#235E52',
                                        color: '#FFFFFF',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '4px 8px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        height: '24px'
                                      }}
                                    >
                                      Add Dispatch
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Legend / Footer bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 12px 0 12px', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 500, color: '#64748B' }}>
                  <div style={{ width: '16px', height: '12px', backgroundColor: '#E5DEC9', borderRadius: '2px' }} />
                  <span>Production</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 500, color: '#64748B' }}>
                  <div style={{ width: '16px', height: '12px', backgroundColor: '#BCE3E2', borderRadius: '2px' }} />
                  <span>Stock</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 500, color: '#64748B' }}>
                  <div style={{ width: '16px', height: '12px', backgroundColor: '#DFB26C', borderRadius: '2px' }} />
                  <span>Dispatch (party · qty)</span>
                </div>
              </div>
              <div style={{ fontSize: '12px', color: '#64748B', fontStyle: 'normal' }}>
                Click any day to set it as the log date above.
              </div>
            </div>
          </div>

        </div>
      )}

      {activeTab === 'Dashboard' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            <div className="card" style={{ padding: '16px 20px', border: '1px solid #BAE6FD', backgroundColor: '#F0F9FF' }}>
              <div style={{ fontSize: '11px', color: '#0369A1', textTransform: 'uppercase', fontWeight: 700 }}>Total Ordered</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#0369A1', marginTop: '4px' }}>{totalOrdered.toFixed(1)} MT</div>
            </div>
            
            <div className="card" style={{ padding: '16px 20px', border: '1px solid #A7F3D0', backgroundColor: '#F0FDF4' }}>
              <div style={{ fontSize: '11px', color: '#065F46', textTransform: 'uppercase', fontWeight: 700 }}>Total Delivered</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#065F46', marginTop: '4px' }}>{totalDelivered.toFixed(1)} MT</div>
            </div>

            <div className="card" style={{ padding: '16px 20px', border: '1px solid #FECACA', backgroundColor: '#FEF2F2' }}>
              <div style={{ fontSize: '11px', color: '#991B1B', textTransform: 'uppercase', fontWeight: 700 }}>Total Remaining</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#991B1B', marginTop: '4px' }}>{totalRemaining.toFixed(1)} MT</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">Operational Fulfillment Performance</span>
            </div>
            <div className="card-body" style={{ padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
              <div style={{ fontSize: '14px', color: '#64748B', fontWeight: 600 }}> FULFILLMENT RATE </div>
              <div style={{ fontSize: '48px', fontWeight: 800, color: 'var(--primary-navy)' }}>
                {totalOrdered > 0 ? ((totalDelivered / totalOrdered) * 100).toFixed(1) : '0.0'}%
              </div>
            </div>
          </div>

        </div>
      )}

      {activeTab === 'Parties & PO' && (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-header" style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0' }}>
            <span className="card-title" style={{ fontSize: '13px', fontWeight: 600 }}>Customer Orders & Fulfillment ({selectedSubTab})</span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                    <th style={{ padding: '10px 16px', fontSize: '11px', fontWeight: 600, color: '#64748B', textAlign: 'left' }}>Customers</th>
                    <th style={{ padding: '10px 16px', fontSize: '11px', fontWeight: 600, color: '#64748B', textAlign: 'right' }}>Quantity Ordered (MT)</th>
                    <th style={{ padding: '10px 16px', fontSize: '11px', fontWeight: 600, color: '#64748B', textAlign: 'right' }}>Delivered (MT)</th>
                    <th style={{ padding: '10px 16px', fontSize: '11px', fontWeight: 600, color: '#64748B', textAlign: 'right' }}>Remaining (MT)</th>
                  </tr>
                </thead>
                <tbody>
                  {customerRows.map((row, idx) => {
                    const remaining = row.ordered - row.delivered;
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '10px 16px', fontSize: '12px', fontWeight: 600, color: '#1E293B' }}>{row.company}</td>
                        <td style={{ padding: '10px 16px', fontSize: '12px', textAlign: 'right', fontWeight: 500 }} className="mono">{row.ordered.toFixed(1)}</td>
                        <td style={{ padding: '10px 16px', fontSize: '12px', textAlign: 'right', fontWeight: 500, color: '#16A34A' }} className="mono">{row.delivered.toFixed(1)}</td>
                        <td style={{ padding: '10px 16px', fontSize: '12px', textAlign: 'right', fontWeight: 600, color: remaining > 0 ? '#DC2626' : '#1E293B' }} className="mono">{remaining.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                  {customerRows.length === 0 && (
                    <tr>
                      <td colSpan="4" style={{ padding: '24px', textAlign: 'center', color: '#94A3B8', fontSize: '12px', fontStyle: 'italic' }}>
                        No customer orders recorded for {selectedSubTab} in {selectedMonth}
                      </td>
                    </tr>
                  )}
                </tbody>
                {customerRows.length > 0 && (
                  <tfoot>
                    <tr style={{ backgroundColor: '#F8FAFC', borderTop: '2px solid #E2E8F0', fontWeight: 700 }}>
                      <td style={{ padding: '12px 16px', fontSize: '12px', color: '#1E293B' }}>SUM</td>
                      <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'right' }} className="mono">{totalOrdered.toFixed(1)}</td>
                      <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'right', color: '#16A34A' }} className="mono">{totalDelivered.toFixed(1)}</td>
                      <td style={{ padding: '12px 16px', fontSize: '12px', textAlign: 'right', color: totalRemaining > 0 ? '#DC2626' : '#1E293B' }} className="mono">{totalRemaining.toFixed(1)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Products' && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Chemical Product Information</span>
          </div>
          <div className="card-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {products.map(prod => (
              <div key={prod}>
                <strong>{prod}:</strong> Active chemical solvent catalog item registered in database.
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Company Popup Modal */}
      {showAddCompany && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '400px', backgroundColor: '#FFFFFF', padding: '20px', borderRadius: '8px', border: '1px solid #CBD5E1' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '12px', borderBottom: '1px solid #E2E8F0', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--primary-navy)' }}>Add New Company</h3>
              <button 
                onClick={() => setShowAddCompany(false)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '16px', color: '#94A3B8' }}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreateCompany} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="form-group">
                <label style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Company Name</label>
                <input 
                  type="text" 
                  value={newCompanyName} 
                  onChange={(e) => setNewCompanyName(e.target.value)} 
                  style={{ padding: '6px 10px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '4px', width: '100%' }}
                  placeholder="e.g. Acme Chemicals"
                  required
                />
              </div>

              <div className="form-group">
                <label style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Tier</label>
                <select 
                  value={newCompanyTier} 
                  onChange={(e) => setNewCompanyTier(e.target.value)}
                  style={{ padding: '6px 10px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '4px', width: '100%', outline: 'none' }}
                >
                  <option value="A">Tier A</option>
                  <option value="B">Tier B</option>
                  <option value="C">Tier C</option>
                </select>
              </div>

              <div className="form-group">
                <label style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Primary Product</label>
                <select 
                  value={newCompanyProduct} 
                  onChange={(e) => setNewCompanyProduct(e.target.value)}
                  style={{ padding: '6px 10px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '4px', width: '100%', outline: 'none' }}
                >
                  {products.map(prod => (
                    <option key={prod} value={prod}>{prod}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => setShowAddCompany(false)}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={submittingCompany}
                >
                  Save Company
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        .calendar-cell {
          transition: background-color 0.15s ease, transform 0.15s ease;
        }
        .calendar-cell:hover {
          background-color: #F8FAF9 !important;
        }
        .calendar-cell.selected {
          background-color: #DCEFEA !important;
        }
        .calendar-cell.selected:hover {
          background-color: #D1E5E0 !important;
        }
        .nav-arrow-btn:hover {
          background-color: var(--primary-navy-hover) !important;
        }
        .quick-edit-btn {
          display: none;
          position: absolute;
          bottom: 6px;
          right: 6px;
          background-color: var(--primary-navy);
          color: #FFFFFF;
          border: none;
          border-radius: 4px;
          padding: 3px 8px;
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
          z-index: 5;
        }
        .calendar-cell:hover .quick-edit-btn,
        .calendar-cell.selected .quick-edit-btn {
          display: block;
        }
        .quick-edit-btn:hover {
          background-color: var(--primary-navy-hover);
        }
      `}</style>
    </div>
  );
}
