import React, { useState, useEffect } from 'react';
import { Package, Truck, Clock, AlertTriangle, CheckCircle2, RefreshCw, LogOut, ChevronRight, ArrowLeft } from 'lucide-react';

const COMMITMENT_STATUS_STYLE = {
  Honored:      { bg: '#D1FAE5', color: '#065F46', border: '#A7F3D0' },
  Missed:       { bg: '#FEE2E2', color: '#991B1B', border: '#FECACA' },
  Renegotiated: { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
  Pending:      { bg: '#EFF6FF', color: '#1E40AF', border: '#BFDBFE' },
};

const PO_STATUS_STYLE = {
  Received:          { bg: '#F0F4FF', color: '#2563EB', border: '#BFDBFE' },
  'Partially Allocated': { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' },
  'Fully Allocated': { bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
  Dispatched:        { bg: '#D1FAE5', color: '#065F46', border: '#A7F3D0' },
  Closed:            { bg: '#F1F5F9', color: '#475569', border: '#CBD5E1' },
};

function StatusChip({ status, styleMap }) {
  const s = (styleMap || {})[status] || { bg: '#F1F5F9', color: '#64748B', border: '#CBD5E1' };
  return (
    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {status || '—'}
    </span>
  );
}

// ─── Login Screen ────────────────────────────────────────────────────────────
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
      minHeight: '100vh', background: 'linear-gradient(135deg, #0F172A 0%, #1E3A5F 60%, #0F172A 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      <div style={{ width: '380px' }}>
        {/* Logo / Brand */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ width: '56px', height: '56px', borderRadius: '14px', background: 'linear-gradient(135deg, #3B82F6, #1D4ED8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', boxShadow: '0 8px 24px rgba(59,130,246,0.4)' }}>
            <Package size={28} color="white" />
          </div>
          <h1 style={{ margin: 0, color: 'white', fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px' }}>SHAKTI SCM</h1>
          <p style={{ margin: '6px 0 0', color: '#94A3B8', fontSize: '13px' }}>Customer Self-Service Portal</p>
        </div>

        {/* Card */}
        <div style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '16px',
          padding: '32px', backdropFilter: 'blur(12px)' }}>
          <h2 style={{ color: 'white', margin: '0 0 24px', fontSize: '16px', fontWeight: 700 }}>Sign In to Your Account</h2>
          
          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '6px', padding: '10px 12px',
              color: '#DC2626', fontSize: '12px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={13} /> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ color: '#94A3B8', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>Username</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} required
                style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '8px', color: 'white', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
                placeholder="Enter username" />
            </div>
            <div>
              <label style={{ color: '#94A3B8', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                style={{ width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '8px', color: 'white', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
                placeholder="Enter password" />
            </div>
            <button type="submit" disabled={loading}
              style={{ padding: '12px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '8px',
                fontSize: '13px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                opacity: loading ? 0.7 : 1 }}>
              {loading ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Signing in...</> : 'Sign In'}
            </button>
          </form>
        </div>

        <p style={{ color: '#475569', fontSize: '11px', textAlign: 'center', marginTop: '20px' }}>
          Access provided by your account manager. Contact Shakti SCM for portal credentials.
        </p>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Order List Screen ────────────────────────────────────────────────────────
function OrderList({ API_BASE, user, onSelectOrder }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/customer/orders/${user.company_id}`)
      .then(r => r.json())
      .then(d => { setOrders(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', color: '#94A3B8', gap: '8px' }}>
      <RefreshCw size={16} style={{ animation: 'spin 1.5s linear infinite' }} /> Loading your orders...
    </div>
  );

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#1E293B' }}>My Orders</h2>
        <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#64748B' }}>{orders.length} total orders for {user.company_name || 'your account'}</p>
      </div>

      {orders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94A3B8' }}>
          <Package size={32} style={{ marginBottom: '12px', opacity: 0.5 }} />
          <p>No orders found.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {orders.map(po => {
            const totalQty = (po.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
            const allocatedQty = (po.items || []).reduce((s, i) => s + (i.allocated_quantity || 0), 0);
            return (
              <div key={po.id} onClick={() => onSelectOrder(po.id)}
                style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '16px 20px',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  transition: 'box-shadow 0.15s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1E293B', fontSize: '13px' }}>{po.id}</span>
                    <StatusChip status={po.status} styleMap={PO_STATUS_STYLE} />
                    {po.commitment_status && <StatusChip status={po.commitment_status} styleMap={COMMITMENT_STATUS_STYLE} />}
                  </div>
                  <div style={{ fontSize: '11px', color: '#64748B', display: 'flex', gap: '16px' }}>
                    <span>Received: {po.date_received}</span>
                    {po.committed_dispatch_date && <span style={{ color: po.commitment_status === 'Missed' ? '#EF4444' : '#475569' }}>
                      Committed: {po.committed_dispatch_date}
                    </span>}
                    <span>{(po.items || []).map(i => i.product_type).join(', ')}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div style={{ textAlign: 'right', fontSize: '11px', color: '#64748B' }}>
                    <div style={{ fontWeight: 700, color: '#1E293B', fontSize: '13px' }}>{totalQty.toFixed(1)} MT</div>
                    <div>{allocatedQty.toFixed(1)} MT allocated</div>
                  </div>
                  <ChevronRight size={16} color="#94A3B8" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Order Detail Screen ──────────────────────────────────────────────────────
function OrderDetail({ API_BASE, user, poId, onBack }) {
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/customer/orders/${user.company_id}/${poId}`)
      .then(r => r.json())
      .then(d => { setPo(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [poId]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', color: '#94A3B8', gap: '8px' }}>
      <RefreshCw size={16} style={{ animation: 'spin 1.5s linear infinite' }} />
    </div>
  );

  if (!po) return <div style={{ padding: '24px', color: '#EF4444' }}>Order not found.</div>;

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: '#3B82F6', fontSize: '12px', fontWeight: 600, padding: 0 }}>
        <ArrowLeft size={14} /> Back to My Orders
      </button>

      {/* Header */}
      <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: '10px', padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#1E293B', fontFamily: 'monospace' }}>{po.id}</h2>
            <p style={{ margin: '4px 0 0', color: '#64748B', fontSize: '12px' }}>Received on {po.date_received}</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <StatusChip status={po.status} styleMap={PO_STATUS_STYLE} />
            {po.commitment_status && <StatusChip status={po.commitment_status} styleMap={COMMITMENT_STATUS_STYLE} />}
          </div>
        </div>
        {po.committed_dispatch_date && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px',
            display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            <Clock size={13} color="#3B82F6" />
            <span style={{ color: '#475569' }}>Committed Dispatch Date:</span>
            <strong style={{ color: po.commitment_status === 'Missed' ? '#DC2626' : '#1E293B' }}>{po.committed_dispatch_date}</strong>
          </div>
        )}
        {po.notes && <p style={{ margin: '12px 0 0', fontSize: '12px', color: '#64748B', fontStyle: 'italic' }}>{po.notes}</p>}
      </div>

      {/* Line Items */}
      <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: '10px', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
          <span style={{ fontWeight: 700, fontSize: '12px', color: '#1E293B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Order Line Items</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ background: '#F8FAFC' }}>
              {['Product', 'Ordered (MT)', 'Allocated (MT)', 'Pending (MT)'].map(h => (
                <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(po.items || []).map(item => {
              const pending = item.quantity - item.allocated_quantity;
              return (
                <tr key={item.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '10px 14px', fontWeight: 600, color: '#1E293B' }}>{item.product_type}</td>
                  <td style={{ padding: '10px 14px', color: '#334155' }}>{parseFloat(item.quantity).toFixed(2)}</td>
                  <td style={{ padding: '10px 14px', color: '#059669', fontWeight: 600 }}>{parseFloat(item.allocated_quantity || 0).toFixed(2)}</td>
                  <td style={{ padding: '10px 14px', color: pending > 0 ? '#F59E0B' : '#10B981', fontWeight: 600 }}>{pending.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Dispatch Schedule */}
      {(po.dispatches || []).length > 0 && (
        <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Truck size={13} color="#3B82F6" />
            <span style={{ fontWeight: 700, fontSize: '12px', color: '#1E293B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Dispatch Schedule</span>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                {['Vehicle', 'Product', 'Qty (MT)', 'Planned Date', 'Actual Date', 'Status'].map(h => (
                  <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontWeight: 600, color: '#64748B', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #E2E8F0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {po.dispatches.map((d, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                  <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#1E293B' }}>{d.vehicle_id}</td>
                  <td style={{ padding: '10px 14px', color: '#334155' }}>{d.product_type || '—'}</td>
                  <td style={{ padding: '10px 14px', fontWeight: 600 }}>{parseFloat(d.quantity || 0).toFixed(2)}</td>
                  <td style={{ padding: '10px 14px', color: '#64748B' }}>{d.planned_dispatch_date || '—'}</td>
                  <td style={{ padding: '10px 14px', color: d.actual_dispatch_date ? '#059669' : '#94A3B8' }}>{d.actual_dispatch_date || 'Pending'}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 700,
                      background: d.status === 'Executed' ? '#D1FAE5' : d.status === 'Planned' ? '#EFF6FF' : '#F1F5F9',
                      color: d.status === 'Executed' ? '#065F46' : d.status === 'Planned' ? '#1E40AF' : '#475569',
                      border: `1px solid ${d.status === 'Executed' ? '#A7F3D0' : d.status === 'Planned' ? '#BFDBFE' : '#CBD5E1'}` }}>
                      {d.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Commitment History */}
      {(po.commitment_history || []).length > 0 && (
        <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: '10px', overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={13} color="#8B5CF6" />
            <span style={{ fontWeight: 700, fontSize: '12px', color: '#1E293B', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Commitment History</span>
          </div>
          <div style={{ padding: '16px' }}>
            {po.commitment_history.map((h, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: i < po.commitment_history.length - 1 ? '14px' : 0 }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', marginTop: '4px', flexShrink: 0,
                  background: h.status === 'Honored' ? '#10B981' : h.status === 'Missed' ? '#EF4444' : h.status === 'Renegotiated' ? '#F59E0B' : '#3B82F6' }} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                    <StatusChip status={h.status} styleMap={COMMITMENT_STATUS_STYLE} />
                    <span style={{ fontSize: '11px', color: '#94A3B8' }}>{h.timestamp ? h.timestamp.slice(0, 16).replace('T', ' ') : ''}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: '11px', color: '#64748B' }}>{h.reason}</p>
                  {h.committed_date && <p style={{ margin: '2px 0 0', fontSize: '10px', color: '#94A3B8' }}>Committed date: {h.committed_date}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Root Customer Portal ────────────────────────────────────────────────────
export default function CustomerPortal({ API_BASE }) {
  const [user, setUser] = useState(null);
  const [screen, setScreen] = useState('list'); // 'list' | 'detail'
  const [selectedPoId, setSelectedPoId] = useState(null);

  const handleLogin = (userData) => setUser(userData);
  const handleLogout = () => { setUser(null); setScreen('list'); setSelectedPoId(null); };
  const handleSelectOrder = (poId) => { setSelectedPoId(poId); setScreen('detail'); };
  const handleBack = () => { setSelectedPoId(null); setScreen('list'); };

  if (!user) return <LoginScreen API_BASE={API_BASE} onLogin={handleLogin} />;

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Portal Header */}
      <header style={{ background: '#0F172A', borderBottom: '1px solid #1E293B', padding: '0 24px', height: '56px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: '#3B82F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Package size={16} color="white" />
          </div>
          <div>
            <div style={{ color: 'white', fontWeight: 700, fontSize: '13px', lineHeight: 1 }}>SHAKTI SCM</div>
            <div style={{ color: '#64748B', fontSize: '10px', lineHeight: 1.4 }}>Customer Self-Service Portal</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: 'white', fontSize: '12px', fontWeight: 600 }}>{user.full_name || user.username}</div>
            <div style={{ color: '#64748B', fontSize: '10px' }}>{user.company_name || `Company ${user.company_id}`}</div>
          </div>
          <button onClick={handleLogout}
            style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#94A3B8',
              borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
            <LogOut size={13} /> Sign Out
          </button>
        </div>
      </header>

      {/* Content */}
      <div style={{ maxWidth: '900px', margin: '0 auto' }}>
        {screen === 'list' && <OrderList API_BASE={API_BASE} user={user} onSelectOrder={handleSelectOrder} />}
        {screen === 'detail' && <OrderDetail API_BASE={API_BASE} user={user} poId={selectedPoId} onBack={handleBack} />}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
