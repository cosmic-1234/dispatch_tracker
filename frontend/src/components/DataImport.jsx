import React, { useState, useEffect } from 'react';
import { Upload, CheckCircle, AlertCircle, FileText, RefreshCw, Trash2, ArrowRight } from 'lucide-react';

export default function DataImport({ API_BASE, triggerRefresh }) {
  const [activeTab, setActiveTab] = useState('sales'); // 'sales' or 'purchases'
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsedRows, setParsedRows] = useState([]);
  const [libLoaded, setLibLoaded] = useState(false);
  const [clearExisting, setClearExisting] = useState(true);
  const [importResult, setImportResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);

  // Product mapping translator definition for preview
  const PRODUCT_MAPPING = {
    'MTO': 'Toluene',
    'AA': 'Ethyl Acetate',
    'RETARDER': 'Retarder',
    'ACETONE': 'Acetone',
    'SL SHORT HS': 'Benzene',
    '200LTR SHAVI HS': 'Acetone',
    '50LTR SHAVI HS': 'DEP',
    'BENZENE': 'Benzene',
    'DEP': 'DEP',
    'ETHYL ACETATE': 'Ethyl Acetate',
    'TOLUENE': 'Toluene'
  };

  const getMappedProduct = (p) => {
    if (!p) return 'Other';
    const clean = String(p).trim().toUpperCase();
    if (activeTab === 'purchases') {
      if (clean.includes('ACETONE')) return 'Acetone';
      if (clean.includes('METHANOL')) return 'Benzene';
      if (clean.includes('ALCOHOL') || clean.includes('ALOCOHAL')) return 'Retarder';
      if (clean.includes('TOLUENE')) return 'Toluene';
      if (clean.includes('BENZENE')) return 'Benzene';
      if (clean.includes('ETHYL ACETATE')) return 'Ethyl Acetate';
      if (clean.includes('DEP')) return 'DEP';
      return 'Other';
    }
    return PRODUCT_MAPPING[clean] || 'Acetone (Default)';
  };

  // Load SheetJS from CDN
  useEffect(() => {
    if (window.XLSX) {
      setLibLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.async = true;
    script.onload = () => {
      setLibLoaded(true);
    };
    script.onerror = () => {
      setErrorMessage('Failed to load spreadsheet parser library from CDN. Please check your internet connection.');
    };
    document.body.appendChild(script);
  }, []);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    handleReset();
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = (selectedFile) => {
    setFile(selectedFile);
    setParsing(true);
    setErrorMessage('');
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (!window.XLSX) {
          throw new Error('Spreadsheet parser library not loaded yet. Please wait a second and try again.');
        }
        const data = new Uint8Array(e.target.result);
        const workbook = window.XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = window.XLSX.utils.sheet_to_json(worksheet);

        if (json.length === 0) {
          throw new Error('The selected spreadsheet file is empty.');
        }

        setParsedRows(json);
        setParsing(false);
      } catch (err) {
        console.error('File parsing error:', err);
        setErrorMessage(`Error parsing file: ${err.message}`);
        setFile(null);
        setParsedRows([]);
        setParsing(false);
      }
    };

    reader.onerror = () => {
      setErrorMessage('Failed to read the file.');
      setParsing(false);
    };

    reader.readAsArrayBuffer(selectedFile);
  };

  const handleImport = () => {
    if (parsedRows.length === 0) return;
    setImporting(true);
    setUploadProgress(0);
    setErrorMessage('');

    const endpoint = activeTab === 'sales' ? 'import' : 'import-purchases';
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/${endpoint}`);
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percentComplete);
      }
    };

    xhr.onload = () => {
      setImporting(false);
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          if (data.success) {
            setImportResult(data.summary);
            setFile(null);
            setParsedRows([]);
            triggerRefresh();
          } else {
            setErrorMessage(data.error || 'Failed to complete import.');
          }
        } else {
          setErrorMessage(data.error || `Server responded with status code ${xhr.status}`);
        }
      } catch (err) {
        setErrorMessage('Failed to parse server response.');
      }
    };

    xhr.onerror = () => {
      setImporting(false);
      setErrorMessage('Network error occurred during import.');
    };

    xhr.send(JSON.stringify({
      clear_existing: clearExisting,
      rows: parsedRows
    }));
  };

  const handleReset = () => {
    setFile(null);
    setParsedRows([]);
    setImportResult(null);
    setErrorMessage('');
    setUploadProgress(0);
  };

  // Extract preview metrics conditionally
  const uniqueCompanies = activeTab === 'sales'
    ? Array.from(new Set(parsedRows.map(r => r["Company"] || r["company"]).filter(Boolean)))
    : Array.from(new Set(parsedRows.map(r => r["Vendor"] || r["vendor"]).filter(Boolean)));

  const uniqueProducts = activeTab === 'sales'
    ? Array.from(new Set(parsedRows.map(r => r["Product"] || r["product"]).filter(Boolean)))
    : Array.from(new Set(parsedRows.map(r => r["Material"] || r["material"]).filter(Boolean)));

  return (
    <div className="module-container" style={{ padding: '24px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1000px', margin: '0 auto' }}>
        
        {/* Header Block */}
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#1C2D5A' }}>Enterprise Data Import Center</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#666' }}>
            Upload raw company chemical solvent master spreadsheets to automatically seed and map transactions to the dispatch planner dashboard.
          </p>
        </div>

        {/* Tab Selection Bar */}
        {!file && !importResult && !parsing && !importing && (
          <div style={{ display: 'flex', borderBottom: '1px solid #D2D5E1', gap: '24px', marginBottom: '8px' }}>
            <button 
              onClick={() => handleTabChange('sales')}
              style={{
                padding: '10px 4px',
                fontSize: '14px',
                fontWeight: 600,
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'sales' ? '2px solid #1C2D5A' : '2px solid transparent',
                color: activeTab === 'sales' ? '#1C2D5A' : '#64748B',
                cursor: 'pointer'
              }}
            >
              Client Sales Orders
            </button>
            <button 
              onClick={() => handleTabChange('purchases')}
              style={{
                padding: '10px 4px',
                fontSize: '14px',
                fontWeight: 600,
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'purchases' ? '2px solid #1C2D5A' : '2px solid transparent',
                color: activeTab === 'purchases' ? '#1C2D5A' : '#64748B',
                cursor: 'pointer'
              }}
            >
              Vendor Raw Purchases
            </button>
          </div>
        )}

        {/* Success Alert */}
        {importResult && (
          <div className="card" style={{ border: '1px solid #A7F3D0', backgroundColor: '#F0FDF4' }}>
            <div className="card-body" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <CheckCircle size={24} style={{ color: '#059669', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <h4 style={{ margin: 0, color: '#065F46', fontSize: '15px', fontWeight: 600 }}>Master File Import Successfully Executed</h4>
                <p style={{ margin: '4px 0 12px 0', fontSize: '13px', color: '#047857' }}>
                  A total of <strong>{importResult.total_rows.toLocaleString()}</strong> rows have been mapped and seeded into the database in a single secure transaction.
                </p>
                {activeTab === 'sales' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', backgroundColor: '#FFFFFF', padding: '12px', borderRadius: '4px', border: '1px solid #E6E8F1' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>New Clients Registered</div>
                      <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>{importResult.new_companies}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Purchase Orders Synced</div>
                      <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>{importResult.purchase_orders}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dispatches Generated</div>
                      <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>{importResult.dispatches}</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', backgroundColor: '#FFFFFF', padding: '12px', borderRadius: '4px', border: '1px solid #E6E8F1' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Vendor Purchases Seeded</div>
                      <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>{importResult.inserted_purchases}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Unique Suppliers Recorded</div>
                      <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>{importResult.unique_vendors}</div>
                    </div>
                  </div>
                )}
                <button className="btn btn-secondary" onClick={handleReset} style={{ marginTop: '16px', fontSize: '12px', padding: '6px 12px' }}>
                  Upload Another File
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {errorMessage && (
          <div className="card" style={{ border: '1px solid #FECACA', backgroundColor: '#FEF2F2' }}>
            <div className="card-body" style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', color: '#991B1B' }}>
              <AlertCircle size={24} style={{ color: '#DC2626', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>Import Operation Failed</h4>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px' }}>{errorMessage}</p>
              </div>
            </div>
          </div>
        )}

        {/* Upload Card */}
        {!file && !importResult && (
          <div className="card">
            <div className="card-body" style={{ padding: '0' }}>
              <div 
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                style={{
                  border: '2px dashed #D2D5E1',
                  borderRadius: '6px',
                  padding: '48px 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#F8FAFC',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onClick={() => document.getElementById('excel-file-input').click()}
              >
                <input 
                  type="file" 
                  id="excel-file-input"
                  accept=".xlsx, .xls, .csv" 
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#EFF2F6', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                  <Upload size={24} style={{ color: '#4F5E80' }} />
                </div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#1E293B', marginBottom: '4px' }}>
                  {!libLoaded ? 'Loading parser components...' : `Drag & drop your ${activeTab === 'sales' ? 'Sales Order' : 'Vendor Purchase'} Excel here`}
                </div>
                <div style={{ fontSize: '13px', color: '#64748B', textAlign: 'center' }}>
                  Supports Microsoft Excel (.xlsx, .xls) and CSV files up to 10,000+ rows.
                </div>
                <button className="btn btn-primary" disabled={!libLoaded} style={{ marginTop: '16px', fontSize: '13px' }}>
                  Select File From Computer
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Parsing Indicator */}
        {parsing && (
          <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', gap: '16px' }}>
            <RefreshCw size={36} className="spin" style={{ color: '#1C2D5A' }} />
            <div style={{ fontSize: '14px', fontWeight: 500, color: '#334155' }}>
              Parsing raw binary spreadsheet cells...
            </div>
          </div>
        )}

        {/* Importing & Uploading Progress Bar */}
        {importing && (
          <div className="card" style={{ padding: '32px 24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '14px', fontWeight: 500, color: '#334155' }}>
                <span>{uploadProgress < 100 ? `Uploading spreadsheet data: ${uploadProgress}%` : 'Upload complete. Processing database mapping...'}</span>
                <span>{uploadProgress}%</span>
              </div>
              <div style={{ width: '100%', height: '8px', backgroundColor: '#EFF2F6', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ 
                  width: `${uploadProgress}%`, 
                  height: '100%', 
                  backgroundColor: '#1C2D5A', 
                  borderRadius: '4px', 
                  transition: 'width 0.2s ease-out' 
                }} />
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: '#64748B', lineHeight: 1.4 }}>
                {uploadProgress < 100 
                  ? 'Sending transactions to the server...' 
                  : 'Executing database transactions. Creating tables and roll-forward recalculation...'}
              </p>
            </div>
          </div>
        )}

        {/* Preview State */}
        {file && parsedRows.length > 0 && !parsing && !importing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* File Statistics Banner */}
            <div className="card" style={{ backgroundColor: '#F8FAFC' }}>
              <div className="card-body" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <FileText size={24} style={{ color: '#0F172A' }} />
                  <div>
                    <div style={{ fontWeight: 600, color: '#0F172A', fontSize: '14px' }}>{file.name}</div>
                    <div style={{ fontSize: '12px', color: '#64748B' }}>{(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '24px' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: '#64748B', textTransform: 'uppercase' }}>Spreadsheet Rows</div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#1E293B', marginTop: '2px' }}>{parsedRows.length.toLocaleString()}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#64748B', textTransform: 'uppercase' }}>{activeTab === 'sales' ? 'Unique Clients' : 'Unique Vendors'}</div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#1E293B', marginTop: '2px' }}>{uniqueCompanies.length}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', color: '#64748B', textTransform: 'uppercase' }}>{activeTab === 'sales' ? 'Unique Products' : 'Unique Materials'}</div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: '#1E293B', marginTop: '2px' }}>{uniqueProducts.length}</div>
                  </div>
                </div>

                <button className="btn btn-secondary" onClick={handleReset} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                  <Trash2 size={14} /> Clear Selection
                </button>
              </div>
            </div>

            {/* Import Actions and Options */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Database Seeding Configurations</span>
              </div>
              <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input 
                    type="checkbox" 
                    id="clear-existing-checkbox"
                    checked={clearExisting} 
                    onChange={(e) => setClearExisting(e.target.checked)}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <label htmlFor="clear-existing-checkbox" style={{ fontSize: '13px', color: '#334155', cursor: 'pointer', fontWeight: 500 }}>
                    {activeTab === 'sales'
                      ? 'Clear existing purchase orders, dispatches, and historical records before executing import (Recommended to purge dummy data)'
                      : 'Clear existing vendor purchases and reset daily purchased material logs before executing import (Recommended to purge dummy data)'}
                  </label>
                </div>

                {activeTab === 'sales' ? (
                  <div style={{ fontSize: '12px', color: '#64748B', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', padding: '10px', borderRadius: '4px', lineHeight: 1.4 }}>
                    <strong>Product Auto-Mapping Info:</strong> Spreadsheet products will be automatically mapped to standard portal products:
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: '6px', fontFamily: 'monospace' }}>
                      <span>MTO ➔ Toluene</span>
                      <span>AA ➔ Ethyl Acetate</span>
                      <span>SL Short HS ➔ Benzene</span>
                      <span>Shavi HS ➔ Acetone/DEP</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: '#64748B', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', padding: '10px', borderRadius: '4px', lineHeight: 1.4 }}>
                    <strong>Material Auto-Mapping Info:</strong> Purchased materials will be mapped to standard finished products to update purchased stock quantities:
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: '6px', fontFamily: 'monospace' }}>
                      <span>Acetone ➔ Acetone</span>
                      <span>Methanol ➔ Benzene</span>
                      <span>Denatured Absolute Alocohal ➔ Retarder</span>
                      <span>Other raw materials (coal, containers, flakes) ➔ Stored as 'Other' (does not affect standard solvent stocks)</span>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                  <button className="btn btn-primary" onClick={handleImport} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontSize: '14px' }}>
                    Execute Safe Transaction Import <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Preview Grid */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Parsed Spreadsheet Preview (First 10 Rows)</span>
              </div>
              <div className="card-table-container">
                {activeTab === 'sales' ? (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>PO No.</th>
                        <th>PO Date</th>
                        <th>Company</th>
                        <th>Original Product</th>
                        <th>Mapped Portal Product</th>
                        <th style={{ textAlign: 'right' }}>Quantity (MT)</th>
                        <th>Invoice No.</th>
                        <th>Invoice Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedRows.slice(0, 10).map((row, idx) => {
                        const coName = row["Company"] || row["company"];
                        const prodName = row["Product"] || row["product"];
                        const poNo = row["PO No."] || row["po_no"] || row["PO No"];
                        const poDate = row["PO Date"] || row["po_date"];
                        const invNo = row["Inv. No."] || row["inv_no"] || row["Inv No."] || row["Inv No"];
                        const invDate = row["Inv. Date"] || row["inv_date"];
                        const qty = row["Quantity"] || row["quantity"];

                        return (
                          <tr key={idx}>
                            <td style={{ color: '#888', fontSize: '12px' }}>{idx + 1}</td>
                            <td style={{ fontWeight: 500 }}>{poNo || '—'}</td>
                            <td>{poDate || '—'}</td>
                            <td style={{ fontWeight: 500, color: '#1C2D5A' }}>{coName || '—'}</td>
                            <td style={{ fontStyle: 'italic', color: '#666' }}>{prodName || '—'}</td>
                            <td>
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 6px',
                                borderRadius: '3px',
                                fontSize: '11px',
                                fontWeight: 500,
                                backgroundColor: '#F1F5F9',
                                color: '#475569',
                                border: '1px solid #E2E8F0'
                              }}>
                                {getMappedProduct(prodName)}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{parseFloat(qty || 0).toLocaleString()}</td>
                            <td>{invNo || '—'}</td>
                            <td>{invDate || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Date</th>
                        <th>Invoice No.</th>
                        <th>Vendor</th>
                        <th>Original Material</th>
                        <th>Mapped Product</th>
                        <th style={{ textAlign: 'right' }}>Quantity</th>
                        <th style={{ textAlign: 'right' }}>Rate</th>
                        <th style={{ textAlign: 'right' }}>Total Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedRows.slice(0, 10).map((row, idx) => {
                        const dateVal = row["Date"] || row["date"];
                        const invNo = row["Inv. No."] || row["inv_no"] || row["Inv No."] || row["Inv No"];
                        const vendor = row["Vendor"] || row["vendor"];
                        const material = row["Material"] || row["material"];
                        const qty = row["Quantity"] || row["quantity"];
                        const rate = row["Rate"] || row["rate"];
                        const amount = row["Amount"] || row["amount"];

                        return (
                          <tr key={idx}>
                            <td style={{ color: '#888', fontSize: '12px' }}>{idx + 1}</td>
                            <td>{dateVal || '—'}</td>
                            <td style={{ fontWeight: 500 }}>{invNo || '—'}</td>
                            <td style={{ fontWeight: 500, color: '#1C2D5A' }}>{vendor || '—'}</td>
                            <td style={{ fontStyle: 'italic', color: '#666' }}>{material || '—'}</td>
                            <td>
                              <span style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '2px 6px',
                                borderRadius: '3px',
                                fontSize: '11px',
                                fontWeight: 500,
                                backgroundColor: getMappedProduct(material) === 'Other' ? '#F8FAFC' : '#EFF6FF',
                                color: getMappedProduct(material) === 'Other' ? '#64748B' : '#1D4ED8',
                                border: getMappedProduct(material) === 'Other' ? '1px solid #E2E8F0' : '1px solid #BFDBFE'
                              }}>
                                {getMappedProduct(material)}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{qty || '0'}</td>
                            <td style={{ textAlign: 'right', color: '#475569' }}>{rate || '—'}</td>
                            <td style={{ textAlign: 'right', fontWeight: 500, color: '#0F172A' }}>{amount || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
