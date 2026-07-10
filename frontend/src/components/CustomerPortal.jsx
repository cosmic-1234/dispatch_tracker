import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  FileText, 
  Truck, 
  Bell, 
  LogOut, 
  Clock, 
  ArrowLeft, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle2, 
  Download,
  Menu,
  ChevronLeft,
  ChevronRight,
  Package
} from 'lucide-react';
import shaktiLogo from '../assets/shakti_logo.png';

// Utility helper to format dates from yyyy-mm-dd to dd-mm-yyyy
export function formatDate(dateStr) {
  if (!dateStr) return '';
  const str = String(dateStr);
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})([\sT](.*))?$/);
  if (match) {
    const timePart = match[5] ? ' ' + match[5].slice(0, 5) : '';
    return `${match[3]}-${match[2]}-${match[1]}${timePart}`;
  }
  return str;
}

// public-facing statuses translation
const STATUS_TRANSLATIONS = {
  Received: "Awaiting allocation",
  'Partially Allocated': "Partially scheduled",
  'Fully Allocated': "Scheduled for dispatch",
  Dispatched: "Dispatched",
  Closed: "Completed"
};

const STATUS_BADGE_CLASSES = {
  Received: "badge received",
  'Partially Allocated': "badge partially-allocated",
  'Fully Allocated': "badge fully-allocated",
  Dispatched: "badge dispatched",
  Closed: "badge closed"
};

