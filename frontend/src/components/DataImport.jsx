import React, { useState, useEffect } from 'react';
import { Upload, CheckCircle, AlertCircle, FileText, RefreshCw, Trash2, ArrowRight } from 'lucide-react';

export default function DataImport({ API_BASE, triggerRefresh }) {
  const [activeTab, setActiveTab] = useState('sales'); // 'sales', 'purchases', or 'planning'
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsedRows, setParsedRows] = useState([]);
  const [libLoaded, setLibLoaded] = useState(false);
  const [clearExisting, setClearExisting] = useState(true);
  const [importResult, setImportResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);

  // Custom planning sheets state
  const [sheets, setSheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [workbookObj, setWorkbookObj] = useState(null);
  const [parsedCalendar, setParsedCalendar] = useState([]);
  const [parsedOrders, setParsedOrders] = useState([]);

  // Tally PO Scanner State
  const [companies, setCompanies] = useState([]);
  const [scannedPO, setScannedPO] = useState({
    id: '',
    company_id: '',
    date_received: '',
    committed_dispatch_date: '',
    notes: '',
    items: [],
    is_vendor_po: false,
    vendor_name: ''
  });

  const [products, setProducts] = useState(['AA', 'KMO', 'RETARDER', 'SDS', 'SMO']);

  useEffect(() => {
    fetch(`${API_BASE}/companies`)
      .then(res => res.json())
      .then(data => setCompanies(data))
      .catch(err => console.error('Error fetching companies:', err));

    fetch(`${API_BASE}/products`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setProducts(data);
        }
      })
      .catch(err => console.error('Error fetching products:', err));
  }, []);

  // Product mapping translator definition for preview
  const PRODUCT_MAPPING = {
    'MTO': 'SMO',
    'AA': 'AA',
    'RETARDER': 'RETARDER',
    'ACETONE': 'SDS',
    'SL SHORT HS': 'KMO',
    '200LTR SHAVI HS': 'SDS',
    '50LTR SHAVI HS': 'SDS',
    'BENZENE': 'KMO',
    'DEP': 'SDS',
    'ETHYL ACETATE': 'AA',
    'TOLUENE': 'SMO',
    'TOLUNE': 'SMO'
  };

  const getMappedProduct = (p) => {
    if (!p) return 'Other';
    const clean = String(p).trim().toUpperCase();
    if (activeTab === 'purchases') {
      if (clean.includes('ACETONE')) return 'SDS';
      if (clean.includes('METHANOL')) return 'KMO';
      if (clean.includes('ALCOHOL') || clean.includes('ALOCOHAL')) return 'RETARDER';
      if (clean.includes('TOLUENE')) return 'SMO';
      if (clean.includes('BENZENE')) return 'KMO';
      if (clean.includes('ETHYL ACETATE')) return 'AA';
      if (clean.includes('DEP')) return 'SDS';
      return 'Other';
    }
    return PRODUCT_MAPPING[clean] || 'SDS';
  };

  // Load SheetJS and PDFJS from CDN
  useEffect(() => {
    let xlsxLoaded = !!window.XLSX;
    let pdfjsLoaded = !!window.pdfjsLib;

    const checkLoaded = () => {
      if (xlsxLoaded && pdfjsLoaded) {
        setLibLoaded(true);
      }
    };

    if (xlsxLoaded && pdfjsLoaded) {
      setLibLoaded(true);
      return;
    }

    if (!xlsxLoaded) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.async = true;
      script.onload = () => {
        xlsxLoaded = true;
        checkLoaded();
      };
      script.onerror = () => {
        setErrorMessage('Failed to load spreadsheet parser library from CDN.');
      };
      document.body.appendChild(script);
    }

    if (!pdfjsLoaded) {
      const pdfScript = document.createElement('script');
      pdfScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
      pdfScript.async = true;
      pdfScript.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        pdfjsLoaded = true;
        checkLoaded();
      };
      pdfScript.onerror = () => {
        setErrorMessage('Failed to load PDF parser library from CDN.');
      };
      document.body.appendChild(pdfScript);
    }
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

  // Custom parser logic for the July 26/ALC PLANNING format
  const parsePlanningSheetData = (sheetData, sheetName) => {
    const calendar = [];
    const orders = [];

    // Helper to check if a cell contains a date
    const isDateVal = (val) => {
      if (!val) return false;
      if (val instanceof Date) return true;
      if (typeof val === 'number') {
        // Excel serial date range for years 2010 to 2030 (approx 40000 to 60000)
        return val > 35000 && val < 60000;
      }
      if (typeof val === 'string') {
        const clean = val.trim();
        return /^\d{1,2}-\d{1,2}-\d{4}/.test(clean) || /^\d{4}-\d{1,2}-\d{1,2}/.test(clean);
      }
      return false;
    };

    const formatJsDate = (val) => {
      if (!val) return 'None';
      if (val instanceof Date) {
        return val.toISOString().split('T')[0];
      }
      if (typeof val === 'number') {
        const date = new Date(Math.round((val - 25569) * 86400 * 1000));
        return date.toISOString().split('T')[0];
      }
      if (typeof val === 'string') {
        const parts = val.split('-');
        if (parts.length === 3) {
          const p0 = parts[0].trim();
          const p1 = parts[1].trim();
          const p2 = parts[2].trim();
          if (p0.length <= 2 && p1.length <= 2 && p2.length === 4) {
            return `${p2}-${p1.padStart(2, '0')}-${p0.padStart(2, '0')}`;
          }
        }
        return val.split(' ')[0];
      }
      return 'None';
    };

    // Dynamically detect date rows in the sheet
    const dateRows = [];
    for (let r = 0; r < Math.min(60, sheetData.length); r++) {
      const rowCells = sheetData[r] || [];
      let hasDate = false;
      for (let c = 0; c < 14; c += 2) {
        if (isDateVal(rowCells[c])) {
          hasDate = true;
          break;
        }
      }
      if (hasDate) {
        dateRows.push(r);
      }
    }

    console.log("Detected Date Rows:", dateRows);

    // Build weeks definition based on detected rows
    const weeksDef = [];
    for (let i = 0; i < dateRows.length; i++) {
      const dateRow = dateRows[i];
      const addRow = dateRow + 1;
      const nextDateRow = dateRows[i + 1] || Math.min(sheetData.length, 43);
      const dispRows = [];
      for (let r = addRow + 1; r < nextDateRow - 1; r++) {
        dispRows.push(r);
      }
      const endRow = nextDateRow - 1;
      weeksDef.push({ dateRow, addRow, dispRows, endRow });
    }

    // 1. Parse Calendar (Columns A-N, i.e., index 0 to 13)
    weeksDef.forEach(w => {
      if (w.dateRow >= sheetData.length) return;
      const dateRowCells = sheetData[w.dateRow] || [];
      const addRowCells = sheetData[w.addRow] || [];
      
      for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const colQ = dayIdx * 2;
        const colC = dayIdx * 2 + 1;
        
        const dateVal = dateRowCells[colQ];
        const addVal = addRowCells[colQ];
        
        const formattedDate = formatJsDate(dateVal);
        if (formattedDate && formattedDate !== 'None') {
          calendar.push({
            date: formattedDate,
            value: addVal !== undefined && addVal !== null && addVal !== '' ? parseFloat(addVal) : 0
          });
        }
      }
    });

    // 2. Parse Right-Side Table (Columns Q-W, i.e. index 16 to 22, rows 10-40)
    // Dynamically find the column headers for the right-side table
    let headerRowIdx = -1;
    let companyCol = -1;
    let productCol = -1;
    let totalCol = -1;
    let deliveredCol = -1;
    let pendingCol = -1;

    for (let r = 0; r < Math.min(30, sheetData.length); r++) {
      const rowCells = sheetData[r] || [];
      for (let c = 15; c < Math.min(26, rowCells.length); c++) {
        const val = String(rowCells[c] || '').trim().toLowerCase();
        if (val === 'customers') {
          headerRowIdx = r;
          companyCol = c;
          break;
        }
      }
      if (headerRowIdx !== -1) break;
    }

    if (headerRowIdx !== -1) {
      const headerRowCells = sheetData[headerRowIdx] || [];
      for (let c = 15; c < Math.min(26, headerRowCells.length); c++) {
        const val = String(headerRowCells[c] || '').trim().toLowerCase();
        if (val.includes('product')) {
          productCol = c;
        } else if (val.includes('delivered') || val.includes('delv')) {
          deliveredCol = c;
        } else if (val.includes('pending') || val.includes('remaining') || val.includes('outstanding') || val.includes('rem')) {
          pendingCol = c;
        } else if (val.includes('total') || val.includes('quantity') || val.includes('qty')) {
          totalCol = c;
        }
      }
    }

    console.log("Mapped Right-Side Columns:", {
      headerRowIdx,
      companyCol,
      productCol,
      totalCol,
      deliveredCol,
      pendingCol
    });

    if (headerRowIdx !== -1 && companyCol !== -1) {
      for (let r = headerRowIdx + 1; r < Math.min(headerRowIdx + 35, sheetData.length); r++) {
        const rowCells = sheetData[r] || [];
        const companyVal = rowCells[companyCol];
        const productVal = productCol !== -1 ? rowCells[productCol] : null;
        const pendingQty = pendingCol !== -1 ? rowCells[pendingCol] : null;
        const deliveredQty = deliveredCol !== -1 ? rowCells[deliveredCol] : null;
        const totalPending = totalCol !== -1 ? rowCells[totalCol] : null;

        if (companyVal) {
          const cleanCo = String(companyVal).trim().toLowerCase();
          const cleanProd = productVal ? String(productVal).trim().toLowerCase() : '';
          if (
            cleanCo.includes('total') || 
            cleanCo.includes('delivered') || 
            cleanCo.includes('pending') ||
            cleanCo.includes('sum') ||
            cleanProd.includes('total') ||
            cleanProd.includes('delivered') ||
            cleanProd.includes('pending')
          ) {
            continue;
          }

          orders.push({
            product: productVal ? String(productVal).trim() : 'Ethyl Acetate',
            company: String(companyVal).trim(),
            pending_qty: pendingQty !== undefined && pendingQty !== null && pendingQty !== '' ? parseFloat(pendingQty) : 0,
            delivered_qty: deliveredQty !== undefined && deliveredQty !== null && deliveredQty !== '' ? parseFloat(deliveredQty) : 0,
            total_pending: totalPending !== undefined && totalPending !== null && totalPending !== '' ? parseFloat(totalPending) : 0
          });
        }
      }
    }

    return { calendar, orders };
  };

  const extractTextFromPDF = async (pdfData) => {
    try {
      const loadingTask = window.pdfjsLib.getDocument({ data: pdfData });
      const pdf = await loadingTask.promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        // Group items by Y coordinate to reconstruct lines
        const linesMap = {};
        textContent.items.forEach(item => {
          if (!item.str.trim()) return;
          const y = Math.round(item.transform[5] / 5) * 5; // Group within 5 points
          if (!linesMap[y]) linesMap[y] = [];
          linesMap[y].push(item);
        });
        
        // Sort Y coordinates descending (top to bottom)
        const sortedY = Object.keys(linesMap).map(Number).sort((a, b) => b - a);
        const pageLines = sortedY.map(y => {
          // Sort items on same line by X coordinate ascending (left to right)
          const lineItems = linesMap[y].sort((a, b) => a.transform[4] - b.transform[4]);
          return lineItems.map(item => item.str).join(' ');
        });
        
        fullText += pageLines.join('\n') + '\n';
      }
      return fullText;
    } catch (err) {
      console.error('Error extracting PDF text:', err);
      throw new Error('Could not read PDF contents. Make sure it is a digital PDF and not a scanned image.');
    }
  };

  const parseTallyPOText = (text) => {
    console.log("Scanned Text:\n", text);
    
    // 1. PO Number
    let poId = '';
    const poNoMatch = text.match(/(?:P\.?O\.?\s*No\.?|PO\s*Number|Order\s*No\.?)\s*[:\-\s]*\s*([A-Z0-9\/\-\_]+)/i);
    if (poNoMatch) {
      poId = poNoMatch[1].trim();
    }

    // 2. PO Date
    let poDate = '';
    const dateMatch = text.match(/(?:P\.?O\.?\s*Date|Order\s*Date|PO\.Date|P\.O\.Date)\s*[:\-\s]*\s*(\d{1,2}[\-\/\.]\d{1,2}[\-\/\.]\d{2,4})/i);
    if (dateMatch) {
      const rawDate = dateMatch[1].trim();
      const parts = rawDate.split(/[\-\/\.]/);
      if (parts.length === 3) {
        let day = parts[0].padStart(2, '0');
        let month = parts[1].padStart(2, '0');
        let year = parts[2];
        if (year.length === 2) year = '20' + year;
        poDate = `${year}-${month}-${day}`;
      }
    }
    
    // Fallback: search for all date patterns and find the one that fits current eras (2025-2035)
    if (!poDate) {
      const allDates = text.match(/(\d{1,2}[\-\/\.]\d{1,2}[\-\/\.]\d{2,4})/g) || [];
      const currentEraDate = allDates.find(dStr => {
        const parts = dStr.split(/[\-\/\.]/);
        const yr = parts[2] ? (parts[2].length === 2 ? '20' + parts[2] : parts[2]) : '';
        const yrNum = parseInt(yr, 10);
        return yrNum >= 2025 && yrNum <= 2035;
      });
      if (currentEraDate) {
        const parts = currentEraDate.split(/[\-\/\.]/);
        poDate = `${parts[2].length === 2 ? '20' + parts[2] : parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      } else if (allDates.length > 0) {
        const parts = allDates[0].split(/[\-\/\.]/);
        const yr = parts[2] ? (parts[2].length === 2 ? '20' + parts[2] : parts[2]) : '2026';
        poDate = `${yr}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }

    // 3. Match Company / Vendor Name
    let detectedVendor = '';
    const supplierMatch = text.match(/(?:Supplier|Vendor|Vendor\/Supplier Details)\s*[:\-\|]*\s*([^\n\:\-\|]+)/i);
    if (supplierMatch) {
      detectedVendor = supplierMatch[1].trim();
    }
    
    let detectedClient = '';
    const clientMatch = text.match(/(?:Bill to|Ship to|Consignee|Bill to Address|Ship to Address)\s*[:\-\|]*\s*([^\n\:\-\|]+)/i);
    if (clientMatch) {
      detectedClient = clientMatch[1].trim();
    }
    
    // Auto-detect classification
    const lowercaseText = text.toLowerCase();
    let isVendorPO = false;
    if (/(?:bill\s*to|ship\s*to|buyer|consignee)[\s\S]{1,150}shakti/i.test(lowercaseText)) {
      isVendorPO = true;
    }
    
    let matchedCompanyId = '';
    const companyToMatch = isVendorPO ? detectedVendor : (detectedClient || detectedVendor);
    if (companyToMatch) {
      const match = companies.find(c => {
        const cleanName = c.name.toLowerCase().replace(/pvt\.?\s*ltd\.?/g, '').trim();
        return companyToMatch.toLowerCase().includes(cleanName);
      });
      if (match) {
        matchedCompanyId = match.id;
      }
    }

    // Fallback: Global search for registered company names in the document text
    if (!matchedCompanyId) {
      const matches = companies.filter(c => {
        const cleanName = c.name.toLowerCase().replace(/pvt\.?\s*ltd\.?/g, '').replace(/llp/g, '').trim();
        if (cleanName.length < 4) return false;
        return lowercaseText.includes(cleanName);
      });
      if (matches.length > 0) {
        matches.sort((a, b) => b.name.length - a.name.length);
        matchedCompanyId = matches[0].id;
      }
    }

    // 4. Products / Items scanning
    const lines = text.split('\n');
    const parsedItems = [];
    const productKeywords = [
      { key: 'cyclohexane', name: 'KMO' },
      { key: 'sodium methoxide', name: 'KMO' },
      { key: 'acetone', name: 'SDS' },
      { key: 'benzene', name: 'KMO' },
      { key: 'dep', name: 'SDS' },
      { key: 'ethyl acetate', name: 'AA' },
      { key: 'retarder', name: 'RETARDER' },
      { key: 'toluene', name: 'SMO' }
    ];

    for (let l = 0; l < lines.length; l++) {
      const line = lines[l];
      const lowerLine = line.toLowerCase();
      const foundKeyword = productKeywords.find(pk => lowerLine.includes(pk.key));
      if (foundKeyword) {
        // Collect text from this line and potentially the next line if it doesn't start a new item
        let combinedText = line;
        let nextLineHasKeyword = false;
        if (l + 1 < lines.length) {
          const nextLineLower = lines[l + 1].toLowerCase();
          nextLineHasKeyword = productKeywords.some(pk => nextLineLower.includes(pk.key));
          if (!nextLineHasKeyword) {
            combinedText += " " + lines[l + 1];
          }
        }

        // Clean text of HSN codes (8 digits) and percentages
        const cleanedText = combinedText
          .replace(/\d+%/g, '') // remove percentages
          .replace(/\b\d{8}\b/g, ''); // remove HSN codes

        // Extract numbers
        let nums = cleanedText.match(/\d+(?:[\.,]\d+)*/g)?.map(n => parseFloat(n.replace(/,/g, '').trim())).filter(n => !isNaN(n)) || [];

        let foundQty = 0;
        let foundRate = 0;
        
        // Multiplier check
        for (let i = 0; i < nums.length; i++) {
          for (let j = 0; j < nums.length; j++) {
            if (i === j) continue;
            if (nums[i] <= 2 || nums[j] <= 2) continue;
            const product = nums[i] * nums[j];
            const match = nums.find(n => Math.abs(n - product) < 5);
            if (match) {
              foundQty = nums[i];
              foundRate = nums[j];
              break;
            }
          }
          if (foundQty > 0) break;
        }

        // Fallback to first two numbers
        if (foundQty === 0 && nums.length >= 2) {
          const startIdx = (nums[0] === 1 || nums[0] === 2) ? 1 : 0;
          if (nums.length - startIdx >= 2) {
            foundQty = nums[startIdx];
            foundRate = nums[startIdx + 1];
          }
        }

        if (foundQty > 0) {
          const lowerCombined = combinedText.toLowerCase();
          const isKg = lowerCombined.includes('kg') || lowerCombined.includes('kgs') || text.toLowerCase().includes(' uom : kgs');
          let displayQty = foundQty;
          let uom = 'MT';
          if (isKg && foundQty > 15) {
            displayQty = foundQty / 1000;
            uom = 'Kgs (Converted to MT)';
          }

          // Clean description to remove serial number, quantity, rate, amount, UOM, and other numeric garbage
          const words = combinedText.trim().split(/\s+/);
          const cleanedWords = [];
          let startIdx = 0;
          if (words.length > 0 && /^\d+\.?$/.test(words[0])) {
            startIdx = 1;
          }
          for (let i = startIdx; i < words.length; i++) {
            const word = words[i];
            const lowerWord = word.toLowerCase();
            
            if (['kgs', 'kg', 'nos', 'mt', 'bags', 'drums', 'ltr', 'litres', 'ltrs', 'uom', 'pcs', 'bags/drums'].includes(lowerWord)) {
              break;
            }
            
            const numVal = parseFloat(word.replace(/,/g, ''));
            if (!isNaN(numVal) && (numVal === foundQty || numVal === foundQty * 1000 || numVal === foundRate)) {
              break;
            }
            
            if (/^\d{5,}$/.test(word)) {
              break;
            }
            
            cleanedWords.push(word);
          }
          let cleanedDesc = cleanedWords.join(' ').replace(/[\s\-\:\,\/\(\)\|\+]+$/, '').trim();
          if (!cleanedDesc) cleanedDesc = line.trim();

          parsedItems.push({
            scanned_description: cleanedDesc,
            product_type: foundKeyword.name,
            quantity: displayQty,
            unit_rate: foundRate,
            uom
          });
        }
        
        // If we consumed the next line, skip it in the loop
        if (!nextLineHasKeyword && l + 1 < lines.length) {
          l++;
        }
      }
    }

    let committedDate = '';
    if (poDate) {
      const d = new Date(poDate);
      d.setDate(d.getDate() + 3);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      committedDate = `${y}-${m}-${day}`;
    }

    setScannedPO({
      id: poId,
      company_id: matchedCompanyId,
      date_received: poDate,
      committed_dispatch_date: committedDate,
      notes: `Uploaded via Tally PO Scanner on ${new Date().toLocaleDateString()}`,
      items: parsedItems,
      is_vendor_po: isVendorPO,
      vendor_name: isVendorPO ? detectedVendor : ''
    });
    setParsing(false);
  };

  const handleSaveScannedPO = () => {
    if (!scannedPO.id.trim()) {
      setErrorMessage('PO Number is required.');
      return;
    }
    if (!scannedPO.date_received) {
      setErrorMessage('Date Received is required.');
      return;
    }
    if (scannedPO.items.length === 0) {
      setErrorMessage('At least one line item is required.');
      return;
    }

    setImporting(true);
    setErrorMessage('');

    if (scannedPO.is_vendor_po) {
      if (!scannedPO.vendor_name.trim()) {
        setErrorMessage('Vendor/Supplier Name is required.');
        setImporting(false);
        return;
      }

      const rows = scannedPO.items.map(item => {
        const qtyInKgs = item.quantity * 1000;
        const amount = qtyInKgs * item.unit_rate;
        return {
          date: scannedPO.date_received,
          'Inv. No.': scannedPO.id.trim(),
          Vendor: scannedPO.vendor_name.trim(),
          Material: item.scanned_description,
          Quantity: item.quantity,
          Rate: item.unit_rate,
          Amount: amount
        };
      });

      fetch(`${API_BASE}/import-purchases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clear_existing: false,
          rows
        })
      })
        .then(res => res.json())
        .then(data => {
          setImporting(false);
          if (data.error) {
            setErrorMessage(data.error);
          } else {
            setImportResult({
              total_rows: rows.length,
              new_companies: 0,
              inserted_purchases: rows.length,
              unique_vendors: 1
            });
            triggerRefresh();
          }
        })
        .catch(err => {
          console.error('Error saving scanned vendor PO:', err);
          setErrorMessage('Failed to save Vendor Purchase Order.');
          setImporting(false);
        });
    } else {
      if (!scannedPO.company_id) {
        setErrorMessage('Please select a Customer Company.');
        setImporting(false);
        return;
      }

      fetch(`${API_BASE}/pos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: scannedPO.id.trim().toUpperCase(),
          company_id: scannedPO.company_id,
          date_received: scannedPO.date_received,
          committed_dispatch_date: scannedPO.committed_dispatch_date || null,
          notes: scannedPO.notes.trim(),
          items: scannedPO.items.map(item => ({
            product_type: item.product_type,
            quantity: item.quantity
          })),
          created_by: 'Tally PO Scanner'
        })
      })
        .then(res => res.json())
        .then(data => {
          setImporting(false);
          if (data.error) {
            setErrorMessage(data.error);
          } else {
            setImportResult({
              total_rows: 1,
              new_companies: 0,
              purchase_orders: 1,
              dispatches: scannedPO.committed_dispatch_date ? 1 : 0
            });
            triggerRefresh();
          }
        })
        .catch(err => {
          console.error('Error saving scanned customer PO:', err);
          setErrorMessage('Failed to save Customer Sales Order.');
          setImporting(false);
        });
    }
  };

  const processFile = (selectedFile) => {
    setFile(selectedFile);
    setParsing(true);
    setErrorMessage('');
    setImportResult(null);

    if (activeTab === 'tally-po') {
      if (selectedFile.type === 'application/pdf' || selectedFile.name.endsWith('.pdf')) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            if (!window.pdfjsLib) {
              throw new Error('PDF library not loaded yet. Please wait a second and try again.');
            }
            const arr = new Uint8Array(e.target.result);
            const text = await extractTextFromPDF(arr);
            
            // Call backend LLM-based PO parser
            fetch(`${API_BASE}/parse-po`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text })
            })
              .then(res => {
                if (!res.ok) {
                  return res.json().then(d => { throw new Error(d.error || 'Failed to parse PO via LLM.'); });
                }
                return res.json();
              })
              .then(parsedPO => {
                let committedDate = '';
                if (parsedPO.date_received) {
                  const d = new Date(parsedPO.date_received);
                  d.setDate(d.getDate() + 3);
                  const y = d.getFullYear();
                  const m = String(d.getMonth() + 1).padStart(2, '0');
                  const day = String(d.getDate()).padStart(2, '0');
                  committedDate = `${y}-${m}-${day}`;
                }

                setScannedPO({
                  id: parsedPO.id || '',
                  company_id: parsedPO.company_id || '',
                  date_received: parsedPO.date_received || '',
                  committed_dispatch_date: committedDate,
                  notes: `Uploaded and parsed via LLM PO Scanner on ${new Date().toLocaleDateString()}`,
                  items: parsedPO.items || [],
                  is_vendor_po: !!parsedPO.is_vendor_po,
                  vendor_name: parsedPO.vendor_name || ''
                });
                setParsing(false);
              })
              .catch(err => {
                console.error('LLM PO parse error:', err);
                setErrorMessage(`LLM parsing failed: ${err.message}`);
                setFile(null);
                setParsing(false);
              });
          } catch (err) {
            setErrorMessage(err.message);
            setFile(null);
            setParsing(false);
          }
        };
        reader.readAsArrayBuffer(selectedFile);
      } else {
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
            const rows = window.XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            const text = rows.map(r => r.join(' ')).join('\n');
            
            // Call backend LLM-based PO parser
            fetch(`${API_BASE}/parse-po`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text })
            })
              .then(res => {
                if (!res.ok) {
                  return res.json().then(d => { throw new Error(d.error || 'Failed to parse PO via LLM.'); });
                }
                return res.json();
              })
              .then(parsedPO => {
                let committedDate = '';
                if (parsedPO.date_received) {
                  const d = new Date(parsedPO.date_received);
                  d.setDate(d.getDate() + 3);
                  const y = d.getFullYear();
                  const m = String(d.getMonth() + 1).padStart(2, '0');
                  const day = String(d.getDate()).padStart(2, '0');
                  committedDate = `${y}-${m}-${day}`;
                }

                setScannedPO({
                  id: parsedPO.id || '',
                  company_id: parsedPO.company_id || '',
                  date_received: parsedPO.date_received || '',
                  committed_dispatch_date: committedDate,
                  notes: `Uploaded and parsed via LLM PO Scanner on ${new Date().toLocaleDateString()}`,
                  items: parsedPO.items || [],
                  is_vendor_po: !!parsedPO.is_vendor_po,
                  vendor_name: parsedPO.vendor_name || ''
                });
                setParsing(false);
              })
              .catch(err => {
                console.error('LLM PO parse error:', err);
                setErrorMessage(`LLM parsing failed: ${err.message}`);
                setFile(null);
                setParsing(false);
              });
          } catch (err) {
            setErrorMessage(`Excel parse error: ${err.message}`);
            setFile(null);
            setParsing(false);
          }
        };
        reader.readAsArrayBuffer(selectedFile);
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        if (!window.XLSX) {
          throw new Error('Spreadsheet parser library not loaded yet. Please wait a second and try again.');
        }
        const data = new Uint8Array(e.target.result);
        const workbook = window.XLSX.read(data, { type: 'array', cellDates: true });
        
        if (activeTab === 'planning') {
          setWorkbookObj(workbook);
          setSheets(workbook.SheetNames);
          
          let targetSheet = workbook.SheetNames[0];
          const j26 = workbook.SheetNames.find(name => name.toLowerCase().includes('july 26'));
          const jun26 = workbook.SheetNames.find(name => name.toLowerCase().includes('june 26'));
          if (j26) targetSheet = j26;
          else if (jun26) targetSheet = jun26;
          
          setSelectedSheet(targetSheet);
          const worksheet = workbook.Sheets[targetSheet];
          const sheetData = window.XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          const parsed = parsePlanningSheetData(sheetData, targetSheet);
          
          setParsedCalendar(parsed.calendar);
          setParsedOrders(parsed.orders);
          setParsedRows(parsed.orders); // So statistics render rows correctly
        } else {
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const json = window.XLSX.utils.sheet_to_json(worksheet);

          if (json.length === 0) {
            throw new Error('The selected spreadsheet file is empty.');
          }

          setParsedRows(json);
        }
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

  const handleSheetChange = (sheetName) => {
    if (!workbookObj) return;
    setSelectedSheet(sheetName);
    const worksheet = workbookObj.Sheets[sheetName];
    const sheetData = window.XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    const parsed = parsePlanningSheetData(sheetData, sheetName);
    setParsedCalendar(parsed.calendar);
    setParsedOrders(parsed.orders);
    setParsedRows(parsed.orders);
  };

  const handleImport = () => {
    if (parsedRows.length === 0) return;
    setImporting(true);
    setUploadProgress(0);
    setErrorMessage('');

    const endpoint = activeTab === 'sales' ? 'import' : activeTab === 'purchases' ? 'import-purchases' : 'import-planning';
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
            setParsedOrders([]);
            setParsedCalendar([]);
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

    const payload = activeTab === 'planning' ? {
      clear_existing: clearExisting,
      sheet_name: selectedSheet,
      calendar: parsedCalendar,
      orders: parsedOrders
    } : {
      clear_existing: clearExisting,
      rows: parsedRows
    };

    xhr.send(JSON.stringify(payload));
  };

  const handleReset = () => {
    setFile(null);
    setParsedRows([]);
    setParsedOrders([]);
    setParsedCalendar([]);
    setSheets([]);
    setSelectedSheet('');
    setWorkbookObj(null);
    setImportResult(null);
    setErrorMessage('');
    setUploadProgress(0);
  };

  // Extract preview metrics conditionally
  const uniqueCompanies = activeTab === 'sales'
    ? Array.from(new Set(parsedRows.map(r => r["Company"] || r["company"]).filter(Boolean)))
    : activeTab === 'purchases' 
    ? Array.from(new Set(parsedRows.map(r => r["Vendor"] || r["vendor"]).filter(Boolean)))
    : Array.from(new Set(parsedOrders.map(r => r.company).filter(Boolean)));

  const uniqueProducts = activeTab === 'sales'
    ? Array.from(new Set(parsedRows.map(r => r["Product"] || r["product"]).filter(Boolean)))
    : activeTab === 'purchases' 
    ? Array.from(new Set(parsedRows.map(r => r["Material"] || r["material"]).filter(Boolean)))
    : Array.from(new Set(parsedOrders.map(r => r.product).filter(Boolean)));

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
              Customer Sales Orders
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
            <button 
              onClick={() => handleTabChange('planning')}
              style={{
                padding: '10px 4px',
                fontSize: '14px',
                fontWeight: 600,
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'planning' ? '2px solid #1C2D5A' : '2px solid transparent',
                color: activeTab === 'planning' ? '#1C2D5A' : '#64748B',
                cursor: 'pointer'
              }}
            >
              Enterprise Planning Sheet
            </button>
            <button 
              onClick={() => handleTabChange('tally-po')}
              style={{
                padding: '10px 4px',
                fontSize: '14px',
                fontWeight: 600,
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'tally-po' ? '2px solid #1C2D5A' : '2px solid transparent',
                color: activeTab === 'tally-po' ? '#1C2D5A' : '#64748B',
                cursor: 'pointer'
              }}
            >
              PO Upload
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
                ) : activeTab === 'purchases' ? (
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
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', backgroundColor: '#FFFFFF', padding: '12px', borderRadius: '4px', border: '1px solid #E6E8F1' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Planning Orders Synced</div>
                      <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>{importResult.total_rows}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>New Clients Registered</div>
                      <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>{importResult.new_companies}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Dispatches Generated</div>
                      <div style={{ fontSize: '18px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>{importResult.dispatches}</div>
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
                  accept={activeTab === 'tally-po' ? '.pdf, .xlsx, .xls, .csv' : '.xlsx, .xls, .csv'} 
                  onChange={handleFileChange}
                  style={{ display: 'none' }}
                />
                <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#EFF2F6', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
                  <Upload size={24} style={{ color: '#4F5E80' }} />
                </div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: '#1E293B', marginBottom: '4px' }}>
                  {!libLoaded ? 'Loading parser components...' : `Drag & drop your ${activeTab === 'sales' ? 'Sales Order' : activeTab === 'purchases' ? 'Vendor Purchase' : activeTab === 'planning' ? 'Enterprise Planning' : 'PO (PDF/Excel)'} file here`}
                </div>
                <div style={{ fontSize: '13px', color: '#64748B', textAlign: 'center' }}>
                  {activeTab === 'tally-po' 
                    ? 'Supports digital PDFs and Excel exports generated from ERP.'
                    : 'Supports Microsoft Excel (.xlsx, .xls) and CSV files up to 10,000+ rows.'}
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
        {file && (parsedRows.length > 0 || activeTab === 'tally-po') && !parsing && !importing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {activeTab === 'tally-po' ? (
              /* Scanned PO Preview / Verification Form */
              <div className="card" style={{ border: '2px solid #1C2D5A' }}>
                <div className="card-header" style={{ backgroundColor: '#1C2D5A', color: '#FFFFFF', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="card-title" style={{ color: '#FFFFFF', fontSize: '15px' }}>Verify Scanned Purchase Order Data</span>
                  <span style={{ fontSize: '12px', opacity: 0.8 }}>File: {file.name}</span>
                </div>
                <div className="card-body" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  
                  {/* Order Classification Toggle */}
                  <div style={{ display: 'flex', gap: '20px', borderBottom: '1px solid #E2E8F0', paddingBottom: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: '12px', fontWeight: 700, color: '#334155', alignSelf: 'center' }}>Order Classification:</label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: 'normal', textTransform: 'none' }}>
                      <input 
                        type="radio" 
                        name="po-classification" 
                        checked={!scannedPO.is_vendor_po} 
                        onChange={() => setScannedPO(prev => ({ ...prev, is_vendor_po: false }))} 
                      />
                      <span>Customer Sales Order (PO from Customer)</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: 'normal', textTransform: 'none' }}>
                      <input 
                        type="radio" 
                        name="po-classification" 
                        checked={scannedPO.is_vendor_po} 
                        onChange={() => setScannedPO(prev => ({ ...prev, is_vendor_po: true }))} 
                      />
                      <span>Vendor Purchase Order (PO to Supplier)</span>
                    </label>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                    <div className="form-group">
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>PO Number <span style={{ color: '#EF4444' }}>*</span></label>
                      <input 
                        type="text" 
                        value={scannedPO.id}
                        onChange={(e) => setScannedPO(prev => ({ ...prev, id: e.target.value }))}
                        style={{ width: '100%', padding: '6px 10px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '4px', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div className="form-group">
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>Date Received <span style={{ color: '#EF4444' }}>*</span></label>
                      <input 
                        type="date" 
                        value={scannedPO.date_received}
                        onChange={(e) => setScannedPO(prev => ({ ...prev, date_received: e.target.value }))}
                        style={{ width: '100%', padding: '6px 10px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '4px', boxSizing: 'border-box' }}
                      />
                    </div>
                    
                    {!scannedPO.is_vendor_po ? (
                      <div className="form-group">
                        <label style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>Customer Company <span style={{ color: '#EF4444' }}>*</span></label>
                        <select 
                          value={scannedPO.company_id}
                          onChange={(e) => setScannedPO(prev => ({ ...prev, company_id: e.target.value }))}
                          style={{ width: '100%', padding: '6px 10px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '4px', boxSizing: 'border-box', backgroundColor: '#FFFFFF' }}
                        >
                          <option value="">-- Select Customer Company --</option>
                          {companies.map(c => (
                            <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="form-group">
                        <label style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>Vendor / Supplier Name <span style={{ color: '#EF4444' }}>*</span></label>
                        <input 
                          type="text" 
                          value={scannedPO.vendor_name}
                          onChange={(e) => setScannedPO(prev => ({ ...prev, vendor_name: e.target.value }))}
                          placeholder="e.g. Shivam Industries"
                          style={{ width: '100%', padding: '6px 10px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '4px', boxSizing: 'border-box' }}
                        />
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
                    {!scannedPO.is_vendor_po ? (
                      <div className="form-group">
                        <label style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>Committed Delivery Date</label>
                        <input 
                          type="date" 
                          value={scannedPO.committed_dispatch_date}
                          onChange={(e) => setScannedPO(prev => ({ ...prev, committed_dispatch_date: e.target.value }))}
                          style={{ width: '100%', padding: '6px 10px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '4px', boxSizing: 'border-box' }}
                        />
                      </div>
                    ) : (
                      <div style={{ display: 'none' }} />
                    )}
                    <div className="form-group" style={{ gridColumn: scannedPO.is_vendor_po ? 'span 3' : 'auto' }}>
                      <label style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>Notes</label>
                      <input 
                        type="text" 
                        value={scannedPO.notes}
                        onChange={(e) => setScannedPO(prev => ({ ...prev, notes: e.target.value }))}
                        style={{ width: '100%', padding: '6px 10px', fontSize: '13px', border: '1px solid #CBD5E1', borderRadius: '4px', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>

                  {/* Scanned Items Table */}
                  <div style={{ marginTop: '12px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '8px', textTransform: 'uppercase' }}>Line Items Scanned</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #E2E8F0', borderRadius: '6px', overflow: 'hidden' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                          <th style={{ fontSize: '11px', color: '#475569', padding: '8px 12px', textAlign: 'left' }}>Scanned Description</th>
                          <th style={{ fontSize: '11px', color: '#475569', padding: '8px 12px', textAlign: 'left', width: '180px' }}>Map to Portal Product</th>
                          <th style={{ fontSize: '11px', color: '#475569', padding: '8px 12px', textAlign: 'right', width: '100px' }}>Quantity (MT)</th>
                          <th style={{ fontSize: '11px', color: '#475569', padding: '8px 12px', textAlign: 'right', width: '100px' }}>Rate (Unit)</th>
                          <th style={{ fontSize: '11px', color: '#475569', padding: '8px 12px', textAlign: 'right', width: '120px' }}>Amount (Rs)</th>
                          <th style={{ fontSize: '11px', color: '#475569', padding: '8px 12px', textAlign: 'center', width: '80px' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scannedPO.items.map((item, idx) => (
                          <tr key={idx} style={{ borderBottom: '1px solid #E2E8F0' }}>
                            <td style={{ fontSize: '12px', padding: '8px 12px', color: '#334155' }}>
                              <div style={{ fontWeight: 600 }}>{item.scanned_description}</div>
                              {item.uom && <div style={{ fontSize: '10px', color: '#64748B', marginTop: '2px' }}>UOM detected: {item.uom}</div>}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              <select 
                                value={item.product_type}
                                onChange={(e) => {
                                  const newItems = [...scannedPO.items];
                                  newItems[idx].product_type = e.target.value;
                                  setScannedPO(prev => ({ ...prev, items: newItems }));
                                }}
                                style={{ width: '100%', padding: '4px 6px', fontSize: '12px', border: '1px solid #CBD5E1', borderRadius: '4px', backgroundColor: '#FFFFFF' }}
                              >
                                {products.map(prod => (
                                  <option key={prod} value={prod}>{prod}</option>
                                ))}
                                {scannedPO.is_vendor_po && <option value="Other">Other</option>}
                              </select>
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                              <input 
                                type="number"
                                step="0.001"
                                value={item.quantity}
                                onChange={(e) => {
                                  const newItems = [...scannedPO.items];
                                  newItems[idx].quantity = parseFloat(e.target.value) || 0;
                                  setScannedPO(prev => ({ ...prev, items: newItems }));
                                }}
                                style={{ width: '90px', padding: '4px 6px', fontSize: '12px', border: '1px solid #CBD5E1', borderRadius: '4px', textAlign: 'right' }}
                              />
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                              <input 
                                type="number"
                                step="0.01"
                                value={item.unit_rate}
                                onChange={(e) => {
                                  const newItems = [...scannedPO.items];
                                  newItems[idx].unit_rate = parseFloat(e.target.value) || 0;
                                  setScannedPO(prev => ({ ...prev, items: newItems }));
                                }}
                                style={{ width: '90px', padding: '4px 6px', fontSize: '12px', border: '1px solid #CBD5E1', borderRadius: '4px', textAlign: 'right' }}
                              />
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontSize: '12px', fontWeight: 600, color: '#0F172A', verticalAlign: 'middle' }}>
                              {(
                                item.quantity * 
                                (item.uom?.includes('Kgs') || item.uom?.includes('KG') ? 1000 : 1) * 
                                item.unit_rate
                              ).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                              <button 
                                type="button" 
                                onClick={() => {
                                  const newItems = scannedPO.items.filter((_, i) => i !== idx);
                                  setScannedPO(prev => ({ ...prev, items: newItems }));
                                }}
                                style={{ border: 'none', background: 'none', color: '#DC2626', cursor: 'pointer', padding: '4px' }}
                                title="Delete Item"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {scannedPO.items.length === 0 && (
                          <tr>
                            <td colSpan="6" style={{ textAlign: 'center', padding: '16px', color: '#64748B', fontStyle: 'italic', fontSize: '12px' }}>
                              No line items detected. Click "Add Line Item" below to register products manually.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    <button 
                      type="button"
                      onClick={() => {
                        setScannedPO(prev => ({
                          ...prev,
                          items: [...prev.items, { scanned_description: 'Manual Item Entry', product_type: scannedPO.is_vendor_po ? 'Other' : 'AA', quantity: 1.0, unit_rate: 0.0, uom: 'MT' }]
                        }));
                      }}
                      style={{
                        marginTop: '8px',
                        fontSize: '11px',
                        fontWeight: 600,
                        color: '#1C2D5A',
                        background: 'none',
                        border: '1px dashed #1C2D5A',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    >
                      + Add Line Item Manually
                    </button>
                  </div>

                  {/* Local Error Alert inside Card */}
                  {errorMessage && (
                    <div style={{ padding: '10px 14px', backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: '4px', color: '#991B1B', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
                      <AlertCircle size={16} style={{ color: '#DC2626', flexShrink: 0 }} />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  {/* Verification Actions */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px', borderTop: '1px solid #E2E8F0', paddingTop: '16px' }}>
                    <button className="btn btn-secondary" onClick={handleReset} style={{ fontSize: '13px' }}>
                      Cancel & Upload Another
                    </button>
                    <button 
                      className="btn btn-primary" 
                      onClick={handleSaveScannedPO}
                      disabled={importing}
                      style={{ fontSize: '13px', backgroundColor: '#10B981', borderColor: '#10B981' }}
                    >
                      {importing ? 'Saving PO...' : '✓ Save Scanned PO to Database'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
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

                <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
                  {activeTab === 'planning' ? (
                    <>
                      <div>
                        <div style={{ fontSize: '11px', color: '#64748B', textTransform: 'uppercase' }}>Select Sheet</div>
                        <select 
                          value={selectedSheet} 
                          onChange={(e) => handleSheetChange(e.target.value)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '4px',
                            border: '1px solid #CBD5E1',
                            fontSize: '13px',
                            fontWeight: 600,
                            color: '#1E293B',
                            backgroundColor: '#FFFFFF',
                            cursor: 'pointer',
                            marginTop: '2px'
                          }}
                        >
                          {sheets.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: '#64748B', textTransform: 'uppercase' }}>Calendar Days</div>
                        <div style={{ fontSize: '16px', fontWeight: 600, color: '#1E293B', marginTop: '2px' }}>{parsedCalendar.length}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: '#64748B', textTransform: 'uppercase' }}>Planning Orders</div>
                        <div style={{ fontSize: '16px', fontWeight: 600, color: '#1E293B', marginTop: '2px' }}>{parsedOrders.length}</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <div style={{ fontSize: '11px', color: '#64748B', textTransform: 'uppercase' }}>Spreadsheet Rows</div>
                        <div style={{ fontSize: '16px', fontWeight: 600, color: '#1E293B', marginTop: '2px' }}>{parsedRows.length.toLocaleString()}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: '#64748B', textTransform: 'uppercase' }}>{activeTab === 'sales' ? 'Unique Customers' : 'Unique Vendors'}</div>
                        <div style={{ fontSize: '16px', fontWeight: 600, color: '#1E293B', marginTop: '2px' }}>{uniqueCompanies.length}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '11px', color: '#64748B', textTransform: 'uppercase' }}>{activeTab === 'sales' ? 'Unique Products' : 'Unique Materials'}</div>
                        <div style={{ fontSize: '16px', fontWeight: 600, color: '#1E293B', marginTop: '2px' }}>{uniqueProducts.length}</div>
                      </div>
                    </>
                  )}
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
                      : activeTab === 'purchases'
                      ? 'Clear existing vendor purchases and reset daily purchased material logs before executing import (Recommended to purge dummy data)'
                      : 'Clear ALL existing purchase orders, dispatches, allocations, and inventory snapshot logs before executing planning sheet import'}
                  </label>
                </div>

                {activeTab === 'sales' ? (
                  <div style={{ fontSize: '12px', color: '#64748B', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', padding: '10px', borderRadius: '4px', lineHeight: 1.4 }}>
                    <strong>Product Auto-Mapping Info:</strong> Spreadsheet products will be automatically mapped to standard portal products:
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: '6px', fontFamily: 'monospace' }}>
                      <span>MTO ➔ SMO</span>
                      <span>AA ➔ AA</span>
                      <span>SL Short HS ➔ KMO</span>
                      <span>Shavi HS ➔ SDS</span>
                    </div>
                  </div>
                ) : activeTab === 'purchases' ? (
                  <div style={{ fontSize: '12px', color: '#64748B', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', padding: '10px', borderRadius: '4px', lineHeight: 1.4 }}>
                    <strong>Material Auto-Mapping Info:</strong> Purchased materials will be mapped to standard finished products to update purchased stock quantities:
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: '6px', fontFamily: 'monospace' }}>
                      <span>Acetone ➔ SDS</span>
                      <span>Methanol ➔ KMO</span>
                      <span>Denatured Absolute Alocohal ➔ RETARDER</span>
                      <span>Other raw materials (coal, containers, flakes) ➔ Stored as 'Other' (does not affect standard stocks)</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '12px', color: '#64748B', backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', padding: '10px', borderRadius: '4px', lineHeight: 1.4 }}>
                    <strong>Enterprise Planning Mapping Info:</strong>
                    <ul style={{ margin: '4px 0 0 0', paddingLeft: '20px' }}>
                      <li>Daily additions in calendar will update production logs for <strong>Ethyl Acetate (AA)</strong>.</li>
                      <li>Customer orders table on the right will seed companies, purchase orders, and executed dispatches (for delivered quantities).</li>
                      <li>Products will auto-map: <em>AA/Ethyl Acetate ➔ Ethyl Acetate</em>, <em>Tolune ➔ Toluene</em>, <em>Retarder ➔ Retarder</em>, etc.</li>
                    </ul>
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
            {activeTab === 'planning' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
                  
                  {/* Calendar Additions Preview */}
                  <div className="card">
                    <div className="card-header">
                      <span className="card-title">Calendar Production Preview</span>
                    </div>
                    <div className="card-table-container" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th style={{ textAlign: 'right' }}>AA Production (MT)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedCalendar.slice(0, 15).map((item, idx) => (
                            <tr key={idx}>
                              <td style={{ fontWeight: 500 }}>{item.date}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600, color: '#10B981' }}>
                                +{parseFloat(item.value || 0).toFixed(1)} MT
                              </td>
                            </tr>
                          ))}
                          {parsedCalendar.length > 15 && (
                            <tr>
                              <td colSpan="2" style={{ textAlign: 'center', color: '#64748B', fontSize: '12px', fontStyle: 'italic' }}>
                                ... and {parsedCalendar.length - 15} more calendar days
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Orders Preview */}
                  <div className="card">
                    <div className="card-header">
                      <span className="card-title">Parsed Customer Orders Preview</span>
                    </div>
                    <div className="card-table-container" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Company</th>
                            <th>Original Product</th>
                            <th>Mapped Product</th>
                            <th style={{ textAlign: 'right' }}>Pending (MT)</th>
                            <th style={{ textAlign: 'right' }}>Delivered (MT)</th>
                            <th style={{ textAlign: 'right' }}>Total (MT)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {parsedOrders.slice(0, 15).map((order, idx) => (
                            <tr key={idx}>
                              <td style={{ fontWeight: 600, color: '#1C2D5A' }}>{order.company}</td>
                              <td style={{ fontStyle: 'italic', color: '#64748B' }}>{order.product}</td>
                              <td>
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  padding: '2px 6px',
                                  borderRadius: '3px',
                                  fontSize: '11px',
                                  fontWeight: 500,
                                  backgroundColor: '#EFF6FF',
                                  color: '#1D4ED8',
                                  border: '1px solid #BFDBFE'
                                }}>
                                  {getMappedProduct(order.product)}
                                </span>
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 500 }}>{order.pending_qty || '—'}</td>
                              <td style={{ textAlign: 'right', fontWeight: 500, color: order.delivered_qty > 0 ? '#10B981' : '#64748B' }}>
                                {order.delivered_qty || '—'}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>
                                {(order.pending_qty + order.delivered_qty) || '—'}
                              </td>
                            </tr>
                          ))}
                          {parsedOrders.length > 15 && (
                            <tr>
                              <td colSpan="6" style={{ textAlign: 'center', color: '#64748B', fontSize: '12px', fontStyle: 'italic' }}>
                                ... and {parsedOrders.length - 15} more order lines
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                </div>
              </div>
            ) : (
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
            )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
