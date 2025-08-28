import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { openDB, IDBPDatabase } from 'idb';
import Papa from 'papaparse';

// --- CONSTANTS & CONFIG ---
const DB_NAME = 'ShiekhMAPDB';
const STORE_NAME = 'products';
const SETTINGS_KEY = 'shiekhMapSettings';

const getDefaultSettings = () => ({
  dataSources: [
    {
      id: 'puma',
      name: 'Puma',
      url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRZvhcSwzg6uE6dHOOANX_4DBqIP_cUEHycIjfMwFpjONxofEgWbkFsdlOL-JDm2w/pub?output=csv',
      delimiter: ',',
      enabled: true,
      headerRow: 3,
      tolerance: 0.05,
      columns: {
        sku: 'A',
        productName: 'B',
        price: 'I',
        category: 'F',
        color: 'C',
        gender: 'D'
      }
    },
    {
      id: 'nike',
      name: 'Nike',
      url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQUry3OuGo26H7oTV3nZlRh3k0k0wV82m1Y9mDBXCIH1upQAIlpkYXmal42DB6Cig/pub?output=csv',
      delimiter: ',',
      enabled: true,
      headerRow: 2,
      tolerance: 0.05,
      columns: {
        sku: 'C',
        productName: 'D',
        price: 'H',
        category: 'F',
        color: 'E',
        gender: 'G'
      }
    },
    {
      id: 'new_balance',
      name: 'New Balance',
      url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTna228DtiB54_PP6ZRNi7i2Ocbt8fYXEap05kVaMkGyQnebBqfl16yAm9BMEKfEw/pub?output=csv',
      delimiter: ',',
      enabled: true,
      headerRow: 1,
      tolerance: 0.05,
      columns: {
        sku: 'I',
        productName: 'J',
        price: 'O',
        category: 'D',
        color: 'K',
        gender: 'F'
      }
    },
    {
      id: 'adidas',
      name: 'Adidas',
      url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTVE1EueNaZebSSEluaC2rmOT0YOZAVncIxQmOKRVCuT7dLuy9uu4aD8IMfj6nvHA/pub?output=csv',
      delimiter: ',',
      enabled: true,
      headerRow: 1,
      tolerance: 0.05,
      columns: {
        sku: 'E',
        productName: 'F',
        price: 'K',
        category: 'H',
        color: 'G',
        gender: 'I'
      }
    }
  ],
  companyLogo: '',
  uploadColumnMapping: {
    sku: 'sku',
    price: 'price',
    salePrice: 'salePrice'
  }
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

const clearProducts = async () => {
    const db = await getDb();
    await db.clear(STORE_NAME);
};

const saveProducts = async (products: any[]) => {
    const db = await getDb();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    await Promise.all(products.map(product => tx.store.put(product)));
    await tx.done;
};

const updateProduct = async (product: any) => {
    const db = await getDb();
    await db.put(STORE_NAME, product);
};

const getAllProducts = async () => {
    const db = await getDb();
    return db.getAll(STORE_NAME);
};

// --- DATA IMPORT ENGINE ---
const normalizeSku = (sku: string) => sku ? String(sku).replace(/-/g, '').trim() : '';

const fetchAndParseSheetData = async (source: any) => {
    const urlToFetch = `https://corsproxy.io/?${encodeURIComponent(source.url)}`;

    const response = await fetch(urlToFetch);
    if (!response.ok) {
        throw new Error(`Failed to fetch data for ${source.name}. Status: ${response.statusText}`);
    }
    const textData = await response.text();

    return new Promise<string[][]>((resolve, reject) => {
        Papa.parse(textData, {
            complete: (results) => {
                const data = results.data as string[][];
                if (data.length < source.headerRow) {
                    resolve([]);
                } else {
                    resolve(data.slice(source.headerRow - 1));
                }
            },
            error: (error) => reject(error),
        });
    });
};

const columnLetterToIndex = (letter: string) => {
    if (!letter) return -1;
    let column = 0, length = letter.length;
    for (let i = 0; i < length; i++) {
        column += (letter.charCodeAt(i) - 64) * Math.pow(26, length - i - 1);
    }
    return column - 1;
};

const runImport = async (settings: ReturnType<typeof getDefaultSettings>, addLog: (message: string, type?: 'info' | 'success' | 'error') => void) => {
    addLog('Starting data import process...', 'info');
    try {
        await clearProducts();
        addLog('Cleared existing product data from IndexedDB.');
    } catch (error) {
        addLog(`Error clearing database: ${(error as Error).message}`, 'error');
        return;
    }

    let totalProducts = 0;
    for (const source of settings.dataSources.filter(s => s.enabled)) {
        addLog(`[${source.name}] Starting import...`);
        try {
            const data = await fetchAndParseSheetData(source);
            if (!data || data.length < 1) {
                throw new Error('No data found after fetch.');
            }

            const rows = data;
            const mapping = source.columns;
            
            if (!mapping) throw new Error(`No column mapping found for ${source.name}.`);

            const standardHeaders = Object.keys(mapping);
            const columnIndexMap = standardHeaders.reduce((acc, stdHeader) => {
                const colLetter = mapping[stdHeader as keyof typeof mapping];
                if (colLetter) {
                    acc[stdHeader] = columnLetterToIndex(colLetter.toUpperCase());
                } else {
                    addLog(`[${source.name}] Warning: Column letter for "${stdHeader}" not defined.`, 'error');
                    acc[stdHeader] = -1;
                }
                return acc;
            }, {} as Record<string, number>);

            const products = rows.map(row => {
                const product: Record<string, any> = { brand: source.name, tolerance: source.tolerance };
                for (const stdHeader of standardHeaders) {
                    const index = columnIndexMap[stdHeader];
                    product[stdHeader] = index !== -1 && index < row.length ? row[index] : null;
                }
                return product;
            }).filter(p => p.sku && String(p.sku).trim() !== '');

            await saveProducts(products);
            totalProducts += products.length;
            addLog(`[${source.name}] Successfully imported ${products.length} products.`, 'success');

        // Fixed: Corrected `catch` syntax from `catch (error) => {` to `catch (error) {`
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
            if (storedSettings) {
                const parsed = JSON.parse(storedSettings);
                // Ensure new settings fields exist
                return { ...getDefaultSettings(), ...parsed };
            }
            return getDefaultSettings();
        } catch (error) {
            return getDefaultSettings();
        }
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

const Footer = ({ onOpenSettings }: any) => (
    <footer className="footer">
        <span className="link" onClick={onOpenSettings}>Settings & Help Center</span>
    </footer>
);

const ImportBubble = ({ onImport, onCancel, isImporting }: any) => (
    <div className="import-bubble">
        <h3>Welcome!</h3>
        <p>No data found. Import data from your sources to get started.</p>
        <div className="import-bubble-actions">
            <button className="btn btn-primary" onClick={onImport} disabled={isImporting}>
                {isImporting ? 'Importing...' : 'Import Now'}
            </button>
            <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
    </div>
);

const StatusLog = ({ logs }: { logs: { time: string, message: string, type: string }[] }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const logEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isExpanded) {
            logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, isExpanded]);

    return (
        <div className="status-log-panel">
            <h2 className="panel-header" onClick={() => setIsExpanded(!isExpanded)}>
                <TerminalIcon />
                Status Log
                <span className={`collapse-icon ${isExpanded ? '' : 'expanded'}`}>
                    <ChevronUpIcon />
                </span>
            </h2>
            {isExpanded && (
                <div className="status-log-content">
                    {logs.length === 0 ? (
                        <div className="log-placeholder">Logs will appear here when you import data.</div>
                    ) : (
                        logs.slice(-20).map((log, index) => (
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

const newsUpdates = [
  { date: 'Aug 28', title: 'New compliance report view added' },
  { date: 'Aug 27', title: 'Per-brand tolerance settings now available' },
  { date: 'Aug 20', title: 'Nike MAP policy updated' },
];

const NewsUpdatesPanel = () => {
    const [isExpanded, setIsExpanded] = useState(true);

    return (
        <div className="news-updates-panel">
            <h2 className="panel-header" onClick={() => setIsExpanded(!isExpanded)}>
                <NewspaperIcon />
                News & Updates
                <span className={`collapse-icon ${isExpanded ? '' : 'expanded'}`}>
                    <ChevronUpIcon />
                </span>
            </h2>
            {isExpanded && (
                <div className="news-content">
                    {newsUpdates.map((item, index) => (
                        <div className="news-item" key={index}>
                            <div className="news-date">{item.date}</div>
                            <div className="news-title">{item.title}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const SettingsModal = ({ isOpen, onClose, settings, onSaveSettings }: any) => {
    const [activeTab, setActiveTab] = useState('sources');
    const [localSettings, setLocalSettings] = useState(settings);

    useEffect(() => {
        setLocalSettings(settings);
    }, [settings, isOpen]);

    if (!isOpen) return null;

    const handleSave = () => {
        onSaveSettings(localSettings);
        onClose();
    };
    
    const handleSourceChange = (id: string, field: string, value: any) => {
        setLocalSettings((prev: any) => ({
            ...prev,
            dataSources: prev.dataSources.map((s: any) =>
                s.id === id ? { ...s, [field]: value } : s
            )
        }));
    };

    const handleMappingChange = (field: string, value: string) => {
        setLocalSettings((prev: any) => ({
            ...prev,
            uploadColumnMapping: {
                ...prev.uploadColumnMapping,
                [field]: value,
            }
        }));
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Settings & Help Center</h2>
                    <button className="icon-btn" onClick={onClose} aria-label="Close modal"><CloseIcon /></button>
                </div>
                <div className="modal-body">
                    <div className="tabs">
                        <button className={`tab ${activeTab === 'sources' && 'active'}`} onClick={() => setActiveTab('sources')}>Data Sources</button>
                        <button className={`tab ${activeTab === 'mappings' && 'active'}`} onClick={() => setActiveTab('mappings')}>Upload Mapping</button>
                        <button className={`tab ${activeTab === 'help' && 'active'}`} onClick={() => setActiveTab('help')}>Help & Support</button>
                    </div>
                    {activeTab === 'sources' && (
                        <div>
                            {localSettings.dataSources.map((source: any) => (
                                <div className="form-group-grid" key={source.id}>
                                    <label>{source.name}</label>
                                    <div className="input-group">
                                        <input
                                            type="text"
                                            className="input"
                                            value={source.url}
                                            onChange={(e) => handleSourceChange(source.id, 'url', e.target.value)}
                                            placeholder="Google Sheet URL"
                                        />
                                        <div className="input-with-label">
                                            <span>Header Row</span>
                                            <input
                                                type="number" min="1"
                                                className="input header-row-input"
                                                value={source.headerRow}
                                                onChange={(e) => handleSourceChange(source.id, 'headerRow', parseInt(e.target.value) || 1)}
                                            />
                                        </div>
                                        <div className="input-with-label">
                                            <span>Tolerance</span>
                                            <input
                                                type="number" step="0.01" min="0"
                                                className="input header-row-input"
                                                value={source.tolerance}
                                                onChange={(e) => handleSourceChange(source.id, 'tolerance', parseFloat(e.target.value) || 0)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {activeTab === 'mappings' && (
                        <div>
                            <h3>Price File Column Mapping</h3>
                            <p>Specify the column headers from your uploaded CSV file.</p>
                            <div className="form-group">
                                <label>SKU Column</label>
                                <input type="text" className="input" value={localSettings.uploadColumnMapping.sku} onChange={e => handleMappingChange('sku', e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Price Column</label>
                                <input type="text" className="input" value={localSettings.uploadColumnMapping.price} onChange={e => handleMappingChange('price', e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Sale Price Column (Optional)</label>
                                <input type="text" className="input" value={localSettings.uploadColumnMapping.salePrice} onChange={e => handleMappingChange('salePrice', e.target.value)} />
                            </div>
                        </div>
                    )}
                    {activeTab === 'help' && (
                        <div className="help-content">
                            <h3>Contact Support</h3>
                            <p>For any issues or questions regarding the MAP Intelligence Platform, please contact our support team.</p>
                            <p><strong>Email:</strong> <a href="mailto:theo@shiekh.com" className="link">theo@shiekh.com</a></p>
                        </div>
                    )}
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleSave}>Save Changes</button>
                </div>
            </div>
        </div>
    );
};

const ComplianceDetailModal = ({ isOpen, onClose, result }: any) => {
    if (!isOpen || !result) return null;
    
    const { ourPrice, salePrice, mapPrice, tolerance } = result;
    const priceUsed = salePrice !== null && salePrice !== undefined ? salePrice : ourPrice;
    const effectiveMap = mapPrice - tolerance;
    
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content compliance-detail-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Compliance Details</h2>
                    <button className="icon-btn" onClick={onClose} aria-label="Close modal"><CloseIcon /></button>
                </div>
                <div className="modal-body">
                    <div className="product-summary">
                        <span className="product-summary-brand">{result.brand}</span>
                        <h3>{result.productName}</h3>
                        <p>SKU: {result.sku}</p>
                    </div>
                    
                    <div className="insight-content">
                        <div className="insight-grid">
                            <div className="insight-item">
                                <h4>Your Price</h4>
                                <p className="insight-value">${ourPrice?.toFixed(2)}</p>
                            </div>
                            <div className="insight-item">
                                <h4>Your Sale Price</h4>
                                <p className="insight-value">{salePrice ? `$${salePrice.toFixed(2)}` : 'N/A'}</p>
                            </div>
                            <div className="insight-item">
                                <h4>Vendor MAP</h4>
                                <p className="insight-value">${mapPrice?.toFixed(2)}</p>
                            </div>
                            <div className="insight-item">
                                <h4>Brand Tolerance</h4>
                                <p className="insight-value">${tolerance?.toFixed(2)}</p>
                            </div>
                        </div>
                         <div className="insight-calculation">
                            <h4>Violation Check</h4>
                            <p>The system compares your <strong>{salePrice ? 'sale price' : 'price'}</strong> to the vendor's MAP minus tolerance.</p>
                            <code>${priceUsed?.toFixed(2)} (Your Price) &lt; ${effectiveMap.toFixed(2)} (Effective MAP)</code>
                            <div className={`insight-result ${result.isViolation ? 'violation' : 'ok'}`}>
                                Status: {result.isViolation ? 'VIOLATION' : 'OK'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const Dashboard = ({ data }: any) => {
    const { totalSkus, mapViolations, brandBreakdown } = data;
    const maxCount = Math.max(...brandBreakdown.map((b: any) => b.count), 0);
  
    return (
      <div className="dashboard">
        <div className="kpi-card-grid">
          <div className="kpi-card">
            <div className="kpi-value">{totalSkus.toLocaleString()}</div>
            <div className="kpi-label">Total SKUs in DB</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-value violation-value">{mapViolations.toLocaleString()}</div>
            <div className="kpi-label">Active MAP Violations</div>
          </div>
        </div>
        <div className="chart-container">
          <h3>Brand Breakdown</h3>
          <div className="bar-chart">
            {brandBreakdown.length > 0 ? brandBreakdown.map((brand: any) => (
              <div className="bar-wrapper" key={brand.name}>
                <div className="bar-label">{brand.name}</div>
                <div className="bar">
                  <div 
                    className="bar-fill" 
                    style={{ width: `${maxCount > 0 ? (brand.count / maxCount) * 100 : 0}%` }}
                  ></div>
                </div>
                <div className="bar-value">{brand.count.toLocaleString()}</div>
              </div>
            )) : <p className="chart-placeholder">No data to display.</p>}
          </div>
        </div>
      </div>
    );
};
  
const ControlsPanel = ({ products, filters, setFilters, onUploadPrices, onExport, selectedIds, onSelectAll }: any) => {
    const uniqueBrands = useMemo(() => ['all', ...new Set(products.map((p: any) => p.brand))], [products]);
    const uniqueCategories = useMemo(() => ['all', ...new Set(products.map((p: any) => p.category).filter(Boolean))], [products]);
    const uploadRef = useRef<HTMLInputElement>(null);
  
    const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setFilters((prev: any) => ({ ...prev, [e.target.name]: e.target.value }));
    };
  
    return (
      <div className="controls-panel">
        <div className="filters">
            <input
                type="text"
                name="search"
                className="input search-input"
                placeholder="Search SKU or Name..."
                value={filters.search}
                onChange={handleFilterChange}
            />
            <select name="brand" className="input filter-select" value={filters.brand} onChange={handleFilterChange}>
                {uniqueBrands.map((b: string) => <option key={b} value={b}>{b === 'all' ? 'All Brands' : b}</option>)}
            </select>
            <select name="category" className="input filter-select" value={filters.category} onChange={handleFilterChange}>
                {uniqueCategories.map((c: string) => <option key={c} value={c}>{c === 'all' ? 'All Categories' : c}</option>)}
            </select>
        </div>
        <div className="actions">
            <input type="file" ref={uploadRef} style={{ display: 'none' }} accept=".csv" onChange={onUploadPrices} />
            <button className="btn btn-primary" onClick={() => uploadRef.current?.click()}>Upload My Prices & Check</button>
        </div>
      </div>
    );
};

const TableView = ({ products, sortConfig, requestSort, selectedIds, toggleSelect, handleUpdateProduct, editedProductIds }: any) => {
    const SortableHeader = ({ field, label }: { field: string, label: string }) => {
        const isSorted = sortConfig?.key === field;
        const direction = isSorted ? sortConfig.direction : 'none';
        return (
            <th onClick={() => requestSort(field)} className="sortable">
                {label}
                <span className="sort-icon">
                    {direction === 'ascending' && <ChevronUpIcon />}
                    {direction === 'descending' && <ChevronDownIcon />}
                </span>
            </th>
        );
    };

    return (
        <div className="table-responsive">
            <table className="results-table">
                <thead>
                    <tr>
                        <SortableHeader field="sku" label="SKU" />
                        <SortableHeader field="productName" label="Product Name" />
                        <SortableHeader field="brand" label="Brand" />
                        <SortableHeader field="category" label="Category" />
                        <SortableHeader field="price" label="MAP Price" />
                    </tr>
                </thead>
                <tbody>
                    {products.map((p: any) => (
                        <tr key={p.id} className={`${editedProductIds.has(p.id) ? 'is-edited' : ''}`}>
                            <td contentEditable suppressContentEditableWarning onBlur={(e) => handleUpdateProduct(p.id, 'sku', e.currentTarget.textContent || '')}>{p.sku}</td>
                            <td contentEditable suppressContentEditableWarning onBlur={(e) => handleUpdateProduct(p.id, 'productName', e.currentTarget.textContent || '')}>{p.productName}</td>
                            <td contentEditable suppressContentEditableWarning onBlur={(e) => handleUpdateProduct(p.id, 'brand', e.currentTarget.textContent || '')}>{p.brand}</td>
                            <td contentEditable suppressContentEditableWarning onBlur={(e) => handleUpdateProduct(p.id, 'category', e.currentTarget.textContent || '')}>{p.category}</td>
                            <td contentEditable suppressContentEditableWarning onBlur={(e) => handleUpdateProduct(p.id, 'price', e.currentTarget.textContent || '')}>{p.price}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const PaginationControls = ({ currentPage, rowsPerPage, totalRows, onPageChange, onRowsPerPageChange }: any) => {
    const totalPages = Math.ceil(totalRows / rowsPerPage);
    if (totalPages <= 1) return null;
    
    const canGoBack = currentPage > 1;
    const canGoForward = currentPage < totalPages;

    return (
        <div className="pagination-controls">
            <div className="rows-per-page-selector">
                <label htmlFor="rowsPerPage">Rows per page:</label>
                <select id="rowsPerPage" className="input" value={rowsPerPage} onChange={e => onRowsPerPageChange(Number(e.target.value))}>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                </select>
            </div>
            <div className="page-navigator">
                <button className="btn btn-secondary" onClick={() => onPageChange(currentPage - 1)} disabled={!canGoBack}>
                    &lt; Prev
                </button>
                <span>Page {currentPage} of {totalPages}</span>
                <button className="btn btn-secondary" onClick={() => onPageChange(currentPage + 1)} disabled={!canGoForward}>
                    Next &gt;
                </button>
            </div>
        </div>
    );
};

const ResultsView = ({ products, totalProductCount, sortConfig, requestSort, handleUpdateProduct, editedProductIds, paginationProps }: any) => {
    if (totalProductCount === 0) {
        return <div className="results-placeholder">No products match the current filters.</div>;
    }

    return (
        <div className="results-view-container">
            <TableView products={products} sortConfig={sortConfig} requestSort={requestSort} selectedIds={null} toggleSelect={() => {}} handleUpdateProduct={handleUpdateProduct} editedProductIds={editedProductIds} />
            <PaginationControls {...paginationProps} totalRows={totalProductCount} />
        </div>
    );
};

const ComplianceResultsView = ({ results, onExportViolations, onClear, onRowClick }: any) => {
    const [showViolationsOnly, setShowViolationsOnly] = useState(false);
    
    const violations = useMemo(() => results.filter(r => r.isViolation), [results]);
    const filteredResults = showViolationsOnly ? violations : results;

    return (
        <div className="results-view-container compliance-view">
            <div className="compliance-header">
                <div className="compliance-summary">
                    <span>Checked: <strong>{results.length.toLocaleString()}</strong></span>
                    <span className="violation-value">Violations: <strong>{violations.length.toLocaleString()}</strong></span>
                </div>
                <div className="compliance-controls">
                    <label className="checkbox-label">
                        <input type="checkbox" checked={showViolationsOnly} onChange={() => setShowViolationsOnly(p => !p)} />
                        Show Violations Only
                    </label>
                    <button className="btn btn-secondary" onClick={onExportViolations} disabled={violations.length === 0}>Export Violations</button>
                    <button className="btn btn-secondary" onClick={onClear}>Clear Results</button>
                </div>
            </div>
            <div className="table-responsive">
                <table className="results-table">
                    <thead>
                        <tr>
                            <th>SKU</th>
                            <th>Brand</th>
                            <th>Our Price</th>
                            <th>Sale Price</th>
                            <th>Vendor MAP</th>
                            <th>Difference</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredResults.map((r, index) => (
                            <tr key={index} onClick={() => onRowClick(r)} className={r.isViolation ? 'is-violation' : ''}>
                                <td>{r.sku}</td>
                                <td>{r.brand}</td>
                                <td>${r.ourPrice?.toFixed(2)}</td>
                                <td>{r.salePrice ? `$${r.salePrice.toFixed(2)}` : 'N/A'}</td>
                                <td>${r.mapPrice?.toFixed(2)}</td>
                                <td className={r.difference < 0 ? 'difference-negative' : ''}>
                                    {r.difference < 0 ? `-$${Math.abs(r.difference).toFixed(2)}` : `$${r.difference.toFixed(2)}`}
                                </td>
                                <td>
                                    {r.isViolation ? <span className="status-violation">Violation</span> : <span className="status-ok">OK</span>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
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
    const [complianceResults, setComplianceResults] = useState<any[]>([]);
    const [filters, setFilters] = useState({ search: '', brand: 'all', category: 'all' });
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: string } | null>({ key: 'sku', direction: 'ascending' });
    const [selectedComplianceResult, setSelectedComplianceResult] = useState<any | null>(null);
    const [hasUserInteracted, setHasUserInteracted] = useState(false);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    const [currentPage, setCurrentPage] = useState(1);
    const [editedProductIds, setEditedProductIds] = useState<Set<number>>(new Set());

    const fetchAllProducts = useCallback(async () => {
        const allProducts = await getAllProducts();
        setProducts(allProducts);
        setShowImportBubble(allProducts.length === 0 && complianceResults.length === 0);
    }, [complianceResults]);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    useEffect(() => {
        fetchAllProducts();
    }, []);

    const addLog = useCallback((message: string, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        setLogs(prevLogs => [...prevLogs, { time, message, type }]);
    }, []);
    
    const handleImport = useCallback(async () => {
        setImporting(true);
        setLogs([]);
        setComplianceResults([]);
        await runImport(settings, addLog);
        await fetchAllProducts();
        setImporting(false);
    }, [settings, addLog, fetchAllProducts]);

    const toggleTheme = () => setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');

    const vendorProductMap = useMemo(() => {
        const map = new Map<string, any>();
        products.forEach(p => {
            const normalized = normalizeSku(p.sku);
            if (normalized) map.set(normalized, p);
        });
        return map;
    }, [products]);

    const filteredProducts = useMemo(() => {
        const searchLower = filters.search.toLowerCase();
        return products
          .filter(p => {
            const searchMatch = !filters.search || normalizeSku(p.sku)?.toLowerCase().includes(searchLower) || p.productName?.toLowerCase().includes(searchLower);
            const brandMatch = filters.brand === 'all' || p.brand === filters.brand;
            const categoryMatch = filters.category === 'all' || p.category === filters.category;
            return searchMatch && brandMatch && categoryMatch;
          });
    }, [products, filters]);

    const sortedProducts = useMemo(() => {
        if (!sortConfig) return filteredProducts;
        const sorted = [...filteredProducts];
        sorted.sort((a, b) => {
            const aVal = a[sortConfig.key];
            const bVal = b[sortConfig.key];
            if (aVal < bVal) return sortConfig.direction === 'ascending' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'ascending' ? 1 : -1;
            return 0;
        });
        return sorted;
    }, [filteredProducts, sortConfig]);
    
    const paginatedProducts = useMemo(() => {
        const startIndex = (currentPage - 1) * rowsPerPage;
        return sortedProducts.slice(startIndex, startIndex + rowsPerPage);
    }, [sortedProducts, currentPage, rowsPerPage]);

    const dashboardData = useMemo(() => {
        return {
            totalSkus: products.length,
            mapViolations: complianceResults.filter(p => p.isViolation).length,
            brandBreakdown: Object.entries(products.reduce((acc, p) => {
                acc[p.brand] = (acc[p.brand] || 0) + 1;
                return acc;
            }, {})).map(([name, count]) => ({ name, count })).sort((a, b) => (b.count as number) - (a.count as number)),
        };
    }, [products, complianceResults]);

    const requestSort = (key: string) => {
        let direction = 'ascending';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const handleFiltersChange = (updater: React.SetStateAction<typeof filters>) => {
        setFilters(updater);
        setCurrentPage(1);
        setHasUserInteracted(true);
    };

    const handleUploadPrices = (event: React.ChangeEvent<HTMLInputElement>) => {
        setComplianceResults([]);
        const file = event.target.files?.[0];
        if (!file) return;
        addLog(`Parsing price file: ${file.name}`);
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                const newComplianceResults: any[] = [];
                const mapping = settings.uploadColumnMapping;
                
                for (const row of results.data as any[]) {
                    const retailerSku = row[mapping.sku];
                    if (!retailerSku) continue;

                    const normalizedRetailerSku = normalizeSku(retailerSku);
                    const vendorProduct = vendorProductMap.get(normalizedRetailerSku);

                    if (vendorProduct) {
                        const ourPrice = parseFloat(row[mapping.price]);
                        const salePrice = row[mapping.salePrice] ? parseFloat(row[mapping.salePrice]) : null;
                        const mapPrice = parseFloat(String(vendorProduct.price).replace(/[^0-9.-]+/g,""));
                        const tolerance = vendorProduct.tolerance || 0;

                        if (isNaN(mapPrice) || isNaN(ourPrice)) continue;

                        const priceToCheck = (salePrice !== null && !isNaN(salePrice)) ? salePrice : ourPrice;
                        const isViolation = priceToCheck < (mapPrice - tolerance);
                        
                        newComplianceResults.push({
                            ...vendorProduct,
                            sku: retailerSku, // Keep original retailer SKU for display
                            ourPrice,
                            salePrice,
                            mapPrice,
                            isViolation,
                            difference: priceToCheck - mapPrice,
                        });
                    }
                }
                setComplianceResults(newComplianceResults);
                addLog(`Compliance check complete. Checked ${newComplianceResults.length} SKUs. Found ${newComplianceResults.filter(r => r.isViolation).length} violations.`, 'success');
            },
            error: (err) => {
                addLog(`Error parsing price file: ${err.message}`, 'error');
            }
        });
        event.target.value = ''; // Reset file input
    };

    const handleExportViolations = () => {
        const violations = complianceResults.filter(r => r.isViolation).map(r => ({
            SKU: r.sku,
            Brand: r.brand,
            ProductName: r.productName,
            OurPrice: r.ourPrice,
            SalePrice: r.salePrice,
            VendorMAP: r.mapPrice,
            Difference: r.difference,
        }));
        if (violations.length === 0) return;

        const csv = Papa.unparse(violations);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', 'map_violations.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        addLog(`Exported ${violations.length} violations to CSV.`, 'success');
    };
    
    const handleUpdateProduct = async (productId: number, field: string, value: string) => {
        const productToUpdate = products.find(p => p.id === productId);
        if (productToUpdate && productToUpdate[field] !== value) {
            const updatedProduct = { ...productToUpdate, [field]: value };
            setProducts(prevProducts => prevProducts.map(p => p.id === productId ? updatedProduct : p));
            setEditedProductIds(prev => new Set(prev).add(productId));
            await updateProduct(updatedProduct);
            addLog(`Updated ${field} for SKU ${updatedProduct.sku}.`, 'info');
        }
    };
    
    return (
        <div className="app-container">
            <Header
                onRefresh={handleImport}
                onToggleTheme={toggleTheme}
                theme={theme}
                isImporting={isImporting}
            />
            <main className="main-content">
                <div className="main-column">
                    {showImportBubble && products.length === 0 && (
                        <ImportBubble
                            onImport={handleImport}
                            onCancel={() => setShowImportBubble(false)}
                            isImporting={isImporting}
                        />
                    )}
                    
                    {complianceResults.length > 0 ? (
                        <ComplianceResultsView 
                            results={complianceResults}
                            onExportViolations={handleExportViolations}
                            onClear={() => setComplianceResults([])}
                            onRowClick={(result) => setSelectedComplianceResult(result)}
                        />
                    ) : (
                        <>
                           <Dashboard data={dashboardData} />
                           <ControlsPanel
                                products={products}
                                filters={filters}
                                setFilters={handleFiltersChange}
                                onUploadPrices={handleUploadPrices}
                           />
                           {hasUserInteracted || products.length > 0 ? (
                                <ResultsView 
                                    products={paginatedProducts} 
                                    totalProductCount={sortedProducts.length}
                                    sortConfig={sortConfig} 
                                    requestSort={requestSort}
                                    handleUpdateProduct={handleUpdateProduct}
                                    editedProductIds={editedProductIds}
                                    paginationProps={{
                                        currentPage, rowsPerPage,
                                        onPageChange: (p: number) => setCurrentPage(p),
                                        onRowsPerPageChange: (r: number) => { setRowsPerPage(r); setCurrentPage(1); }
                                    }}
                                />
                            ) : (
                                <div className="results-placeholder">
                                    <h3>Ready to Analyze</h3>
                                    <p>Search vendor products or upload your prices to begin.</p>
                                </div>
                            )}
                        </>
                    )}
                </div>
                <div className="sidebar-column">
                    <NewsUpdatesPanel />
                    <StatusLog logs={logs} />
                </div>
            </main>
            <Footer onOpenSettings={() => setSettingsOpen(true)} />
            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setSettingsOpen(false)}
                settings={settings}
                onSaveSettings={saveSettings}
            />
            <ComplianceDetailModal 
                isOpen={!!selectedComplianceResult}
                onClose={() => setSelectedComplianceResult(null)}
                result={selectedComplianceResult}
            />
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    container.classList.remove('loading-container');
    root.render(<App />);
}