const COMMITMENT_STATUS_STYLE = {
  Honored:      { bg: '#D1FAE5', color: '#065F46', border: '#A7F3D0' },
  Missed:       { bg: '#FEE2E2', color: '#991B1B', border: '#FECACA' },
  Renegotiated: { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
  Pending:      { bg: '#EFF6FF', color: '#1E40AF', border: '#BFDBFE' },
};

function StatusChip({ status }) {
  const display = STATUS_TRANSLATIONS[status] || status || 'Pending';
  let badgeClass = "badge received";
  if (status === 'Closed' || status === 'Completed') badgeClass = "badge closed";
  else if (status === 'Dispatched') badgeClass = "badge executed";
  else if (status === 'Fully Allocated') badgeClass = "badge planned";
  else if (status === 'Partially Allocated') badgeClass = "badge onhold";
  
  return <span className={badgeClass}>{display}</span>;
}

function CommitmentChip({ status }) {
  const s = COMMITMENT_STATUS_STYLE[status] || { bg: '#F1F5F9', color: '#64748B', border: '#CBD5E1' };
  return (
    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {status}
    </span>
  );
}

// ─── LOGIN SCREEN ────────────────────────────────────────────────────────────
function LoginScreen({ API_BASE, onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    fetch(`${API_BASE}/customer/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
      .then(r => r.json())
      .then(d => {
        setLoading(false);
        if (d.success) { onLogin(d.user); }
        else { setError(d.error || 'Login failed.'); }
      })
      .catch(e => { setLoading(false); setError(e.message); });
  };

  return (
    <div style={{
      minHeight: '100vh', background: 'linear-gradient(135deg, #1C2B4A 0%, #354A5F 60%, #1C2B4A 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-sans)'
    }}>
      <div style={{ width: '380px' }}>
        {/* Logo / Brand */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '16px', backgroundColor: '#FFFFFF',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}>
            <img src={shaktiLogo} alt="Shakti Logo" style={{ height: '36px', width: 'auto', objectFit: 'contain' }} />
          </div>
          <h1 style={{ margin: 0, color: 'white', fontSize: '20px', fontWeight: 700, letterSpacing: '0.5px' }}>SHAKTI SCM</h1>
          <p style={{ margin: '4px 0 0', color: '#A0B2C6', fontSize: '12px' }}>Customer Self-Service Portal</p>
        </div>

        {/* Card */}
        <div style={{ background: '#FFFFFF', border: '1px solid var(--border-color)', borderRadius: '6px',
          padding: '28px', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
          <h2 style={{ color: 'var(--text-primary)', margin: '0 0 20px', fontSize: '15px', fontWeight: 600, borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>Sign In to Your Account</h2>
          
          {error && (
            <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', borderRadius: '4px', padding: '8px 12px',
              color: '#DC2626', fontSize: '11px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={12} /> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="form-group">
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} required
                placeholder="Enter username" style={{ width: '100%', height: '32px' }} />
            </div>
            <div className="form-group">
              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                placeholder="Enter password" style={{ width: '100%', height: '32px' }} />
            </div>
            <button type="submit" disabled={loading} className="btn btn-primary"
              style={{ width: '100%', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '6px' }}>
              {loading ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Signing in...</> : 'Sign In'}
            </button>
          </form>
        </div>

        <p style={{ color: '#A0B2C6', fontSize: '11px', textAlign: 'center', marginTop: '20px' }}>
          Access provided by Shakti SCM. Contact your account manager for credentials.
        </p>
      </div>
    </div>
  );
}

// ─── CUSTOMER SIDEBAR ────────────────────────────────────────────────────────
function CustomerSidebar({ user, activeModule, setActiveModule, onLogout, collapsed, setCollapsed }) {
  const getInitials = (name) => {
    if (!name) return 'C';
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        {!collapsed ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
              <img src={shaktiLogo} alt="Shakti Logo" style={{ height: '22px', width: 'auto', objectFit: 'contain' }} />
              <h2>SHAKTI SCM</h2>
            </div>
            <button className="sidebar-collapse-btn" onClick={() => setCollapsed(true)} title="Collapse Menu">
              <Menu size={16} />
            </button>
          </>
        ) : (
          <>
            <button className="sidebar-collapse-btn" onClick={() => setCollapsed(false)} title="Expand Menu">
              <Menu size={16} />
            </button>
          </>
        )}
      </div>

      <nav className="sidebar-nav">
        {!collapsed && <div className="sidebar-section-label">CUSTOMER PORTAL</div>}
        <a className={`nav-item ${activeModule === 'orders' ? 'active' : ''}`} onClick={() => setActiveModule('orders')}>
          <LayoutDashboard size={20} />
          <span className="nav-label">My Orders</span>
        </a>
        <a className={`nav-item ${activeModule === 'history' ? 'active' : ''}`} onClick={() => setActiveModule('history')}>
          <Truck size={20} />
          <span className="nav-label">Dispatch History</span>
        </a>
        <a className={`nav-item ${activeModule === 'notifications' ? 'active' : ''}`} onClick={() => setActiveModule('notifications')}>
          <Bell size={20} />
          <span className="nav-label">Notifications</span>
        </a>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-avatar-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="sidebar-avatar">{getInitials(user.full_name || user.username)}</div>
          {!collapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span className="sidebar-user-name" style={{ fontSize: '11px', color: '#FFFFFF', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.full_name || user.username}
              </span>
              <span style={{ fontSize: '10px', color: '#8AAAC8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.company_name}
              </span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {!collapsed && (
            <button className="sidebar-logout-btn" onClick={onLogout} title="Sign Out">
              <LogOut size={16} />
            </button>
          )}
          <button className="sidebar-bottom-toggle" onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expand Menu" : "Collapse Menu"}>
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </div>
    </aside>
  );
}

// ─── SCREEN 1: MY ORDERS ─────────────────────────────────────────────────────
function OrderListTab({ orders, loading, onSelectOrder }) {
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '8px' }}>
        <RefreshCw size={16} style={{ animation: 'spin 1.5s linear infinite' }} /> Loading orders...
      </div>
    );
  }

  const filtered = orders.filter(po => {
    const matchesStatus = statusFilter === 'All' || po.status === statusFilter;
    const matchesSearch = po.id.toLowerCase().includes(search.toLowerCase()) || 
                          (po.items || []).some(i => i.product_type.toLowerCase().includes(search.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Search & Filter Toolbar */}
      <div className="card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input 
              type="text" 
              placeholder="Search Order ID / Product..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '220px', height: '32px' }}
            />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ height: '32px', padding: '4px 8px' }}>
              <option value="All">All Statuses</option>
              {Object.keys(STATUS_TRANSLATIONS).map(st => (
                <option key={st} value={st}>{STATUS_TRANSLATIONS[st]}</option>
              ))}
            </select>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 500 }}>
            Showing {filtered.length} of {orders.length} orders
          </span>
        </div>
      </div>

      {/* Grid Table */}
      <div className="card card-table-container" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="table-wrapper">
          <table className="sap-table">
            <thead>
              <tr>
                <th>Order Reference</th>
                <th>Products Ordered</th>
                <th>Date Received</th>
                <th>Total Qty</th>
                <th>Dispatched Qty</th>
                <th>Pending Qty</th>
                <th>Expected Date</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(po => {
                const totalQty = (po.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
                const allocatedQty = (po.items || []).reduce((s, i) => s + (i.allocated_quantity || 0), 0);
                const pendingQty = Math.max(0, totalQty - allocatedQty);
                return (
                  <tr key={po.id}>
                    <td className="mono" style={{ fontWeight: 600 }}>{po.id}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {(po.items || []).map(i => (
                          <span key={i.product_type} style={{ fontSize: '10px', backgroundColor: '#F1F5F9', border: '1px solid #E2E8F0', padding: '1px 4px', borderRadius: '2px' }}>
                            {i.product_type} ({parseFloat(i.quantity).toFixed(1)} MT)
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{formatDate(po.date_received)}</td>
                    <td className="mono">{totalQty.toFixed(1)} MT</td>
                    <td className="mono" style={{ color: '#16A34A', fontWeight: 600 }}>{allocatedQty.toFixed(1)} MT</td>
                    <td className="mono" style={{ color: pendingQty > 0 ? '#0A6ED1' : 'inherit' }}>{pendingQty.toFixed(1)} MT</td>
                    <td className="mono" style={{ fontWeight: 500, color: po.commitment_status === 'Missed' ? '#BB0000' : 'inherit' }}>
                      {po.committed_dispatch_date ? formatDate(po.committed_dispatch_date) : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <StatusChip status={po.status} />
                        {po.commitment_status && <CommitmentChip status={po.commitment_status} />}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={() => onSelectOrder(po.id)}>
                        Inspect
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>No orders found matching filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── SCREEN 2: DISPATCH HISTORY ──────────────────────────────────────────────
function DispatchHistoryTab({ orders, loading }) {
  const [productFilter, setProductFilter] = useState('All');
  const [search, setSearch] = useState('');

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '8px' }}>
        <RefreshCw size={16} style={{ animation: 'spin 1.5s linear infinite' }} /> Loading dispatches...
      </div>
    );
  }

  // Extract all dispatches
  const dispatches = [];
  orders.forEach(po => {
    (po.dispatches || []).forEach(d => {
      dispatches.push({
        po_id: po.id,
        vehicle_id: d.vehicle_id,
        planned_dispatch_date: d.planned_dispatch_date,
        actual_dispatch_date: d.actual_dispatch_date,
        quantity: d.quantity,
        status: d.status,
        product_type: d.product_type || (po.items?.[0]?.product_type || 'Acetone')
      });
    });
  });

  // Sort chronological (newest actual or planned date first)
  dispatches.sort((a, b) => {
    const dateA = a.actual_dispatch_date || a.planned_dispatch_date || '';
    const dateB = b.actual_dispatch_date || b.planned_dispatch_date || '';
    return dateB.localeCompare(dateA);
  });

  const filtered = dispatches.filter(d => {
    const matchesProduct = productFilter === 'All' || d.product_type === productFilter;
    const matchesSearch = d.po_id.toLowerCase().includes(search.toLowerCase()) || 
                          d.vehicle_id.toLowerCase().includes(search.toLowerCase());
    return matchesProduct && matchesSearch;
  });

  const handleExportCSV = () => {
    let csv = 'Date,PO Reference,Product,Quantity (MT),Vehicle/Run,Status\n';
    filtered.forEach(d => {
      csv += `${d.actual_dispatch_date || d.planned_dispatch_date},${d.po_id},${d.product_type},${d.quantity},${d.vehicle_id},${d.status}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.setAttribute("download", `dispatch_history_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input 
              type="text" 
              placeholder="Search PO / Run ID..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '220px', height: '32px' }}
            />
            <select value={productFilter} onChange={e => setProductFilter(e.target.value)} style={{ height: '32px', padding: '4px 8px' }}>
              <option value="All">All Products</option>
              {['Acetone', 'Benzene', 'DEP', 'Ethyl Acetate', 'Retarder', 'Toluene'].map(prod => (
                <option key={prod} value={prod}>{prod}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }} onClick={handleExportCSV}>
            <Download size={14} /> Export to CSV
          </button>
        </div>
      </div>

      <div className="card card-table-container" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="table-wrapper">
          <table className="sap-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>PO Reference</th>
                <th>Product</th>
                <th>Quantity Dispatched</th>
                <th>Run ID</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d, idx) => (
                <tr key={idx}>
                  <td className="mono" style={{ fontWeight: 500 }}>{formatDate(d.actual_dispatch_date || d.planned_dispatch_date)}</td>
                  <td className="mono">{d.po_id}</td>
                  <td><strong>{d.product_type}</strong></td>
                  <td className="mono" style={{ fontWeight: 600 }}>{parseFloat(d.quantity).toFixed(1)} MT</td>
                  <td className="mono">{d.vehicle_id}</td>
                  <td>
                    <span className={`badge ${d.status === 'Executed' ? 'executed' : d.status === 'Planned' ? 'planned' : 'closed'}`}>
                      {d.status}
                    </span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>No dispatches logged yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── SCREEN 3: NOTIFICATIONS ─────────────────────────────────────────────────
function NotificationsTab({ orders, loading }) {
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '8px' }}>
        <RefreshCw size={16} style={{ animation: 'spin 1.5s linear infinite' }} /> Loading notifications...
      </div>
    );
  }

  // Derive notifications dynamically
  const notifications = [];

  orders.forEach(po => {
    // 1. Dispatch execution notifications
    (po.dispatches || []).forEach(d => {
      if (d.status === 'Executed' && d.actual_dispatch_date) {
        notifications.push({
          po_id: po.id,
          timestamp: d.actual_dispatch_date + ' 10:00:00', // mock time for ordering
          text: `Your order ${po.id} for ${parseFloat(d.quantity).toFixed(1)} MT ${d.product_type || 'material'} has been dispatched on ${formatDate(d.actual_dispatch_date)}.`,
          type: 'dispatch',
          date: d.actual_dispatch_date
        });
      }
    });

    // 2. Expected dispatch date renegotiated notifications
    (po.commitment_history || []).forEach(h => {
      if (h.status === 'Renegotiated' && h.committed_date) {
        notifications.push({
          po_id: po.id,
          timestamp: h.timestamp || (po.date_received + ' 12:00:00'),
          text: `Your expected dispatch date for order ${po.id} has been updated to ${formatDate(h.committed_date)}.`,
          type: 'update',
          date: h.committed_date
        });
      }
    });

    // 3. Partial fulfillment check
    const totalOrdered = (po.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
    const totalDispatched = (po.items || []).reduce((s, i) => s + (i.allocated_quantity || 0), 0);
    if (totalDispatched > 0 && totalDispatched < totalOrdered) {
      notifications.push({
        po_id: po.id,
        timestamp: po.date_received + ' 17:00:00',
        text: `Your order ${po.id} has been partially fulfilled — ${totalDispatched.toFixed(1)} MT dispatched, ${(totalOrdered - totalDispatched).toFixed(1)} MT pending.`,
        type: 'partial',
        date: po.committed_dispatch_date || po.date_received
      });
    }
  });

  // Sort by timestamp descending
  notifications.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="card" style={{ padding: '12px 16px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--primary-navy)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>System Notifications Feed</h3>
      </div>

      {notifications.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
          <Bell size={24} style={{ opacity: 0.5, marginBottom: '8px' }} />
          <div>No notifications received yet.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {notifications.map((n, idx) => (
            <div key={idx} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: '12px',
              borderLeft: n.type === 'dispatch' ? '4px solid #107E3E' : n.type === 'update' ? '4px solid #0A6ED1' : '4px solid #D04900' }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>{n.text}</p>
                <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '10px', color: 'var(--text-muted)' }}>
                  <span>PO Reference: <strong className="mono">{n.po_id}</strong></span>
                  <span>Logged: {formatDate(n.timestamp)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SCREEN 4: ORDER DETAILS VIEW ────────────────────────────────────────────
function OrderDetailTab({ API_BASE, user, poId, onBack }) {
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/customer/orders/${user.company_id}/${poId}`)
      .then(r => r.json())
      .then(d => { setPo(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [poId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '8px' }}>
        <RefreshCw size={16} style={{ animation: 'spin 1.5s linear infinite' }} /> Loading order specifications...
      </div>
    );
  }

  if (!po) return <div className="card" style={{ padding: '24px', color: '#BB0000' }}>Order not found.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header back button */}
      <div>
        <button className="btn btn-secondary" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '6px' }} onClick={onBack}>
          <ArrowLeft size={14} /> Back to My Orders
        </button>
      </div>

      {/* PO Specification Overview */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '12px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--primary-navy)' }}>Order Spec: <span className="mono">{po.id}</span></h3>
            <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '11px' }}>Received Date: <strong>{formatDate(po.date_received)}</strong></p>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <StatusChip status={po.status} />
            {po.commitment_status && <CommitmentChip status={po.commitment_status} />}
          </div>
        </div>

        {po.committed_dispatch_date && (
          <div style={{ background: '#EFF6FC', border: '1px solid #A3D1FF', borderRadius: '4px', padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            <Clock size={14} color="#0A6ED1" />
            <span style={{ color: 'var(--text-secondary)' }}>Committed Dispatch Date:</span>
            <strong style={{ color: po.commitment_status === 'Missed' ? '#BB0000' : 'var(--text-primary)' }}>{formatDate(po.committed_dispatch_date)}</strong>
          </div>
        )}
        {po.notes && (
          <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-secondary)', fontStyle: 'italic', borderLeft: '3px solid var(--border-color)', paddingLeft: '8px' }}>
            Customer Notes: {po.notes}
          </div>
        )}
      </div>

      {/* Line Items Matrix */}
      <div className="card card-table-container" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="card-header" style={{ padding: '10px 16px' }}>
          <span className="card-title" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Order Line Items</span>
        </div>
        <div className="table-wrapper">
          <table className="sap-table">
            <thead>
              <tr>
                <th>Product Type</th>
                <th>Ordered Quantity (MT)</th>
                <th>Dispatched Quantity (MT)</th>
                <th>Pending Quantity (MT)</th>
              </tr>
            </thead>
            <tbody>
              {(po.items || []).map(item => {
                const pending = Math.max(0, item.quantity - item.allocated_quantity);
                return (
                  <tr key={item.id}>
                    <td><strong>{item.product_type}</strong></td>
                    <td className="mono">{parseFloat(item.quantity).toFixed(1)} MT</td>
                    <td className="mono" style={{ color: '#16A34A', fontWeight: 600 }}>{parseFloat(item.allocated_quantity || 0).toFixed(1)} MT</td>
                    <td className="mono" style={{ color: pending > 0 ? '#0A6ED1' : 'inherit' }}>{pending.toFixed(1)} MT</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Linked Dispatches */}
      <div className="card card-table-container" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="card-header" style={{ padding: '10px 16px' }}>
          <span className="card-title" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Scheduled Dispatches</span>
        </div>
        <div className="table-wrapper">
          <table className="sap-table">
            <thead>
              <tr>
                <th>Run ID / Vehicle</th>
                <th>Product</th>
                <th>Quantity</th>
                <th>Planned Dispatch Date</th>
                <th>Actual Dispatch Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(po.dispatches || []).map((d, i) => (
                <tr key={i}>
                  <td className="mono" style={{ fontWeight: 600 }}>{d.vehicle_id}</td>
                  <td><strong>{d.product_type || '—'}</strong></td>
                  <td className="mono">{parseFloat(d.quantity).toFixed(1)} MT</td>
                  <td>{formatDate(d.planned_dispatch_date)}</td>
                  <td style={{ color: d.actual_dispatch_date ? '#16A34A' : 'var(--text-muted)' }}>{d.actual_dispatch_date ? formatDate(d.actual_dispatch_date) : 'Pending'}</td>
                  <td>
                    <span className={`badge ${d.status === 'Executed' ? 'executed' : d.status === 'Planned' ? 'planned' : 'closed'}`}>
                      {d.status}
                    </span>
                  </td>
                </tr>
              ))}
              {(!po.dispatches || po.dispatches.length === 0) && (
                <tr>
                  <td colSpan="6" style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)' }}>No dispatches scheduled yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Commitment History */}
      {po.committed_dispatch_date && (po.commitment_history || []).length > 0 && (
        <div className="card card-table-container" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="card-header" style={{ padding: '10px 16px' }}>
            <span className="card-title" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Commitment History Audit Trail</span>
          </div>
          <div style={{ padding: '16px' }}>
            {po.commitment_history.map((h, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: i < po.commitment_history.length - 1 ? '14px' : 0 }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', marginTop: '4px', flexShrink: 0,
                  background: h.status === 'Honored' ? '#107E3E' : h.status === 'Missed' ? '#BB0000' : h.status === 'Renegotiated' ? '#D04900' : '#0A6ED1' }} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                    <CommitmentChip status={h.status} />
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{h.timestamp ? formatDate(h.timestamp) : ''}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-secondary)' }}>{h.reason}</p>
                  {h.committed_date && <p style={{ margin: '2px 0 0', fontSize: '10px', color: 'var(--text-muted)' }}>Committed dispatch target date: {formatDate(h.committed_date)}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN PORTAL ─────────────────────────────────────────────────────────────
export default function CustomerPortal({ API_BASE }) {
  const [user, setUser] = useState(null);
  const [activeModule, setActiveModule] = useState('orders'); // 'orders' | 'history' | 'notifications'
  const [selectedPoId, setSelectedPoId] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [systemDate, setSystemDate] = useState('2026-06-29');

  const triggerRefresh = () => setRefreshTrigger(prev => prev + 1);

  // Load orders when company is authenticated
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    // Fetch orders
    fetch(`${API_BASE}/customer/orders/${user.company_id}`)
      .then(r => r.json())
      .then(d => { setOrders(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
      
    // Fetch Simulated SCM date
    fetch(`${API_BASE}/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.system_date) setSystemDate(data.system_date);
      })
      .catch(err => console.error(err));
  }, [user, refreshTrigger]);

  const handleLogin = (userData) => setUser(userData);
  const handleLogout = () => { setUser(null); setSelectedPoId(null); setActiveModule('orders'); };

  if (!user) return <LoginScreen API_BASE={API_BASE} onLogin={handleLogin} />;

  return (
    <div className="app-container">
      {/* Sidebar navigation */}
      <CustomerSidebar 
        user={user} 
        activeModule={activeModule} 
        setActiveModule={(m) => { setActiveModule(m); setSelectedPoId(null); }} 
        onLogout={handleLogout}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      {/* Main workspace */}
      <div className="main-wrapper">
        {/* Top Header */}
        <header className="top-header">
          <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src={shaktiLogo} alt="Shakti Logo" style={{ height: '24px', width: 'auto', objectFit: 'contain' }} />
            <h1 style={{ textTransform: 'uppercase' }}>SHAKTI CUSTOMER PORTAL</h1>
            <span className="badge" style={{ backgroundColor: '#EFF3F6', border: '1px solid #D9D9D9', color: '#32363A', textTransform: 'none', display: 'flex', gap: '6px' }}>
              <Clock size={12} color="#515559" />
              <span>Simulated Date: <strong>{formatDate(systemDate)}</strong></span>
            </span>
          </div>

          <div className="header-controls">
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: '11px', lineHeight: 1.2, color: 'var(--text-secondary)', marginRight: '8px' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user.full_name || user.username}</span>
              <span>{user.company_name} (Tier {user.company_tier})</span>
            </div>
            <button className="btn btn-secondary" style={{ padding: '6px 10px', height: '32px' }} onClick={triggerRefresh} title="Sync Portal Data">
              <RefreshCw size={14} />
            </button>
          </div>
        </header>

        {/* Content area */}
        <main className="content-area" style={{ flex: 1, padding: '16px', overflowY: 'auto' }}>
          {selectedPoId ? (
            <OrderDetailTab 
              API_BASE={API_BASE} 
              user={user} 
              poId={selectedPoId} 
              onBack={() => setSelectedPoId(null)} 
            />
          ) : (
            <>
              {activeModule === 'orders' && <OrderListTab orders={orders} loading={loading} onSelectOrder={setSelectedPoId} />}
              {activeModule === 'history' && <DispatchHistoryTab orders={orders} loading={loading} />}
              {activeModule === 'notifications' && <NotificationsTab orders={orders} loading={loading} />}
            </>
          )}
        </main>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
