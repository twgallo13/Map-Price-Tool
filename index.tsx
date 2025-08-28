import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { openDB, IDBPDatabase } from 'idb';
import Papa from 'papaparse';
// FIX: Use GoogleGenAI instead of GoogleGenerativeAI
import { GoogleGenAI } from "@google/genai";


// --- CONSTANTS & CONFIG ---
const DB_NAME = 'ShiekhMAPDB';
const STORE_NAME = 'products';
const SETTINGS_KEY = 'shiekhMapSettings';

const COLUMN_MAPPINGS = {
  nike: {
    season: 'A', category: 'B', styleCode: 'C', sku: 'D', productName: 'E',
    color: 'F', gender: 'K', ageGroup: 'J', class: 'L', price: 'M',
    promotion: 'P', exceptionPrice: 'Q'
  },
  adidas: {
    category: 'A', productName: 'B', color: 'C', sku: 'E', price: 'F',
    promotion: 'I', mapStartDate: 'K', mapEndDate: 'L'
  },
  puma: {
    sku: 'A', productName: 'B', color: 'C', price: 'D', gender: 'E', category: 'F'
  },
  new_balance: {
    sku: 'I', productName: 'C', color: 'J', price: 'N', gender: 'E',
    category: 'B', promotion: 'F', exception: 'R', mapEndDate: 'O'
  },
  vans: {
    category: 'B', sku: 'C', productName: 'D', color: 'E', price: 'F'
  }
};


