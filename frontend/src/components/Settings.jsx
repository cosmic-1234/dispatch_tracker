import React, { useState, useEffect } from 'react';
import { Save, Calendar, Shield, Cpu } from 'lucide-react';

export default function Settings({ API_BASE, triggerRefresh }) {
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Editable Form fields
  const [systemDate, setSystemDate] = useState('2026-06-29');
  const [vehicleCapacity, setVehicleCapacity] = useState('32.0');
  const [apiKey, setApiKey] = useState('');
  const [thresholds, setThresholds] = useState({
    AA: '30.0',
    KMO: '40.0',
    RETARDER: '10.0',
    SDS: '50.0',
    SMO: '60.0'
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = () => {
    setLoading(true);
    fetch(`${API_BASE}/products`)
      .then(res => res.json())
      .then(prods => {
        const initialTh = {};
        prods.forEach(p => {
          initialTh[p] = '50.0'; // Default safety threshold
        });

        fetch(`${API_BASE}/settings`)
          .then(res => res.json())
          .then(data => {
            setSettings(data);
            if (data.system_date) setSystemDate(data.system_date);
            if (data.vehicle_capacity_mt) setVehicleCapacity(data.vehicle_capacity_mt);
            if (data.anthropic_api_key !== undefined) setApiKey(data.anthropic_api_key);
            
            Object.keys(initialTh).forEach(p => {
              if (data[`min_threshold_${p}`] !== undefined) {
                initialTh[p] = data[`min_threshold_${p}`];
              }
            });
            setThresholds(initialTh);
            setLoading(false);
          })
          .catch(err => {
            console.error(err);
            setLoading(false);
          });
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  const handleSaveSettings = (e) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg('');

    const payload = {
      system_date: systemDate,
      vehicle_capacity_mt: String(parseFloat(vehicleCapacity) || 32.0),
      anthropic_api_key: apiKey
    };

    Object.entries(thresholds).forEach(([p, val]) => {
      payload[`min_threshold_${p}`] = String(parseFloat(val) || 0.0);
    });

    fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => {
        setSaving(false);
        if (data.error) {
          alert(`Error saving configurations: ${data.error}`);
        } else {
          setSuccessMsg('System configurations successfully saved.');
          fetchSettings();
          triggerRefresh();
          setTimeout(() => setSuccessMsg(''), 4000);
        }
      })
      .catch(err => {
        console.error(err);
        setSaving(false);
      });
  };

  if (loading) return <div>Loading system config panel...</div>;

  return (
    <div className="card" style={{ maxWidth: '680px', margin: '0 auto' }}>
      <div className="card-header">
        <span className="card-title">Portal System Configurations & Parameters</span>
      </div>
      <form onSubmit={handleSaveSettings}>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {successMsg && (
            <div style={{ backgroundColor: '#D1FAE5', border: '1px solid #A7F3D0', color: '#065F46', padding: '10px', fontSize: '13px', borderRadius: '4px', fontWeight: 500 }}>
              {successMsg}
            </div>
          )}

          {/* SECTION A: Planning date simulation */}
          <div>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--primary-navy)', marginBottom: '8px', borderBottom: '1px solid #E2E8F0', paddingBottom: '6px', textTransform: 'uppercase' }}>
              <Calendar size={15} color="#1C6BF4" />
              <span>Simulated SCM Parameters</span>
            </h4>
            <div className="form-grid">
              <div className="form-group">
                <label>Planning Calendar System Date</label>
                <input 
                  type="date" 
                  value={systemDate}
                  onChange={(e) => setSystemDate(e.target.value)}
                  required
                />
                <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Defines the current dispatch planner day for aging and snapshots.</span>
              </div>

              <div className="form-group">
                <label>Standard Vehicle Capacity Limit (MT)</label>
                <input 
                  type="number" 
                  step="0.5"
                  value={vehicleCapacity}
                  onChange={(e) => setVehicleCapacity(e.target.value)}
                  required
                />
                <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Maximum capacity of consolidation vehicles (default: 32 MT).</span>
              </div>
            </div>
          </div>

          {/* SECTION B: Safety Thresholds */}
          <div>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--primary-navy)', marginBottom: '8px', borderBottom: '1px solid #E2E8F0', paddingBottom: '6px', textTransform: 'uppercase' }}>
              <Cpu size={15} color="#1C6BF4" />
              <span>Safety Stock Minimum Thresholds (MT)</span>
            </h4>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
              Inventories below these levels trigger alerts on the Dashboard and impose stock risk penalties (-30 pts) in AI calculations.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {Object.keys(thresholds).map(p => (
                <div key={p} className="form-group">
                  <label>{p}</label>
                  <input 
                    type="number" 
                    step="1"
                    value={thresholds[p]}
                    onChange={(e) => setThresholds({ ...thresholds, [p]: e.target.value })}
                    style={{ fontFamily: 'monospace' }}
                    required
                  />
                </div>
              ))}
            </div>
          </div>

          {/* SECTION C: OpenRouter API Credentials */}
          <div>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--primary-navy)', marginBottom: '8px', borderBottom: '1px solid #E2E8F0', paddingBottom: '6px', textTransform: 'uppercase' }}>
              <Shield size={15} color="#1C6BF4" />
              <span>AI Dispatch Agent Integration</span>
            </h4>
            <div className="form-group">
              <label>OpenRouter API Secret Key</label>
              <input 
                type="password" 
                placeholder="sk-or-..." 
                value={apiKey || ''}
                onChange={(e) => setApiKey(e.target.value)}
                style={{ fontFamily: 'monospace' }}
              />
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                If empty, the portal operates using the rule-based local simulation helper to prevent service disruption.
              </span>
            </div>
          </div>

        </div>
        <div className="card-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px', backgroundColor: '#F8FAFC', borderTop: '1px solid #E2E8F0' }}>
          <button type="submit" className="btn btn-primary" disabled={saving} style={{ display: 'flex', gap: '6px' }}>
            <Save size={14} />
            <span>Save System Parameters</span>
          </button>
        </div>
      </form>
    </div>
  );
}
