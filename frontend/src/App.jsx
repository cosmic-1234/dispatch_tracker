import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, 
  FileText, 
  Truck, 
  Boxes, 
  Calendar, 
  Users, 
  BarChart3, 
  Settings as SettingsIcon,
  MessageSquare,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  RefreshCw,
  Menu,
  HeartPulse,
  Globe
} from 'lucide-react';

// Components
import Dashboard from './components/Dashboard';
import POManagement from './components/POManagement';
import DispatchPlanning from './components/DispatchPlanning';
import InventoryManagement from './components/InventoryManagement';
import ProductionPlan from './components/ProductionPlan';
import CompanyMaster from './components/CompanyMaster';
import Reports from './components/Reports';
import Settings from './components/Settings';
import CommitmentHealth from './components/CommitmentHealth';
import CustomerPortal from './components/CustomerPortal';
import shaktiLogo from './assets/shakti_logo.png';

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

export default function App() {
  // Customer portal URL branching
  const isCustomerPortal = window.location.pathname.startsWith('/customer') ||
    new URLSearchParams(window.location.search).get('portal') === 'customer';

  if (isCustomerPortal) {
    const API_BASE_PORTAL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
    return <CustomerPortal API_BASE={API_BASE_PORTAL} />;
  }

  const [activeModule, setActiveModule] = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aiSidebarOpen, setAiSidebarOpen] = useState(true); // default open for planner visibility
  const [systemDate, setSystemDate] = useState('2026-06-29');
  
  // Dashboard indicators and alerts
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Chat message queue
  const [chatMessages, setChatMessages] = useState([
    { id: 1, sender: 'agent', text: "Hello! I am your AI Dispatch Agent. I monitor POs, stock levels, and production targets. Ask me for prioritization insights, stock forecasts, or potential risks." }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);

  const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

  const triggerRefresh = () => setRefreshTrigger(prev => prev + 1);

  // Load active simulated date and dashboard stats
  useEffect(() => {
    setLoading(true);
    // Get Settings
    fetch(`${API_BASE}/settings`)
      .then(res => res.json())
      .then(data => {
        if (data.system_date) {
          setSystemDate(data.system_date);
        }
      })
      .catch(err => console.error("Error loading settings:", err));

    // Get Dashboard Data
    fetch(`${API_BASE}/dashboard`)
      .then(res => res.json())
      .then(data => {
        setDashboardData(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Error loading dashboard data:", err);
        setLoading(false);
      });
  }, [refreshTrigger]);

  const handleSendMessage = (e) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || chatSending) return;

    const userMsg = { id: Date.now(), sender: 'user', text: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    const promptText = chatInput;
    setChatInput('');
    setChatSending(true);

    fetch(`${API_BASE}/ai-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: promptText })
    })
      .then(res => res.json())
      .then(data => {
        setChatMessages(prev => [...prev, {
          id: Date.now() + 1,
          sender: 'agent',
          text: data.response,
          provider: data.provider
        }]);
        setChatSending(false);
      })
      .catch(err => {
        console.error(err);
        setChatMessages(prev => [...prev, {
          id: Date.now() + 1,
          sender: 'agent',
          text: `Error connecting to AI service backend: ${err.message}. Please verify the Express server is running.`
        }]);
        setChatSending(false);
      });
  };

  const parseMarkdown = (text) => {
    if (!text) return '';
    // Basic parser to render bold, list items, and headers in SCM chat bubble
    let formatted = text;
    formatted = formatted.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
    formatted = formatted.replace(/`([^`]+)`/g, '<code class="mono">$1</code>');
    formatted = formatted.replace(/^\s*-\s+(.*)$/gim, '<li>$1</li>');
    
    // Wrap lists in ul tags
    if (formatted.includes('<li>')) {
      // Simple wrapper for adjacent li tags
      const parts = formatted.split('<li>');
      formatted = parts[0] + '<ul>' + parts.slice(1).map((p, i) => {
        const itemEnd = p.indexOf('\n');
        if (itemEnd === -1) return '<li>' + p + '</li></ul>';
        // check if last element
        if (i === parts.length - 2) {
          return '<li>' + p.substring(0, itemEnd) + '</li></ul>' + p.substring(itemEnd);
        }
        return '<li>' + p.substring(0, itemEnd) + '</li>' + p.substring(itemEnd);
      }).join('');
    }

    return <div dangerouslySetInnerHTML={{ __html: formatted.replace(/\n/g, '<br/>') }} />;
  };

  return (
    <div className="app-container">
      {/* 1. Left Sidebar Navigation */}
      <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header" style={{ display: 'flex', justifyContent: sidebarCollapsed ? 'center' : 'space-between', alignItems: 'center', height: sidebarCollapsed ? 'auto' : 'var(--header-height)', padding: sidebarCollapsed ? '12px 0' : '0 16px', flexDirection: sidebarCollapsed ? 'column' : 'row', gap: sidebarCollapsed ? '8px' : '0' }}>
          {!sidebarCollapsed ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                <img src={shaktiLogo} alt="Shakti" style={{ height: '22px', width: 'auto', objectFit: 'contain' }} />
                <h2>SHAKTI SCM</h2>
              </div>
              <button className="sidebar-collapse-btn" onClick={() => setSidebarCollapsed(true)} style={{ color: '#FFFFFF', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }} title="Collapse Menu">
                <Menu size={16} />
              </button>
            </>
          ) : (
            <>
              <button className="sidebar-collapse-btn" onClick={() => setSidebarCollapsed(false)} style={{ color: '#FFFFFF', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }} title="Expand Menu">
                <Menu size={16} />
              </button>
              <img src={shaktiLogo} alt="Shakti" style={{ height: '20px', width: 'auto', objectFit: 'contain', cursor: 'pointer' }} onClick={() => setSidebarCollapsed(false)} />
            </>
          )}
        </div>
        
        <nav className="sidebar-nav">
          <a className={`nav-item ${activeModule === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveModule('dashboard')}>
            <LayoutDashboard size={18} />
            <span className="nav-label">Dashboard</span>
          </a>
          <a className={`nav-item ${activeModule === 'po' ? 'active' : ''}`} onClick={() => setActiveModule('po')}>
            <FileText size={18} />
            <span className="nav-label">PO Management</span>
          </a>
          <a className={`nav-item ${activeModule === 'dispatch' ? 'active' : ''}`} onClick={() => setActiveModule('dispatch')}>
            <Truck size={18} />
            <span className="nav-label">Dispatch Planning</span>
          </a>
          <a className={`nav-item ${activeModule === 'inventory' ? 'active' : ''}`} onClick={() => setActiveModule('inventory')}>
            <Boxes size={18} />
            <span className="nav-label">Inventory Management</span>
          </a>
          <a className={`nav-item ${activeModule === 'production' ? 'active' : ''}`} onClick={() => setActiveModule('production')}>
            <Calendar size={18} />
            <span className="nav-label">Production Plan</span>
          </a>
          <a className={`nav-item ${activeModule === 'companies' ? 'active' : ''}`} onClick={() => setActiveModule('companies')}>
            <Users size={18} />
            <span className="nav-label">Company Master</span>
          </a>
          <a className={`nav-item ${activeModule === 'reports' ? 'active' : ''}`} onClick={() => setActiveModule('reports')}>
            <BarChart3 size={18} />
            <span className="nav-label">Reports</span>
          </a>
          <a className={`nav-item ${activeModule === 'commitment-health' ? 'active' : ''}`} onClick={() => setActiveModule('commitment-health')}>
            <HeartPulse size={18} />
            <span className="nav-label">Commitment Health</span>
          </a>
          <a className={`nav-item ${activeModule === 'settings' ? 'active' : ''}`} onClick={() => setActiveModule('settings')}>
            <SettingsIcon size={18} />
            <span className="nav-label">Portal Settings</span>
          </a>
          <a className="nav-item" onClick={() => window.open('/?portal=customer', '_blank')} title="Open Customer Self-Service Portal">
            <Globe size={18} />
            <span className="nav-label">Customer Portal ↗</span>
          </a>
        </nav>
      </aside>

      {/* 2. Main Workspace */}
      <div className="main-wrapper">
        {/* Header Bar */}
        <header className="top-header">
          <div className="header-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src={shaktiLogo} alt="Shakti Logo" style={{ height: '24px', width: 'auto', objectFit: 'contain' }} />
            <h1>SHAKTI SOLVENT PLANNING PORTAL</h1>
            <span className="badge" style={{ backgroundColor: '#EFF3F6', border: '1px solid #D9D9D9', color: '#32363A', textTransform: 'none', display: 'flex', gap: '6px' }}>
              <Clock size={12} color="#515559" />
              <span>Simulated SCM System Date: <strong>{formatDate(systemDate)}</strong></span>
            </span>
          </div>

          <div className="header-controls">
            <button className="btn btn-secondary" style={{ padding: '6px 10px', height: '32px' }} onClick={triggerRefresh} title="Sync Portal Data">
              <RefreshCw size={14} />
            </button>
            <button className="btn btn-primary" style={{ padding: '6px 12px', height: '32px' }} onClick={() => setAiSidebarOpen(!aiSidebarOpen)}>
              <MessageSquare size={14} style={{ marginRight: '6px' }} />
              AI Agent {aiSidebarOpen ? 'Hide' : 'Show'}
            </button>
          </div>
        </header>

        {/* Global Warning Banners */}
        <div className="global-banners">
          {dashboardData && dashboardData.unconfirmed_snapshots_count > 0 && (
            <div className="banner warning">
              <div className="banner-content">
                <AlertTriangle size={14} />
                <span>Unconfirmed End-of-Day Inventory Snapshots exist for planning day: <strong>{formatDate(systemDate)}</strong>. Confirm snapshot to clear safety alerts.</span>
              </div>
              <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: '10px' }} onClick={() => setActiveModule('inventory')}>
                Review & Confirm
              </button>
            </div>
          )}
          
          {dashboardData && dashboardData.shortage_alerts && dashboardData.shortage_alerts.length > 0 && (
            <div className="banner error">
              <div className="banner-content">
                <AlertTriangle size={14} />
                <span>
                  <strong>CRITICAL INVENTORY SHORTAGE WARNING</strong>: {
                    dashboardData.shortage_alerts.map(a => `${a.product_type} is projected to fall below threshold in ${a.days_out} day(s)`).join('; ')
                  }
                </span>
              </div>
            </div>
          )}

          {dashboardData && dashboardData.missed_commitments && dashboardData.missed_commitments.length > 0 && (
            <div className="banner error">
              <div className="banner-content">
                <AlertTriangle size={14} />
                <span>
                  <strong>COMMITMENT BREACH</strong>: {dashboardData.missed_commitments.length} PO(s) have missed their committed dispatch date —&nbsp;
                  {dashboardData.missed_commitments.map(m => `${m.po_id} (${m.company_name})`).join(', ')}
                </span>
              </div>
              <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: '10px' }} onClick={() => setActiveModule('commitment-health')}>
                View Health
              </button>
            </div>
          )}
        </div>

        {/* Dynamic Module Content View */}
        <div className="module-container">
          {activeModule === 'dashboard' && (
            <Dashboard 
              data={dashboardData} 
              loading={loading} 
              onNavigate={(mod) => setActiveModule(mod)} 
              systemDate={systemDate}
              API_BASE={API_BASE}
            />
          )}
          {activeModule === 'po' && (
            <POManagement 
              API_BASE={API_BASE} 
              systemDate={systemDate} 
              triggerRefresh={triggerRefresh} 
            />
          )}
          {activeModule === 'dispatch' && (
            <DispatchPlanning 
              API_BASE={API_BASE} 
              systemDate={systemDate} 
              triggerRefresh={triggerRefresh} 
            />
          )}
          {activeModule === 'inventory' && (
            <InventoryManagement 
              API_BASE={API_BASE} 
              systemDate={systemDate} 
              triggerRefresh={triggerRefresh} 
            />
          )}
          {activeModule === 'production' && (
            <ProductionPlan 
              API_BASE={API_BASE} 
              systemDate={systemDate} 
              triggerRefresh={triggerRefresh} 
            />
          )}
          {activeModule === 'companies' && (
            <CompanyMaster 
              API_BASE={API_BASE} 
              triggerRefresh={triggerRefresh} 
            />
          )}
          {activeModule === 'reports' && (
            <Reports 
              API_BASE={API_BASE} 
              systemDate={systemDate} 
            />
          )}
          {activeModule === 'settings' && (
            <Settings 
              API_BASE={API_BASE} 
              triggerRefresh={triggerRefresh} 
            />
          )}
          {activeModule === 'commitment-health' && (
            <CommitmentHealth
              API_BASE={API_BASE}
              systemDate={systemDate}
              onNavigate={(mod) => setActiveModule(mod)}
            />
          )}
        </div>
      </div>

      {/* 3. Collapsible right AI Chat Sidebar */}
      <aside className={`ai-sidebar ${aiSidebarOpen ? '' : 'collapsed'}`}>
        <div className="ai-header">
          <div className="ai-header-title">
            <MessageSquare size={16} color="#1C6BF4" />
            <span>AI Dispatch Assistant</span>
          </div>
          <span className="badge" style={{ backgroundColor: '#F1F5F9', border: '1px solid #CBD5E1', textTransform: 'none', fontSize: '9px' }}>
            Claude 3.5 Sonnet
          </span>
        </div>

        <div className="ai-chat-messages">
          {chatMessages.map(msg => (
            <div key={msg.id} className={`chat-message ${msg.sender}`}>
              <span className="chat-message-meta">{msg.sender === 'user' ? 'Planner' : 'AI Agent'}</span>
              <div className="chat-message-text">
                {msg.sender === 'agent' ? parseMarkdown(msg.text) : msg.text}
              </div>
              {msg.provider && (
                <div style={{ fontSize: '8px', color: '#94A3B8', marginTop: '4px', textAlign: 'right', fontStyle: 'italic' }}>
                  Via {msg.provider}
                </div>
              )}
            </div>
          ))}
          {chatSending && (
            <div className="chat-message agent" style={{ opacity: 0.7 }}>
              <span className="chat-message-meta">AI Agent</span>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <RefreshCw size={12} className="mono" style={{ animation: 'spin 1.5s linear infinite' }} />
                <span>Analyzing current logistics database context...</span>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSendMessage} className="ai-chat-input-area">
          <input 
            type="text" 
            placeholder="Ask AI dispatch queries..." 
            value={chatInput} 
            onChange={(e) => setChatInput(e.target.value)}
            disabled={chatSending}
          />
          <button type="submit" className="btn btn-primary" style={{ padding: '8px' }} disabled={chatSending}>
            Send
          </button>
        </form>
      </aside>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
