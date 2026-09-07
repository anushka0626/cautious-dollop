import { useState, useEffect } from 'react';
import { Activity, ArrowRight, Check, AlertTriangle, Clipboard, FileCheck2, Fingerprint, LockKeyhole, ShieldCheck, Upload, Wifi, RefreshCw } from 'lucide-react';
import './App.css';

const API_BASE_URL = 'http://localhost:5000/api';
const DEFAULT_CASE_ID = 'MH-PUN-2026-001';

// Helper: Calculate browser-side SHA-256 hex digest
async function computeFileSHA256(file) {
  const buffer = await file.arrayBuffer();
  const digestBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(digestBuffer));
  return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function App() {
  const [activeTab, setActiveTab] = useState('ingest');
  
  // Ingest State
  const [file, setFile] = useState(null);
  const [caseId, setCaseId] = useState(DEFAULT_CASE_ID);
  const [docType, setDocType] = useState('FIR');
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');
  const [blockNumber, setBlockNumber] = useState('');

  // Person 1: Dynamic Timeline State
  const [docketList, setDocketList] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Person 1: Live Tamper Check State
  const [verifyFile, setVerifyFile] = useState(null);
  const [computedVerifyHash, setComputedVerifyHash] = useState('');
  const [manualHash, setManualHash] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [tamperStatus, setTamperStatus] = useState(null); // 'authentic' | 'tampered'

  const resetIngest = () => { 
    setFile(null); 
    setAnalysis(null); 
    setError(''); 
    setTxHash(''); 
    setBlockNumber('');
  };

  // 1. Analyze Document
  const processDocument = async (selectedFile) => {
    if (!selectedFile) return;
    setFile(selectedFile); 
    setAnalysis(null); 
    setError(''); 
    setBusy(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(`${API_BASE_URL}/evidence/analyze`, { 
        method: 'POST', 
        body: formData 
      });
      const data = await response.json();
      
      if (!response.ok || data.error) throw new Error(data.error || 'Server analysis failed');

      const missingCount = data.procedural_flags ? data.procedural_flags.length : 0;
      const calculatedScore = Math.max(25, 100 - (missingCount * 25));

      setAnalysis({
        rawText: data.raw_text,
        redactedText: data.redacted_text,
        sections: data.sections_detected || [],
        flags: data.procedural_flags || [],
        score: calculatedScore
      });
    } catch (requestError) { 
      setError(`Analysis failed: ${requestError.message}`); 
    } finally { 
      setBusy(false); 
    }
  };

  // 2. Anchor Encrypted File to Sepolia + MinIO
  const registerDocument = async () => {
    if (!file) return;
    setBusy(true); 
    setError('');

    try {
      // If records already exist in docket, link to the latest hash as parentHash
      const latestParentHash = docketList.length > 0 ? docketList[docketList.length - 1].evidenceHash : null;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('caseId', caseId.trim() || DEFAULT_CASE_ID);
      formData.append('docType', docType);
      if (latestParentHash) formData.append('parentHash', latestParentHash);

      const response = await fetch(`${API_BASE_URL}/evidence/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (!response.ok || data.error) throw new Error(data.error || 'On-chain anchoring failed');

      setTxHash(data.txHash);
      setBlockNumber(data.blockNumber);
      setAnalysis(prev => ({ ...prev, docHash: data.evidenceHash, storageURI: data.storageURI }));
      
      // Auto-refresh dynamic docket
      fetchDocket(caseId);
    } catch (transactionError) { 
      setError(transactionError.message || 'Transaction failed.'); 
    } finally { 
      setBusy(false); 
    }
  };

  // 3. Person 1 Deliverable: Fetch Chronological Chain-of-Custody Docket
  const fetchDocket = async (searchCaseId) => {
    setTimelineLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/evidence/docket/${searchCaseId.trim() || DEFAULT_CASE_ID}`);
      const data = await response.json();
      if (response.ok && data.docket) {
        setDocketList(data.docket);
      }
    } catch (err) {
      console.error('Failed to load docket:', err);
    } finally {
      setTimelineLoading(false);
    }
  };

  useEffect(() => {
    fetchDocket(caseId);
  }, []);

  // 4. Person 1 Deliverable: File Tamper-Check via Live Hashing
  const handleVerifyFileUpload = async (selectedFile) => {
    if (!selectedFile) return;
    setVerifyFile(selectedFile);
    setTamperStatus(null);
    setVerifyResult(null);
    setError('');
    setBusy(true);

    try {
      const liveHash = await computeFileSHA256(selectedFile);
      setComputedVerifyHash(liveHash);

      // Verify computed hash directly against Sepolia
      const response = await fetch(`${API_BASE_URL}/evidence/verify/${liveHash}`);
      const data = await response.json();

      if (data.authentic) {
        setTamperStatus('authentic');
        setVerifyResult(data.record);
      } else {
        setTamperStatus('tampered');
      }
    } catch (err) {
      setError(`Verification query failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const copyHash = (hash) => navigator.clipboard.writeText(hash);
  const score = analysis?.score ?? 0;

  return (
    <div className="app-shell">
      <header className="institutional-header">
        <div className="brand-lockup">
          <div className="brand-mark"><Fingerprint size={24} /></div>
          <div>
            <p className="eyebrow">Evidence intelligence platform</p>
            <h1>VERITAS LEDGER</h1>
            <p className="system-name">// Digital Evidence &amp; Custody Chain Management System</p>
          </div>
        </div>
        <div className="status-row">
          <span><Wifi size={14} /> Network: Sepolia Testnet <b>Active</b></span>
          <span><ShieldCheck size={14} /> BSA Sec. 63 Engine <b>Online</b></span>
          <span><LockKeyhole size={14} /> Client Encryption <b>Active</b></span>
        </div>
      </header>

      <nav className="workflow-tabs" aria-label="Evidence workflow">
        <button className={activeTab === 'ingest' ? 'active' : ''} onClick={() => { setActiveTab('ingest'); setError(''); }}>
          <Upload size={16} /> Evidence Ingestion &amp; Ledger Anchoring
        </button>
        <button className={activeTab === 'timeline' ? 'active' : ''} onClick={() => { setActiveTab('timeline'); fetchDocket(caseId); }}>
          <Activity size={16} /> Chain of Custody Timeline
        </button>
        <button className={activeTab === 'verify' ? 'active' : ''} onClick={() => { setActiveTab('verify'); setError(''); }}>
          <FileCheck2 size={16} /> Judicial Integrity &amp; Tamper Check
        </button>
      </nav>

      <main>
        {/* TAB 1: INGEST */}
        {activeTab === 'ingest' && (
          <section className="workspace-grid fade-in">
            <div className="primary-column">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">01 / ingest</p>
                  <h2>Anchor evidence to the ledger</h2>
                  <p>Analyse, redact, and notarize dockets without exposing plaintext PII on-chain.</p>
                </div>
                <span className="live-tag"><span /> LIVE PIPELINE</span>
              </div>

              {!analysis && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <input 
                      type="text" 
                      value={caseId} 
                      onChange={(e) => setCaseId(e.target.value)} 
                      placeholder="Case Docket ID (e.g. MH-PUN-2026-001)"
                      style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--card)' }}
                    />
                    <select 
                      value={docType} 
                      onChange={(e) => setDocType(e.target.value)}
                      style={{ padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--card)' }}
                    >
                      <option value="FIR">First Information Report (FIR)</option>
                      <option value="Panchnama">Seizure Memo / Panchnama</option>
                      <option value="ForensicReport">Forensic Analysis Report</option>
                      <option value="Chargesheet">Final Chargesheet</option>
                    </select>
                  </div>

                  <label className={`dropzone ${busy ? 'processing' : ''}`}>
                    <input 
                      type="file" 
                      accept="image/*,application/pdf" 
                      onChange={(event) => processDocument(event.target.files[0])} 
                    />
                    {busy ? <div className="spinner" /> : (
                      <>
                        <Upload size={38} />
                        <strong>{file ? file.name : 'Drop an FIR, Seizure Memo, or Document here'}</strong>
                        <small>Handwritten scans, photos, or evidentiary records</small>
                      </>
                    )}
                  </label>
                </div>
              )}

              {analysis && (
                <div className="report-panel">
                  <div className="report-top">
                    <div>
                      <p className="eyebrow">ANALYSIS REPORT</p>
                      <h2>{analysis.sections.length > 0 ? `BNS Section(s): ${analysis.sections.join(', ')}` : 'Investigation Intake'}</h2>
                      <span className="document-badge">PII Redacted &amp; Extracted</span>
                    </div>
                    <div className="gauge compact" style={{ '--score': `${score * 3.6}deg` }}>
                      <strong>{score}%</strong>
                      <small>compliance</small>
                    </div>
                  </div>

                  {analysis.docHash && (
                    <div className="hash-box">
                      <div>
                        <small>SHA-256 LEDGER HASH</small>
                        <code>{analysis.docHash}</code>
                      </div>
                      <button title="Copy fingerprint" onClick={() => copyHash(analysis.docHash)}>
                        <Clipboard size={17} />
                      </button>
                    </div>
                  )}

                  <div className="report-columns">
                    <div>
                      <h3>Redacted Evidentiary Text</h3>
                      <p className="summary" style={{ whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto' }}>
                        {analysis.redactedText || 'No text extracted.'}
                      </p>
                    </div>
                    <div>
                      <h3>Statutory Compliance Checklist</h3>
                      <ul className="checklist">
                        {analysis.flags.length === 0 ? (
                          <li className="detected">
                            <span><Check size={14} /></span>
                            <div><b>All Statutory Ingredients Present</b><small>Document satisfies BNS/BNSS filing criteria.</small></div>
                          </li>
                        ) : (
                          analysis.flags.map((flag, index) => (
                            <li key={index} className="missing">
                              <span>!</span>
                              <div><b>Procedural Warning</b><small>{flag}</small></div>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  </div>

                  <div className="report-actions">
                    <button 
                      className={`button primary ${txHash ? 'success-anchored' : ''}`} 
                      onClick={registerDocument} 
                      disabled={busy || !!txHash}
                      style={{ cursor: txHash ? 'default' : busy ? 'wait' : 'pointer' }}
                    >
                      <ShieldCheck size={17} /> {busy ? 'Anchoring...' : txHash ? 'Anchored on Ledger' : 'Anchor to Sepolia & MinIO'}
                    </button>
                    <button className="button ghost" onClick={resetIngest}>Clear record</button>
                  </div>
                </div>
              )}

              {txHash && (
                <div className="certificate">
                  <div className="certificate-seal"><ShieldCheck size={32} /></div>
                  <div>
                    <p className="eyebrow">CERTIFICATE OF EVIDENTIARY INTEGRITY</p>
                    <h2>BSA Sec. 63 Admissible</h2>
                    <p>File encrypted in MinIO. Cryptographic hash mined on Sepolia (Block #{blockNumber}).</p>
                    <small>
                      {new Date().toLocaleString()} ·{' '}
                      <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ color: 'var(--emerald)', textDecoration: 'none' }}>
                        TX {txHash.slice(0, 20)}...
                      </a>
                    </small>
                  </div>
                </div>
              )}

              {error && <p className="error-message">{error}</p>}
            </div>

            <aside className="side-column">
              <div className="metric-card">
                <p className="eyebrow">EVIDENTIARY HEALTH</p>
                <div className="gauge" style={{ '--score': `${score * 3.6}deg` }}>
                  <strong>{score}%</strong>
                  <small>compliance</small>
                </div>
                <p className="metric-note">Evaluated against statutory BNS/BNSS benchmarks and PII sensitivity parameters.</p>
              </div>

              <div className="signal-card">
                <p className="eyebrow">PROCESSING SIGNALS</p>
                <div><span className="signal-dot green" /> Local PII Anonymization</div>
                <div><span className="signal-dot green" /> AES-256-GCM Object Store</div>
                <div><span className="signal-dot green" /> Zero-Gas Relayer Active</div>
              </div>
            </aside>
          </section>
        )}

        {/* TAB 2: DYNAMIC CHAIN OF CUSTODY (PERSON 1) */}
        {activeTab === 'timeline' && (
          <section className="timeline-view fade-in">
            <div className="section-heading">
              <div>
                <p className="eyebrow">02 / custody</p>
                <h2>Chronological Chain of Custody</h2>
                <p>Real-time parent-child linked evidentiary trail fetched directly from the Sepolia ledger.</p>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span className="case-state">DOCKET: {caseId}</span>
                <button className="button ghost" onClick={() => fetchDocket(caseId)} title="Refresh docket">
                  <RefreshCw size={14} className={timelineLoading ? 'spinner' : ''} />
                </button>
              </div>
            </div>

            {docketList.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)', background: 'var(--card)', borderRadius: '12px' }}>
                <Activity size={36} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                <p>No anchored documents found for case docket <b>{caseId}</b>.</p>
                <small>Anchor an initial FIR in Tab 01 to start the chain.</small>
              </div>
            ) : (
              <div className="timeline">
                {docketList.map((record, index) => (
                  <div className="timeline-event" key={record.evidenceHash}>
                    <div className="timeline-marker">{index + 1}</div>
                    <div className="timeline-content">
                      <small>{new Date(record.timestamp * 1000).toLocaleString()}</small>
                      <h3>{record.docType}</h3>
                      <p><b>Hash:</b> <code>{record.evidenceHash.slice(0, 18)}...</code></p>
                      <small style={{ color: 'var(--muted)' }}>
                        {record.parentHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' 
                          ? `Parent: ${record.parentHash.slice(0, 12)}...` 
                          : 'Initial Master Record (Root FIR)'}
                      </small>
                    </div>
                    {index < docketList.length - 1 && <ArrowRight className="timeline-arrow" size={20} />}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* TAB 3: JUDICIAL TAMPER CHECK & HASH DIFFING (PERSON 1) */}
        {activeTab === 'verify' && (
          <section className="verify-view fade-in">
            <div className="section-heading">
              <div>
                <p className="eyebrow">03 / judicial review</p>
                <h2>Live Evidentiary Integrity &amp; Tamper Check</h2>
                <p>Drop any document to calculate its real-time cryptographic hash and verify authenticity on Sepolia.</p>
              </div>
              <span className="case-state">IMMUTABLE QUERY</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
              <label className={`dropzone ${busy ? 'processing' : ''}`}>
                <input 
                  type="file" 
                  onChange={(event) => handleVerifyFileUpload(event.target.files[0])} 
                />
                {busy ? <div className="spinner" /> : (
                  <>
                    <FileCheck2 size={38} />
                    <strong>{verifyFile ? verifyFile.name : 'Drop file here to verify against Sepolia'}</strong>
                    <small>Computes SHA-256 in-browser and cross-checks the on-chain registry</small>
                  </>
                )}
              </label>

              {computedVerifyHash && (
                <div className="hash-box">
                  <div>
                    <small>COMPUTED FILE DIGEST</small>
                    <code>{computedVerifyHash}</code>
                  </div>
                  <button title="Copy fingerprint" onClick={() => copyHash(computedVerifyHash)}>
                    <Clipboard size={17} />
                  </button>
                </div>
              )}

              {tamperStatus === 'authentic' && verifyResult && (
                <div className="certificate verification-certificate" style={{ borderColor: 'var(--emerald)' }}>
                  <div className="certificate-seal" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--emerald)' }}>
                    <ShieldCheck size={32} />
                  </div>
                  <div>
                    <p className="eyebrow" style={{ color: 'var(--emerald)' }}>VERIFICATION PASSED — 100% AUTHENTIC</p>
                    <h2>BSA Sec. 63 Validated</h2>
                    <p>Cryptographic hash matches the on-chain master record exactly. No bit-level alterations detected.</p>
                    <div className="result-meta">
                      <span>Mined: {new Date(verifyResult.timestamp * 1000).toLocaleString()}</span>
                      <span>Doc Type: <b>{verifyResult.docType}</b></span>
                      <span>Case: <code>{verifyResult.caseId}</code></span>
                    </div>
                  </div>
                </div>
              )}

              {tamperStatus === 'tampered' && (
                <div className="certificate verification-certificate" style={{ borderColor: '#ef4444', background: 'rgba(239, 68, 68, 0.05)' }}>
                  <div className="certificate-seal" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                    <AlertTriangle size={32} />
                  </div>
                  <div>
                    <p className="eyebrow" style={{ color: '#ef4444' }}>TAMPER DETECTED — HASH MISMATCH</p>
                    <h2 style={{ color: '#ef4444' }}>Evidentiary Chain Broken</h2>
                    <p>This file does not match any registered hash on the Sepolia ledger. It may have been edited, corrupted, or replaced.</p>
                    <small style={{ color: '#ef4444' }}>Inadmissible under Section 63 BSA without valid attestation.</small>
                  </div>
                </div>
              )}
            </div>

            {error && <p className="error-message">{error}</p>}
          </section>
        )}
      </main>

      <footer>
        <span>VERITAS LEDGER / MINISTRY OF HOME AFFAIRS</span>
        <span>ENCRYPTED AT REST · AUDIT TRAIL PRESERVED</span>
      </footer>
    </div>
  );
}

export default App;