const getDefaultSettings = () => ({
  dataSources: [
    { id: 'puma', name: 'Puma', url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRZvhcSwzg6uE6dHOOANX_4DBqIP_cUEHycIjfMwFpjONxofEgWbkFsdlOL-JDm2w/pub?output=csv', delimiter: ',', enabled: true, headerRow: 3, tolerance: 0.05, columns: COLUMN_MAPPINGS.puma },
    { id: 'nike', name: 'Nike / Jordan', url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQUry3OuGo26H7oTV3nZlRh3k0k0wV82m1Y9mDBXCIH1upQAIlpkYXmal42DB6Cig/pub?output=csv', delimiter: ',', enabled: true, headerRow: 2, tolerance: 0.05, columns: COLUMN_MAPPINGS.nike },
    { id: 'new_balance', name: 'New Balance', url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTna228DtiB54_PP6ZRNi7i2Ocbt8fYXEap05kVaMkGyQnebBqfl16yAm9BMEKfEw/pub?output=csv', delimiter: ',', enabled: true, headerRow: 1, tolerance: 0.05, columns: COLUMN_MAPPINGS.new_balance },
    { id: 'adidas', name: 'Adidas', url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTVE1EueNaZebSSEluaC2rmOT0YOZAVncIxQmOKRVCuT7dLuy9uu4aD8IMfj6nvHA/pub?output=csv', delimiter: ',', enabled: true, headerRow: 1, tolerance: 0.05, columns: COLUMN_MAPPINGS.adidas },
    { id: 'jordan', name: 'Jordan', url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQUry3OuGo26H7oTV3nZlRh3k0k0wV82m1Y9mDBXCIH1upQAIlpkYXmal42DB6Cig/pub?output=csv', enabled: false, headerRow: 2, tolerance: 0.05, columns: COLUMN_MAPPINGS.nike },
    { id: 'vans', name: 'Vans', url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQ80PhQE3tpEddVahbx7IBG9wt2qvdmlUaQIA0CGsoD1fvcEqt3MAnOWESpOdJiLA/pub?output=csv', delimiter: ',', enabled: true, headerRow: 9, tolerance: 0.05, columns: COLUMN_MAPPINGS.vans }
  ],
  companyLogo: '',
  uploadColumnMapping: { sku: 'sku', price: 'price', salePrice: 'salePrice' }
});


// --- DATABASE UTILITIES ---
let dbPromise: Promise<IDBPDatabase> | null = null;
const getDb = () => {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, 1, {
            upgrade(db) {
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('sku', 'sku', { unique: false });
                    store.createIndex('brand', 'brand', { unique: false });
                }
            },
        });
    }
    return dbPromise;
};

const clearProducts = async () => { await (await getDb()).clear(STORE_NAME); };
const saveProducts = async (products: any[]) => {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await Promise.all(products.map(product => tx.store.put(product)));
    await tx.done;
};
const getAllProducts = async () => { return (await getDb()).getAll(STORE_NAME); };

// --- DATA PARSING HELPERS ---
const normalizeSku = (sku: string, brandId?: string) => {
    if (!sku) return '';
    let normalized = String(sku).trim();
    if (brandId === 'nike' || brandId === 'jordan') {
        normalized = normalized.replace(/-/g, ' ');
    }
    return normalized;
};
const parsePrice = (value: any): number | null => {
    if (value === null || value === undefined) return null;
    const cleanValue = String(value).replace(/[^0-9.-]+/g, "");
    const price = parseFloat(cleanValue);
    return isNaN(price) ? null : price;
};
const parseDate = (value: any): string | null => {
    const strValue = String(value).trim().toUpperCase();
    if (!strValue || strValue === 'ALWAYS ON' || strValue === '-') return null;
    try {
        if (!isNaN(new Date(value).getTime())) {
            return value;
        }
        return null;
    } catch {
        return null;
    }
};

// --- DATA IMPORT ENGINE ---
const colLetterToIndex = (letter: string) => {
    if (!letter || typeof letter !== 'string') return -1;
    const cleanLetter = letter.trim().toUpperCase();
    if (cleanLetter.length !== 1 || cleanLetter < 'A' || cleanLetter > 'Z') return -1;
    return cleanLetter.charCodeAt(0) - 65;
};

const fetchAndParseSheetData = async (source: any) => {
    const urlToFetch = `https://corsproxy.io/?${encodeURIComponent(source.url)}`;
    const response = await fetch(urlToFetch);
    if (!response.ok) throw new Error(`Failed to fetch data for ${source.name}. Status: ${response.statusText}`);
    const textData = await response.text();
    return new Promise<string[][]>((resolve, reject) => {
        Papa.parse(textData, {
            complete: (results) => resolve(results.data as string[][]),
            error: (error) => reject(error),
        });
    });
};

const runImport = async (settings: ReturnType<typeof getDefaultSettings>, addLog: (message: string, type?: 'info' | 'success' | 'error') => void) => {
    addLog('Starting data import process...', 'info');
    try { await clearProducts(); addLog('Cleared existing product data from IndexedDB.'); } 
    catch (error) { addLog(`Error clearing database: ${(error as Error).message}`, 'error'); return; }

    let totalProducts = 0;
    for (const source of settings.dataSources.filter(s => s.enabled && s.url)) {
        addLog(`[${source.name}] Starting import...`);
        try {
            const allRows = await fetchAndParseSheetData(source);
            if (allRows.length < source.headerRow) throw new Error('No data found or header row is out of bounds.');
            
            const headerRow = allRows[source.headerRow - 1];
            addLog(`[${source.name}] Header row preview: ${headerRow.slice(0,10).join(' | ')}`);
            const dataRows = allRows.slice(source.headerRow);
            
            let processedDataRows = dataRows;
             if (source.id === 'adidas') {
                // FIX: Add type assertion to safely access 'promotion' property.
                const mapWindowCol = (source.columns as typeof COLUMN_MAPPINGS.adidas).promotion; // e.g., 'I'
                const mapWindowIndex = colLetterToIndex(mapWindowCol);
                if (mapWindowIndex !== -1) {
                    processedDataRows = dataRows.filter(row => row[mapWindowIndex]?.trim().toUpperCase() === 'MAP');
                    addLog(`[${source.name}] Filtered to ${processedDataRows.length} rows where Column ${mapWindowCol} is 'MAP'.`);
                } else {
                    addLog(`[${source.name}] WARNING: Adidas MAP Window column not found for filtering. Importing all rows.`, 'error');
                }
            }

            const mapping = source.columns as Record<string, string>;
            if (!mapping) throw new Error(`No column mapping found for ${source.name}.`);

            const products = processedDataRows.map(row => {
                const product: Record<string, any> = { brand: source.name, tolerance: source.tolerance };
                
                Object.entries(mapping).forEach(([field, columnLetter]) => {
                    const columnIndex = colLetterToIndex(columnLetter);
                    if (columnIndex !== -1 && columnIndex < row.length) {
                        let value: any = row[columnIndex];
                        if (['price', 'msrp', 'exceptionPrice'].includes(field)) value = parsePrice(value);
                        else if (field.toLowerCase().includes('date')) value = parseDate(value);
                        product[field] = value;
                    } else {
                        product[field] = null;
                    }
                });
                
                if (product.sku) {
                   product.sku = normalizeSku(product.sku, source.id);
                }

                return product;
            }).filter(p => p.sku);

            await saveProducts(products);
            totalProducts += products.length;
            addLog(`[${source.name}] Successfully imported ${products.length} products.`, 'success');
        } catch (error) {
            addLog(`[${source.name}] Import failed: ${(error as Error).message}`, 'error');
        }
    }
    addLog(`Import process finished. Total products imported: ${totalProducts}.`, 'info');
};


// --- CUSTOM HOOKS ---
const useSettings = (): [ReturnType<typeof getDefaultSettings>, (newSettings: ReturnType<typeof getDefaultSettings>) => void] => {
    const [settings, setSettings] = useState<ReturnType<typeof getDefaultSettings>>(() => {
        try {
            const storedSettings = localStorage.getItem(SETTINGS_KEY);
            if (storedSettings) return { ...getDefaultSettings(), ...JSON.parse(storedSettings) };
            return getDefaultSettings();
        } catch (error) { return getDefaultSettings(); }
    });
    const saveSettings = (newSettings: ReturnType<typeof getDefaultSettings>) => {
        setSettings(newSettings);
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
    };
    return [settings, saveSettings];
};


// --- ICON COMPONENTS ---
const RefreshIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0011.664 0l3.181-3.183m-11.664-5.303H19.5" /></svg>;
const SunIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" /></svg>;
const MoonIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" /></svg>;
const CloseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
const ChevronUpIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M14.77 12.79a.75.75 0 01-1.06 0L10 9.06l-3.71 3.73a.75.75 0 11-1.06-1.06l4.24-4.25a.75.75 0 011.06 0l4.24 4.25a.75.75 0 010 1.06z" clipRule="evenodd" /></svg>;
const ChevronDownIcon = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06 0L10 10.94l3.71-3.73a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.23 8.27a.75.75 0 010-1.06z" clipRule="evenodd" /></svg>;
const NewspaperIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5M6 7.5h3v3H6v-3z" /></svg>;
const TerminalIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75 2.25 12l4.179 2.25M12 3l5.571 3-5.571 3-5.571-3L12 3Zm0 18l5.571-3-5.571-3-5.571 3L12 21Zm-5.571-9L12 9l5.571 3-5.571 3-5.571-3Z" /></svg>;


// --- UI COMPONENTS ---
const Header = ({ onRefresh, onToggleTheme, theme, isImporting }: any) => (
    <header className="header">
        <h1 className="header-title">Shiekh MAP Intelligence Platform</h1>
        <div className="header-actions">
            <button className="btn btn-primary" onClick={onRefresh} disabled={isImporting}>
                <RefreshIcon /> {isImporting ? 'Refreshing...' : 'Refresh Data'}
            </button>
            <button className="icon-btn" onClick={onToggleTheme} aria-label="Toggle theme">
                {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>
        </div>
    </header>
);

const Footer = ({ onOpenSettings }: any) => ( <footer className="footer"> <span className="link" onClick={onOpenSettings}>Settings & Help Center</span> </footer> );

const ImportBubble = ({ onImport, onCancel, isImporting }: any) => (
    <div className="import-bubble-overlay">
        <div className="import-bubble">
            <h3>Welcome!</h3>
            <p>No data found. Import data from your sources to get started.</p>
            <div className="import-bubble-actions">
                <button className="btn btn-primary" onClick={onImport} disabled={isImporting}> {isImporting ? 'Importing...' : 'Import Now'} </button>
                <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
            </div>
        </div>
    </div>
);

const StatusLog = ({ logs }: { logs: { time: string, message: string, type: string }[] }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const logEndRef = useRef<HTMLDivElement>(null);
    useEffect(() => { if (isExpanded) { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); } }, [logs, isExpanded]);
    return (
        <div className="status-log-panel">
            <h2 className="panel-header" onClick={() => setIsExpanded(!isExpanded)}>
                <TerminalIcon /> Status Log
                <span className={`collapse-icon ${isExpanded ? '' : 'expanded'}`}><ChevronUpIcon /></span>
            </h2>
            {isExpanded && (
                <div className="status-log-content">
                    {logs.length === 0 ? (<div className="log-placeholder">Logs will appear here.</div>) : (
                        logs.slice(-50).map((log, index) => (
                            <div className="log-entry" key={index}>
                                <span className="log-time">{log.time}</span>
                                <span className={`log-message log-${log.type}`}>{log.message}</span>
                            </div>
                        ))
                    )}
                    <div ref={logEndRef} />
                </div>
            )}
        </div>
    );
};

const newsUpdates = [ { date: 'Sep 6', title: 'AI Market Price check feature added' }, { date: 'Sep 5', title: 'New brand-specific data parsers added' }, { date: 'Sep 4', title: 'UI updated with checkbox selection & export' }, { date: 'Aug 28', title: 'New compliance report view added' }, ];
const NewsUpdatesPanel = () => {
    const [isExpanded, setIsExpanded] = useState(true);
    return (
        <div className="news-updates-panel">
            <h2 className="panel-header" onClick={() => setIsExpanded(!isExpanded)}>
                <NewspaperIcon /> News & Updates
                <span className={`collapse-icon ${isExpanded ? '' : 'expanded'}`}><ChevronUpIcon /></span>
            </h2>
            {isExpanded && ( <div className="news-content"> {newsUpdates.map((item, index) => ( <div className="news-item" key={index}> <div className="news-date">{item.date}</div> <div className="news-title">{item.title}</div> </div> ))} </div> )}
        </div>
    );
};

const SettingsModal = ({ isOpen, onClose, settings, onSaveSettings }: any) => {
    const [activeTab, setActiveTab] = useState('sources');
    const [localSettings, setLocalSettings] = useState(settings);
    const [selectedMappingBrand, setSelectedMappingBrand] = useState(settings.dataSources.find((s:any) => s.enabled)?.id || settings.dataSources[0]?.id || '');
    useEffect(() => { setLocalSettings(settings); }, [settings, isOpen]);
    if (!isOpen) return null;
    const handleSave = () => { onSaveSettings(localSettings); onClose(); };
    const handleSourceChange = (id: string, field: string, value: any) => { setLocalSettings((prev: any) => ({ ...prev, dataSources: prev.dataSources.map((s: any) => s.id === id ? { ...s, [field]: value } : s) })); };
    const handleColumnMappingChange = (brandId: string, field: string, value: string) => {
        setLocalSettings((prev: any) => ({
            ...prev,
            dataSources: prev.dataSources.map((s: any) =>
                s.id === brandId ? { ...s, columns: { ...s.columns, [field]: value.toUpperCase() } } : s
            )
        }));
    };
    const currentBrandMapping = localSettings.dataSources.find((s: any) => s.id === selectedMappingBrand)?.columns || {};

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header"><h2>Settings & Help Center</h2><button className="icon-btn" onClick={onClose} aria-label="Close modal"><CloseIcon /></button></div>
                <div className="modal-body">
                    <div className="tabs">
                        <button className={`tab ${activeTab === 'sources' && 'active'}`} onClick={() => setActiveTab('sources')}>Data Sources</button>
                        <button className={`tab ${activeTab === 'column_mappings' && 'active'}`} onClick={() => setActiveTab('column_mappings')}>Column Mappings</button>
                        <button className={`tab ${activeTab === 'upload_mappings' && 'active'}`} onClick={() => setActiveTab('upload_mappings')}>Upload Mapping</button>
                        <button className={`tab ${activeTab === 'help' && 'active'}`} onClick={() => setActiveTab('help')}>Help & Support</button>
                    </div>
                    {activeTab === 'sources' && (<div>{localSettings.dataSources.map((source: any) => (<div className="form-group-grid" key={source.id}><label>{source.name}</label><div className="input-group"><input type="text" className="input" value={source.url} onChange={(e) => handleSourceChange(source.id, 'url', e.target.value)} placeholder="Google Sheet URL" /><div className="input-with-label"><span>Header Row</span><input type="number" min="1" className="input header-row-input" value={source.headerRow} onChange={(e) => handleSourceChange(source.id, 'headerRow', parseInt(e.target.value) || 1)} /></div><div className="input-with-label"><span>Tolerance</span><input type="number" step="0.01" min="0" className="input header-row-input" value={source.tolerance} onChange={(e) => handleSourceChange(source.id, 'tolerance', parseFloat(e.target.value) || 0)} /></div><label className="checkbox-label"><input type="checkbox" checked={source.enabled} onChange={e => handleSourceChange(source.id, 'enabled', e.target.checked)} />Enabled</label></div></div>))}</div>)}
                    {activeTab === 'column_mappings' && (<div><h3>Data Source Column Mappings</h3><p>Specify the exact column letter (A, B, C...) for each field.</p><div className="form-group"><label>Select Brand to Configure</label><select className="input" value={selectedMappingBrand} onChange={e => setSelectedMappingBrand(e.target.value)}>{localSettings.dataSources.filter((s:any) => s.enabled).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div><div className="mapping-grid">{Object.keys(currentBrandMapping).map(field => (<div className="form-group" key={field}><label>{field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</label><input type="text" maxLength={2} className="input column-letter-input" value={currentBrandMapping[field] || ''} onChange={e => handleColumnMappingChange(selectedMappingBrand, field, e.target.value)} /></div>))}</div></div>)}
                    {activeTab === 'upload_mappings' && (<div><h3>Price File Column Mapping</h3><p>Specify column headers from your uploaded price CSV.</p><div className="form-group"><label>SKU Column</label><input type="text" className="input" value={localSettings.uploadColumnMapping.sku} onChange={e => setLocalSettings(p => ({ ...p, uploadColumnMapping: { ...p.uploadColumnMapping, sku: e.target.value } }))} /></div><div className="form-group"><label>Price Column</label><input type="text" className="input" value={localSettings.uploadColumnMapping.price} onChange={e => setLocalSettings(p => ({ ...p, uploadColumnMapping: { ...p.uploadColumnMapping, price: e.target.value } }))} /></div><div className="form-group"><label>Sale Price Column (Optional)</label><input type="text" className="input" value={localSettings.uploadColumnMapping.salePrice} onChange={e => setLocalSettings(p => ({ ...p, uploadColumnMapping: { ...p.uploadColumnMapping, salePrice: e.target.value } }))} /></div></div>)}
                    {activeTab === 'help' && (<div className="help-content"><h3>Contact Support</h3><p>For issues or questions, contact our support team.</p><p><strong>Email:</strong> <a href="mailto:theo@shiekh.com" className="link">theo@shiekh.com</a></p></div>)}
                </div>
                <div className="modal-footer"><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={handleSave}>Save Changes</button></div>
            </div>
        </div>
    );
};

const ProductDetailModal = ({ isOpen, onClose, product }: any) => {
    const [marketPrices, setMarketPrices] = useState<any[]>([]);
    const [groundingSources, setGroundingSources] = useState<any[]>([]);
    const [isLoadingPrices, setIsLoadingPrices] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      if (!isOpen) {
        setMarketPrices([]);
        setGroundingSources([]);
        setIsLoadingPrices(false);
        setError(null);
      }
    }, [isOpen]);

    const fetchMarketPrices = async () => {
        if (!product) return;
        setIsLoadingPrices(true);
        setError(null);
        setMarketPrices([]);
        setGroundingSources([]);

        try {
            // FIX: Use GoogleGenAI instead of GoogleGenerativeAI
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const prompt = `
                Find the price of the product "${product.productName}" (SKU: ${product.sku}) on the following websites only: 
                shoepalace.com, jdsports.com, footlocker.com, dicks.com, hibbets.com, stockx.com.
                Do not use any other websites, especially marketplaces like eBay or Craigslist.
                For each website where you find the product, provide the retailer name, the current price as a number, and a direct URL to the product page.
                Respond with only a JSON array of objects. Each object should have three keys: "retailer", "price", and "url". 
                For example: [{"retailer": "shoepalace.com", "price": 120.00, "url": "https://..."}].
                If you cannot find the product on a site, do not include it in the array. If you find no results, return an empty array [].
            `;

            const response = await ai.models.generateContent({
               model: "gemini-2.5-flash",
               contents: prompt,
               config: {
                 tools: [{googleSearch: {}}],
               },
            });
            
            // FIX: Extract and store grounding chunks
            const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
            let sourcesExist = false;
            if (groundingChunks) {
                const sources = groundingChunks
                    .map((chunk: any) => chunk.web)
                    .filter(Boolean);
                if (sources.length > 0) {
                    setGroundingSources(sources);
                    sourcesExist = true;
                }
            }

            const textResponse = response.text.trim();
            // Robust parsing to find the JSON array
            const startIndex = textResponse.indexOf('[');
            const endIndex = textResponse.lastIndexOf(']');
            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                const jsonString = textResponse.substring(startIndex, endIndex + 1);
                const parsedResults = JSON.parse(jsonString);
                setMarketPrices(parsedResults);
            } else {
                 // FIX: Don't throw error if grounding sources were found
                if (!sourcesExist) {
                    throw new Error("No valid JSON array found in the response.");
                }
            }
        } catch (e) {
            console.error("Error fetching market prices:", e);
            setError("Failed to fetch market prices. The AI might be unavailable or the response was invalid.");
        } finally {
            setIsLoadingPrices(false);
        }
    };
    
    if (!isOpen || !product) return null;

    const productDetails = Object.entries(product)
      .filter(([key]) => !['id', 'tolerance', 'ourPrice', 'salePrice', 'isViolation', 'difference'].includes(key) && product[key] !== null && product[key] !== undefined && product[key] !== '')
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content product-detail-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Product Details</h2>
                    <button className="icon-btn" onClick={onClose} aria-label="Close modal"><CloseIcon /></button>
                </div>
                <div className="modal-body">
                    <div className="product-summary">
                        <span className="product-summary-brand">{product.brand}</span>
                        <h3>{product.productName}</h3>
                        <p>SKU: {product.sku}</p>
                    </div>
                    <div className="details-grid">
                        {productDetails.map(([key, value]) => (
                            <div className="detail-item" key={key}>
                                <div className="detail-key">{key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</div>
                                <div className="detail-value">{String(value)}</div>
                            </div>
                        ))}
                    </div>
                    <div className="market-price-section">
                        <button className="btn btn-secondary" onClick={fetchMarketPrices} disabled={isLoadingPrices}>
                            {isLoadingPrices ? 'Searching...' : '🔍 Search Market Price'}
                        </button>
                        {isLoadingPrices && <div className="spinner small"></div>}
                        {error && <p className="log-message log-error">{error}</p>}
                        {!isLoadingPrices && marketPrices.length === 0 && groundingSources.length === 0 && !error && <p className="market-price-placeholder">Click to search for prices across major retailers.</p>}
                        {marketPrices.length > 0 && (
                            <div className="market-prices-results">
                                <h4>Market Prices Found</h4>
                                <div className="table-responsive modal-table">
                                <table className="results-table">
                                    <thead><tr><th>Retailer</th><th>Price</th><th>Link</th></tr></thead>
                                    <tbody>
                                        {marketPrices.map((item, index) => (
                                            <tr key={index}>
                                                <td>{item.retailer}</td>
                                                <td>{item.price ? `$${Number(item.price).toFixed(2)}` : 'N/A'}</td>
                                                <td><a href={item.url} className="link" target="_blank" rel="noopener noreferrer">View</a></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                </div>
                            </div>
                        )}
                        {/* FIX: Render grounding sources */}
                        {groundingSources.length > 0 && (
                            <div className="grounding-sources" style={{marginTop: '1rem'}}>
                                <h4>Sources from Google Search</h4>
                                <ul style={{listStyle: 'disc', paddingLeft: '20px', fontSize: '0.9em', margin: 0}}>
                                    {groundingSources.map((source, index) => (
                                        <li key={index} style={{marginBottom: '0.25rem'}}>
                                            <a href={source.uri} target="_blank" rel="noopener noreferrer" className="link">
                                                {source.title || source.uri}
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

const Dashboard = ({ data, hasPriceCheckData, priceCheckStats }: any) => {
    // Price Check View
    if (hasPriceCheckData && priceCheckStats) {
        const { productsChecked, totalSavingsAtRisk, brandsAffected } = priceCheckStats;
        const { mapViolations } = data; // Total violations from currently filtered products
        const maxCount = Math.max(...brandsAffected.map((b: any) => b.count), 0);
        return (
            <div className="dashboard">
                <div className="kpi-card-grid price-check-grid">
                    <div className="kpi-card">
                        <div className="kpi-value">{productsChecked.toLocaleString()}</div>
                        <div className="kpi-label">Products Checked</div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-value violation-value">{mapViolations.toLocaleString()}</div>
                        <div className="kpi-label">Active MAP Violations</div>
                    </div>
                    <div className="kpi-card">
                        <div className="kpi-value violation-value">{`$${totalSavingsAtRisk.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</div>
                        <div className="kpi-label">Total Savings at Risk</div>
                    </div>
                </div>
                <div className="chart-container">
                    <h3>Brands Affected by Violations</h3>
                    <div className="bar-chart">
                        {brandsAffected.length > 0 ? brandsAffected.map((brand: any) => (
                            <div className="bar-wrapper" key={brand.name}>
                                <div className="bar-label" title={brand.name}>{brand.name}</div>
                                <div className="bar"><div className="bar-fill" style={{ width: `${maxCount > 0 ? (brand.count / maxCount) * 100 : 0}%`, backgroundColor: 'var(--status-error)' }}></div></div>
                                <div className="bar-value">{brand.count.toLocaleString()}</div>
                            </div>
                        )) : <p className="chart-placeholder">No violations found in the checked products.</p>}
                    </div>
                </div>
            </div>
        );
    }

    // Default View
    const { totalSkus, mapViolations, brandBreakdown } = data;
    const maxCount = Math.max(...brandBreakdown.map((b: any) => b.count), 0);
    return (
      <div className="dashboard">
        <div className="kpi-card-grid"><div className="kpi-card"><div className="kpi-value">{totalSkus.toLocaleString()}</div><div className="kpi-label">Total SKUs in DB</div></div><div className="kpi-card"><div className="kpi-value violation-value">{mapViolations.toLocaleString()}</div><div className="kpi-label">Active MAP Violations</div></div></div>
        <div className="chart-container"><h3>Brand Breakdown</h3><div className="bar-chart">{brandBreakdown.length > 0 ? brandBreakdown.map((brand: any) => (<div className="bar-wrapper" key={brand.name}><div className="bar-label" title={brand.name}>{brand.name}</div><div className="bar"><div className="bar-fill" style={{ width: `${maxCount > 0 ? (brand.count / maxCount) * 100 : 0}%` }}></div></div><div className="bar-value">{brand.count.toLocaleString()}</div></div>)) : <p className="chart-placeholder">No data to display.</p>}</div></div>
      </div>
    );
};
  
const ControlsPanel = ({ products, filters, setFilters, onUploadPrices, onExport, selectedIds, hasPriceCheckData, onClearPriceCheck }: any) => {
    const uniqueBrands = useMemo(() => ['all', ...Array.from(new Set(products.map((p: any) => p.brand).sort()))], [products]);
    const uniqueCategories = useMemo(() => ['all', ...Array.from(new Set(products.map((p: any) => p.category).filter(Boolean).sort()))], [products]);
    const uploadRef = useRef<HTMLInputElement>(null);
    return (
      <div className="controls-panel">
        <div className="filters">
            <input type="text" name="search" className="input search-input" placeholder="Search SKU or Name..." value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))} />
            <select name="brand" className="input filter-select" value={filters.brand} onChange={e => setFilters(p => ({ ...p, brand: e.target.value }))}>
                {uniqueBrands.map((b: string) => <option key={b} value={b}>{b === 'all' ? 'All Brands' : b}</option>)}
            </select>
            <select name="category" className="input filter-select" value={filters.category} onChange={e => setFilters(p => ({ ...p, category: e.target.value }))}>
                {uniqueCategories.map((c: string) => <option key={c} value={c}>{c === 'all' ? 'All Categories' : c}</option>)}
            </select>
            <input type="number" name="minPrice" className="input price-input" placeholder="Min Price" value={filters.minPrice ?? ''} onChange={e => setFilters(p => ({...p, minPrice: e.target.value === '' ? null : parseFloat(e.target.value)}))} />
            <input type="number" name="maxPrice" className="input price-input" placeholder="Max Price" value={filters.maxPrice ?? ''} onChange={e => setFilters(p => ({...p, maxPrice: e.target.value === '' ? null : parseFloat(e.target.value)}))} />
            <label className="checkbox-label"><input type="checkbox" checked={filters.mapOnly} onChange={e => setFilters(p => ({ ...p, mapOnly: e.target.checked }))} />Show MAP Products Only</label>
            <label className="checkbox-label"><input type="checkbox" checked={filters.violationsOnly} onChange={e => setFilters(p => ({ ...p, violationsOnly: e.target.checked }))} />Show Violations Only</label>
        </div>
        <div className="actions">
            <button className="btn btn-secondary" onClick={() => onExport('default')} disabled={selectedIds.size === 0}>Export ({selectedIds.size})</button>
            <button className="btn btn-secondary" onClick={() => onExport('rics')} disabled={selectedIds.size === 0}>Export RICS</button>
            <input type="file" ref={uploadRef} style={{ display: 'none' }} accept=".csv" onChange={onUploadPrices} />
            <button className="btn btn-primary" onClick={() => uploadRef.current?.click()}>Check My Prices</button>
            {hasPriceCheckData && <button className="btn btn-secondary" onClick={onClearPriceCheck}>Clear Check</button>}
        </div>
      </div>
    );
};

const TableView = ({ products, sortConfig, requestSort, selectedIds, toggleSelect, toggleSelectAll, onRowClick, hasPriceCheckData }: any) => {
    const SortableHeader = ({ field, label }: { field: string, label: string }) => {
        const isSorted = sortConfig?.key === field;
        const direction = isSorted ? sortConfig.direction : 'none';
        return (<th onClick={() => requestSort(field)} className="sortable">{label}<span className="sort-icon">{direction === 'ascending' && <ChevronUpIcon />}{direction === 'descending' && <ChevronDownIcon />}</span></th>);
    };
    return (
        <div className="table-responsive">
            <table className="results-table">
                <thead>
                    <tr>
                        <th><input type="checkbox" onChange={toggleSelectAll} checked={selectedIds.size > 0 && selectedIds.size === products.length && products.length > 0} /></th>
                        <SortableHeader field="sku" label="SKU" />
                        <SortableHeader field="productName" label="Name" />
                        <SortableHeader field="brand" label="Brand" />
                        <SortableHeader field="price" label="Price" />
                        <SortableHeader field="color" label="Color" />
                        {hasPriceCheckData && <>
                            <SortableHeader field="ourPrice" label="Our Price" />
                            <SortableHeader field="salePrice" label="Sale Price" />
                            <SortableHeader field="difference" label="Difference" />
                            <SortableHeader field="isViolation" label="Status" />
                        </>}
                    </tr>
                </thead>
                <tbody>{products.map((p: any) => (
                    <tr key={p.id} className={`product-row ${selectedIds.has(p.id) ? 'is-selected' : ''} ${p.isViolation ? 'is-violation' : ''}`} onClick={() => onRowClick(p)}>
                        <td onClick={(e) => e.stopPropagation()}>
                           <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} />
                        </td>
                        <td className="col-sku" title={p.sku}>{p.sku}</td>
                        <td className="col-productName" title={p.productName}>{p.productName}</td>
                        <td>{p.brand}</td>
                        <td>{p.price !== null ? `$${Number(p.price).toFixed(2)}` : 'N/A'}</td>
                        <td>{p.color}</td>
                        {hasPriceCheckData && <>
                           <td>{p.ourPrice !== null && p.ourPrice !== undefined ? `$${Number(p.ourPrice).toFixed(2)}` : ''}</td>
                           <td>{p.salePrice !== null && p.salePrice !== undefined ? `$${Number(p.salePrice).toFixed(2)}` : ''}</td>
                           <td className={p.difference < 0 ? 'difference-negative' : ''}>{p.difference !== null && p.difference !== undefined ? `$${p.difference.toFixed(2)}` : ''}</td>
                           <td className="col-status">
                                {p.isViolation === true && <span className="status-violation">Violation</span>}
                                {p.isViolation === false && <span className="status-ok">OK</span>}
                           </td>
                        </>}
                    </tr>
                ))}</tbody>
            </table>
        </div>
    );
};

const PaginationControls = ({ currentPage, rowsPerPage, totalRows, onPageChange, onRowsPerPageChange }: any) => {
    const totalPages = Math.ceil(totalRows / rowsPerPage);
    if (totalPages <= 1) return null;
    return (
        <div className="pagination-controls">
            <div className="rows-per-page-selector"><label htmlFor="rowsPerPage">Rows:</label><select id="rowsPerPage" className="input" value={rowsPerPage} onChange={e => onRowsPerPageChange(Number(e.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option><option value={250}>250</option></select></div>
            <div className="page-navigator"><button className="btn btn-secondary" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage <= 1}>&lt; Prev</button><span>Page {currentPage} of {totalPages}</span><button className="btn btn-secondary" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage >= totalPages}>Next &gt;</button></div>
        </div>
    );
};

const ResultsView = ({ products, totalProductCount, sortConfig, requestSort, paginationProps, selectedIds, toggleSelect, toggleSelectAll, onRowClick, hasPriceCheckData }: any) => {
    if (totalProductCount === 0) return <div className="results-placeholder">No products match the current filters.</div>;
    return (
        <div className="results-view-container">
            <TableView products={products} sortConfig={sortConfig} requestSort={requestSort} selectedIds={selectedIds} toggleSelect={toggleSelect} toggleSelectAll={toggleSelectAll} onRowClick={onRowClick} hasPriceCheckData={hasPriceCheckData} />
            <PaginationControls {...paginationProps} totalRows={totalProductCount} />
        </div>
    );
};
  
type PriceCheckStats = {
    productsChecked: number;
    totalSavingsAtRisk: number;
    brandsAffected: { name: string; count: number }[];
};

// --- MAIN APP COMPONENT ---
const App = () => {
    const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');
    const [settings, saveSettings] = useSettings();
    const [isSettingsOpen, setSettingsOpen] = useState(false);
    const [showImportBubble, setShowImportBubble] = useState(false);
    const [logs, setLogs] = useState<{ time: string, message: string, type: string }[]>([]);
    const [isImporting, setImporting] = useState(false);

    const [products, setProducts] = useState<any[]>([]);
    const [filters, setFilters] = useState({ search: '', brand: 'all', category: 'all', mapOnly: false, violationsOnly: false, minPrice: null as number | null, maxPrice: null as number | null });
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: string } | null>({ key: 'sku', direction: 'ascending' });
    const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [hasPriceCheckData, setHasPriceCheckData] = useState(false);
    const [checkedProductIds, setCheckedProductIds] = useState<Set<number> | null>(null);
    const [priceCheckStats, setPriceCheckStats] = useState<PriceCheckStats | null>(null);


    const fetchAllProducts = useCallback(async () => {
        const allProducts = await getAllProducts();
        setProducts(allProducts);
        const hasPriceCheck = allProducts.some(p => p.hasOwnProperty('isViolation'));
        setHasPriceCheckData(hasPriceCheck);
        if(!hasPriceCheck) {
            handleClearPriceCheck();
        }
        setShowImportBubble(allProducts.length === 0 && !isImporting);
    }, [isImporting]);

    useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('theme', theme); }, [theme]);
    useEffect(() => { fetchAllProducts(); }, []);

    const addLog = useCallback((message: string, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        setLogs(prevLogs => [...prevLogs, { time, message, type }]);
    }, []);
    
    const handleImport = useCallback(async () => {
        setImporting(true);
        setShowImportBubble(false);
        setLogs([]);
        await runImport(settings, addLog);
        await fetchAllProducts();
        setImporting(false);
    }, [settings, addLog, fetchAllProducts]);

    const toggleTheme = () => setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');

    const vendorProductMap = useMemo(() => {
        const map = new Map<string, any>();
        products.forEach(p => { 
            const brandId = p.brand?.toLowerCase().includes('nike') ? 'nike' : p.brand?.toLowerCase();
            map.set(normalizeSku(p.sku, brandId), p); 
        });
        return map;
    }, [products]);


    const filteredProducts = useMemo(() => {
        let initialProducts = products;
        if (hasPriceCheckData && checkedProductIds) {
            initialProducts = products.filter(p => checkedProductIds.has(p.id));
        }
        
        const searchLower = filters.search.toLowerCase();
        return initialProducts.filter(p => 
            (filters.brand === 'all' || p.brand === filters.brand) && 
            (filters.category === 'all' || p.category === filters.category) && 
            (!filters.search || normalizeSku(p.sku, p.brand?.toLowerCase()).toLowerCase().includes(searchLower) || p.productName?.toLowerCase().includes(searchLower)) && 
            (!filters.mapOnly || (p.price !== null && p.price > 0)) &&
            (!filters.violationsOnly || p.isViolation === true) &&
            (filters.minPrice === null || p.price === null || p.price >= filters.minPrice) &&
            (filters.maxPrice === null || p.price === null || p.price <= filters.maxPrice)
        );
    }, [products, filters, hasPriceCheckData, checkedProductIds]);

    const sortedProducts = useMemo(() => {
        if (!sortConfig) return filteredProducts;
        const sorted = [...filteredProducts];
        sorted.sort((a, b) => {
            const aVal = a[sortConfig.key]; const bVal = b[sortConfig.key];
            if (aVal === null || aVal === undefined) return 1; if (bVal === null || bVal === undefined) return -1;
            if (aVal < bVal) return sortConfig.direction === 'ascending' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'ascending' ? 1 : -1;
            return 0;
        });
        return sorted;
    }, [filteredProducts, sortConfig]);
    
    const paginatedProducts = useMemo(() => sortedProducts.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage), [sortedProducts, currentPage, rowsPerPage]);

    const dashboardData = useMemo(() => ({
        totalSkus: products.length,
        mapViolations: filteredProducts.filter(p => p.isViolation).length,
        // FIX: The accumulator 'acc' was untyped, causing 'count' to be inferred as 'any' or 'unknown'. This led to errors in the sort function. Typing 'acc' as Record<string, number> solves this.
        brandBreakdown: Object.entries(products.reduce((acc: Record<string, number>, p: any) => {
            if (p.brand) {
                acc[p.brand] = (acc[p.brand] || 0) + 1;
            }
            return acc;
        }, {})).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    }), [products, filteredProducts]);

    const requestSort = (key: string) => { setSortConfig(prev => (prev?.key === key && prev.direction === 'ascending') ? { key, direction: 'descending' } : { key, direction: 'ascending' }); };
    const handleFiltersChange = (updater: React.SetStateAction<typeof filters>) => { setFilters(updater); setCurrentPage(1); };

    const handleClearPriceCheck = useCallback(() => {
        setProducts(currentProducts => currentProducts.map(p => {
            const { ourPrice, salePrice, isViolation, difference, ...rest } = p;
            return rest;
        }));
        setHasPriceCheckData(false);
        setCheckedProductIds(null);
        setPriceCheckStats(null);
        setFilters(p => ({ ...p, violationsOnly: false }));
        addLog('Cleared price check data from the view.', 'info');
    }, []);
    
    const handleUploadPrices = (event: React.ChangeEvent<HTMLInputElement>) => {
        handleClearPriceCheck();
        const file = event.target.files?.[0]; if (!file) return; addLog(`Parsing price file: ${file.name}`);
        Papa.parse(file, {
            header: true, skipEmptyLines: true,
            complete: (results) => {
                const priceDataMap = new Map();
                const mapping = settings.uploadColumnMapping;
                (results.data as any[]).forEach(row => {
                    const retailerSkuRaw = String(row[mapping.sku] || '').trim();
                    if (!retailerSkuRaw) return;

                    const skuVariations = new Set([
                        retailerSkuRaw,
                        retailerSkuRaw.replace(/-/g, ' '),
                        retailerSkuRaw.replace(/ /g, ''),
                        retailerSkuRaw.replace(/-/g, '')
                    ]);

                    let vendorProduct = null;
                     for (const sku of skuVariations) {
                        const normalizedSku = normalizeSku(sku); // General normalization
                        vendorProduct = vendorProductMap.get(normalizedSku);
                        if(vendorProduct) break;
                        // check with brand specific normalization
                        const nikeJordanMatch = vendorProductMap.get(normalizeSku(sku, 'nike'));
                        if(nikeJordanMatch) { vendorProduct = nikeJordanMatch; break; }
                    }
                    
                    if (vendorProduct) {
                        const ourPrice = parsePrice(row[mapping.price]);
                        const salePrice = row[mapping.salePrice] ? parsePrice(row[mapping.salePrice]) : null;
                        const mapPrice = vendorProduct.price; // Already parsed on import
                        
                        if (mapPrice !== null && ourPrice !== null) {
                            const priceToCheck = (salePrice !== null) ? salePrice : ourPrice;
                            const isViolation = priceToCheck < (mapPrice - (vendorProduct.tolerance || 0));
                            priceDataMap.set(vendorProduct.id, {
                                ourPrice, salePrice, mapPrice, isViolation, 
                                difference: priceToCheck - mapPrice
                            });
                        }
                    }
                });

                const matchedIds = new Set(priceDataMap.keys());

                setProducts(currentProducts => {
                    const updatedProducts = currentProducts.map(p => {
                        if (priceDataMap.has(p.id)) {
                            return { ...p, ...priceDataMap.get(p.id) };
                        }
                        return p;
                    });
                
                    const checkedAndUpdatedProducts = updatedProducts.filter(p => matchedIds.has(p.id));
                    const violationsFromProducts = checkedAndUpdatedProducts.filter(p => p.isViolation);
                    const totalSavingsAtRisk = violationsFromProducts.reduce((sum, p) => sum + Math.abs(p.difference || 0), 0);
                    // FIX: The accumulator 'acc' was untyped, causing 'count' to be 'unknown' in 'brandsAffected'. This caused assignment and arithmetic errors. Typing 'acc' as Record<string, number> resolves them.
                    const brandsAffectedMap = violationsFromProducts.reduce((acc: Record<string, number>, p: any) => {
                        if (p.brand) {
                            acc[p.brand] = (acc[p.brand] || 0) + 1;
                        }
                        return acc;
                    }, {});
                    const brandsAffected = Object.entries(brandsAffectedMap)
                        .map(([name, count]) => ({ name, count }))
                        .sort((a, b) => b.count - a.count);
                
                    setPriceCheckStats({
                        productsChecked: priceDataMap.size,
                        totalSavingsAtRisk,
                        brandsAffected
                    });
                
                    return updatedProducts;
                });
                
                setHasPriceCheckData(true);
                setCheckedProductIds(matchedIds);
                setFilters(p => ({ ...p, violationsOnly: true, search: '', brand: 'all' }));
                setCurrentPage(1);

                const violationCount = Array.from(priceDataMap.values()).filter(r => r.isViolation).length;
                addLog(`Compliance check complete. Matched ${priceDataMap.size} SKUs. Found ${violationCount} violations.`, 'success');
            }, error: (err) => { addLog(`Error parsing price file: ${err.message}`, 'error'); }
        });
        event.target.value = ''; // Reset file input
    };

    const handleExportSelected = (format = 'default') => {
        const selectedProducts = products.filter(p => selectedIds.has(p.id));
        if (selectedProducts.length === 0) {
            addLog("No products selected for export.", "error");
            return;
        }
        
        let dataToExport;
        let filename = 'selected_products.csv';
    
        if (format === 'rics') {
            dataToExport = selectedProducts.map(p => ({
                'SKU': p.sku,
                'Price': p.ourPrice ?? '',
                'Sale Price': p.salePrice ?? ''
            }));
            filename = 'rics_export.csv';
        } else {
            dataToExport = selectedProducts.map(p => {
              const { id, tolerance, ...rest } = p;
              return rest;
            });
        }
    
        const csv = Papa.unparse(dataToExport);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
        addLog(`Exported ${selectedProducts.length} selected products as ${format}.`, 'success');
    };
    
    const toggleSelect = (id: number) => { setSelectedIds(prev => { const newSet = new Set(prev); if (newSet.has(id)) newSet.delete(id); else newSet.add(id); return newSet; }); };
    const toggleSelectAll = () => {
      setSelectedIds(prev => {
        if (prev.size === paginatedProducts.length && paginatedProducts.length > 0) {
          return new Set();
        } else {
          return new Set(paginatedProducts.map(p => p.id));
        }
      });
    };
    
    useEffect(() => {
        // Clear selection when filters or page change
        setSelectedIds(new Set());
    }, [filters, currentPage, rowsPerPage]);

    return (
        <div className="app-container">
            <Header onRefresh={handleImport} onToggleTheme={toggleTheme} theme={theme} isImporting={isImporting} />
            <main className="main-content">
                <div className="main-column">
                    {showImportBubble && (<ImportBubble onImport={handleImport} onCancel={() => setShowImportBubble(false)} isImporting={isImporting} />)}
                    
                    {products.length > 0 ? (
                       <>
                           <Dashboard 
                                data={dashboardData} 
                                hasPriceCheckData={hasPriceCheckData}
                                priceCheckStats={priceCheckStats}
                            />
                           <ControlsPanel 
                                products={products} 
                                filters={filters} 
                                setFilters={handleFiltersChange} 
                                onUploadPrices={handleUploadPrices} 
                                selectedIds={selectedIds} 
                                onExport={handleExportSelected} 
                                hasPriceCheckData={hasPriceCheckData}
                                onClearPriceCheck={handleClearPriceCheck}
                            />
                           <ResultsView 
                               products={paginatedProducts} 
                               totalProductCount={sortedProducts.length} 
                               sortConfig={sortConfig} 
                               requestSort={requestSort} 
                               selectedIds={selectedIds} 
                               toggleSelect={toggleSelect} 
                               toggleSelectAll={toggleSelectAll} 
                               onRowClick={(product) => setSelectedProduct(product)}
                               hasPriceCheckData={hasPriceCheckData}
                               paginationProps={{ 
                                   currentPage, 
                                   rowsPerPage, 
                                   onPageChange: setCurrentPage, 
                                   onRowsPerPageChange: (r: number) => { setRowsPerPage(r); setCurrentPage(1); } 
                               }} 
                           />
                       </>
                   ) : (
                        !showImportBubble && !isImporting && (<div className="results-placeholder"><h3>Database Empty</h3><p>Use the "Refresh Data" button to import products from your sources.</p></div>)
                   )}

                </div>
                <div className="sidebar-column"><NewsUpdatesPanel /><StatusLog logs={logs} /></div>
            </main>
            <Footer onOpenSettings={() => setSettingsOpen(true)} />
            <SettingsModal isOpen={isSettingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} onSaveSettings={saveSettings} />
            <ProductDetailModal isOpen={!!selectedProduct} onClose={() => setSelectedProduct(null)} product={selectedProduct} />
        </div>
    );
};

const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(<App />);