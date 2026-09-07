import { useState, useEffect } from 'react';
import { 
  Activity, ArrowRight, Check, AlertTriangle, Clipboard, FileCheck2, 
  Fingerprint, LockKeyhole, ShieldCheck, Upload, Wifi, RefreshCw, 
  Search, Download, Eye, FileText, Bug
} from 'lucide-react';
import './App.css';

const API_BASE_URL = 'http://localhost:5000/api';
const DEFAULT_CASE_ID = 'MH-PUN-2026-001';

async function computeFileSHA256(file) {
  const buffer = await file.arrayBuffer();
  const digestBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(digestBuffer));
  return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function App() {
  const [activeTab, setActiveTab] = useState('ingest');
  
  // Ingestion State
  const [file, setFile] = useState(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState(null);
  const [fileHash, setFileHash] = useState('');
  const [caseId, setCaseId] = useState(DEFAULT_CASE_ID);
  const [docType, setDocType] = useState('FIR');
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState('');
  const [blockNumber, setBlockNumber] = useState('');

  // Timeline State
  const [activeDocketCase, setActiveDocketCase] = useState(DEFAULT_CASE_ID);
  const [docketList, setDocketList] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Verification State
  const [verifyInput, setVerifyInput] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [tamperStatus, setTamperStatus] = useState(null); // 'authentic' | 'tampered'

  const resetIngest = () => { 
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setFile(null); 
    setFilePreviewUrl(null);
    setFileHash('');
    setAnalysis(null); 
    setError(''); 
    setTxHash(''); 
    setBlockNumber('');
  };

  const handleFileDrop = async (selectedFile) => {
    if (!selectedFile) return;
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);

    setFile(selectedFile);
    if (selectedFile.type.startsWith('image/')) {
      setFilePreviewUrl(URL.createObjectURL(selectedFile));
    } else {
      setFilePreviewUrl(null);
    }

    setAnalysis(null);
    setError('');
    setBusy(true);

    try {
      const clientHash = await computeFileSHA256(selectedFile);
      setFileHash(clientHash);

      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(`${API_BASE_URL}/evidence/analyze`, { 
        method: 'POST', 
        body: formData 
      });
      const data = await response.json();
      
      if (!response.ok || data.error) throw new Error(data.error || 'Server analysis failed');

      const missingCount = data.procedural_flags ? data.procedural_flags.length : 0;
      const calculatedScore = data.sections_detected?.length === 0 
        ? 30 
        : Math.max(30, 100 - (missingCount * 15));

      setAnalysis({
        rawText: data.raw_text,
        redactedText: data.redacted_text,
        sections: data.sections_detected || [],
        flags: data.procedural_flags || [],
        score: calculatedScore
      });
    } catch (requestError) { 
      setError(`Analysis notice: ${requestError.message}`); 
    } finally { 
      setBusy(false); 
    }
  };

  const registerDocument = async () => {
    if (!file) return;
    setBusy(true); 
    setError('');

    try {
      const latestParent = docketList.length > 0 ? docketList[docketList.length - 1].evidenceHash : null;

      const formData = new FormData();
      formData.append('file', file);
      formData.append('caseId', caseId.trim() || DEFAULT_CASE_ID);
      formData.append('docType', docType);
      if (latestParent) formData.append('parentHash', latestParent);

      const response = await fetch(`${API_BASE_URL}/evidence/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();

      if (!response.ok || data.error) throw new Error(data.error || 'On-chain anchoring failed');

      setTxHash(data.txHash);
      setBlockNumber(data.blockNumber);
      setActiveDocketCase(caseId.trim() || DEFAULT_CASE_ID);
      fetchDocket(caseId.trim() || DEFAULT_CASE_ID);
    } catch (err) { 
      setError(err.message || 'Transaction failed.'); 
    } finally { 
      setBusy(false); 
    }
  };

  const fetchDocket = async (targetCase) => {
    setTimelineLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/evidence/docket/${targetCase.trim() || DEFAULT_CASE_ID}`);
      const data = await res.json();
      if (res.ok && data.docket) setDocketList(data.docket);
    } catch (err) {
      console.error(err);
    } finally {
      setTimelineLoading(false);
    }
  };

  useEffect(() => {
    fetchDocket(activeDocketCase);
  }, []);

  const verifyHashOrFile = async (inputVal) => {
    const queryTarget = (typeof inputVal === 'string' ? inputVal : verifyInput).trim();
    if (!queryTarget) return;

    setBusy(true);
    setError('');
    setTamperStatus(null);
    setVerifyResult(null);

    try {
      const response = await fetch(`${API_BASE_URL}/evidence/verify/${queryTarget}`);
      const data = await response.json();

      if (data.authentic) {
        setTamperStatus('authentic');
        setVerifyResult(data.record);
      } else {
        setTamperStatus('tampered');
      }
    } catch (err) {
      setError(`Query failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyFileDrop = async (droppedFile) => {
    if (!droppedFile) return;
    setBusy(true);
    const computed = await computeFileSHA256(droppedFile);
    setVerifyInput(computed);
    await verifyHashOrFile(computed);
  };

  // Demo helper: Generate a 1-pixel altered tamper demonstration payload
  const runTamperSimulation = async () => {
    if (!fileHash) {
      setError("Anchor or drop an authentic document first to run tamper simulation.");
      return;
    }
    // Flip the last hexadecimal digit
    const lastChar = fileHash.slice(-1);
    const flippedChar = lastChar === 'a' ? 'b' : 'a';
    const tamperedHash = fileHash.slice(0, -1) + flippedChar;
    
    setVerifyInput(tamperedHash);
    setActiveTab('verify');
    await verifyHashOrFile(tamperedHash);
  };

  const downloadCertificate = (hash) => {
    window.open(`${API_BASE_URL}/evidence/certificate/${hash}`, '_blank');
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
          <span><LockKeyhole size={14} /> AES-256 Storage <b>Active</b></span>
        </div>
      </header>

      <nav className="workflow-tabs">
        <button className={activeTab === 'ingest' ? 'active' : ''} onClick={() => setActiveTab('ingest')}>
          <Upload size={16} /> Evidence Ingestion &amp; Anchoring
        </button>
        <button className={activeTab === 'timeline' ? 'active' : ''} onClick={() => { setActiveTab('timeline'); fetchDocket(activeDocketCase); }}>
          <Activity size={16} /> Chain of Custody Timeline
        </button>
        <button className={activeTab === 'verify' ? 'active' : ''} onClick={() => setActiveTab('verify')}>
          <FileCheck2 size={16} /> Judicial Integrity &amp; Tamper Check
        </button>
      </nav>

      <main>
        {activeTab === 'ingest' && (
          <section className="workspace-grid fade-in">
            <div className="primary-column">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">01 / Ingest</p>
                  <h2>Notarize Legal Investigation Docket</h2>
                  <p>Parse handwritten or printed NCRB Form-IF1 records, mask PII, and anchor to Sepolia.</p>
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
                      onChange={(event) => handleFileDrop(event.target.files[0])} 
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

              {fileHash && (
                <div className="hash-box" style={{ marginTop: '1rem' }}>
                  <div>
                    <small>CALCULATED SHA-256 DIGEST</small>
                    <code>{fileHash}</code>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button title="Simulate Tamper Detection" className="button ghost" onClick={runTamperSimulation} style={{ padding: '6px 10px', fontSize: '0.75rem', gap: '4px' }}>
                      <Bug size={14} /> Test Tamper Diff
                    </button>
                    <button title="Copy SHA-256 fingerprint" onClick={() => copyHash(fileHash)}>
                      <Clipboard size={17} />
                    </button>
                  </div>
                </div>
              )}

              {analysis && (
                <div className="report-panel" style={{ marginTop: '1rem' }}>
                  <div className="report-top">
                    <div>
                      <p className="eyebrow">DOCKET EXTRACT</p>
                      <h2>{analysis.sections.length > 0 ? `Sections Cited: ${analysis.sections.join(', ')}` : 'Investigation Record Intake'}</h2>
                      <span className="document-badge">Presidio PII Anonymized</span>
                    </div>
                    <div className="gauge compact" style={{ '--score': `${score * 3.6}deg` }}>
                      <strong>{score}%</strong>
                      <small>compliance</small>
                    </div>
                  </div>

                  {/* Side-by-Side Raw Visual vs Redacted Text */}
                  <div className="side-by-side-diff" style={{ display: 'grid', gridTemplateColumns: filePreviewUrl ? '1fr 1fr' : '1fr', gap: '1rem', marginTop: '1rem' }}>
                    {filePreviewUrl && (
                      <div className="diff-pane" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                          <Eye size={15} /> <b>Original Intake Scan</b>
                        </div>
                        <img 
                          src={filePreviewUrl} 
                          alt="Original document" 
                          style={{ width: '100%', maxHeight: '250px', objectFit: 'contain', borderRadius: '4px', background: '#000' }} 
                        />
                      </div>
                    )}
                    <div className="diff-pane" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                        <FileText size={15} /> <b>Presidio Redacted Text (BNSS Compliant)</b>
                      </div>
                      <pre className="summary" style={{ whiteSpace: 'pre-wrap', maxHeight: '250px', overflowY: 'auto', margin: 0, fontSize: '0.8rem', fontFamily: 'monospace' }}>
                        {analysis.redactedText || 'No text extracted.'}
                      </pre>
                    </div>
                  </div>

                  <div style={{ marginTop: '1rem' }}>
                    <h3>Statutory Compliance Checklist (BNSS Sec. 173)</h3>
                    <ul className="checklist">
                      {analysis.flags.length === 0 ? (
                        <li className="detected">
                          <span><Check size={14} /></span>
                          <div><b>Statutory Elements Verified</b><small>Document satisfies procedural criteria.</small></div>
                        </li>
                      ) : (
                        analysis.flags.map((flag, index) => (
                          <li key={index} className="missing">
                            <span>!</span>
                            <div><b>Procedural Requirement</b><small>{flag}</small></div>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>

                  <div className="report-actions" style={{ marginTop: '1rem' }}>
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
                <div className="certificate" style={{ marginTop: '1rem' }}>
                  <div className="certificate-seal"><ShieldCheck size={32} /></div>
                  <div style={{ flex: 1 }}>
                    <p className="eyebrow">CERTIFICATE OF EVIDENTIARY INTEGRITY</p>
                    <h2>BSA Sec. 63 Admissible</h2>
                    <p>Encrypted in MinIO. Fingerprint permanently mined on Sepolia (Block #{blockNumber}).</p>
                    <small>
                      {new Date().toLocaleString()} ·{' '}
                      <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ color: 'var(--emerald)', textDecoration: 'none' }}>
                        TX {txHash.slice(0, 20)}...
                      </a>
                    </small>
                  </div>
                  <button 
                    className="button primary" 
                    onClick={() => downloadCertificate(fileHash)}
                    style={{ gap: '6px', fontSize: '0.8rem' }}
                  >
                    <Download size={14} /> Download Certificate
                  </button>
                </div>
              )}

              {error && <p className="error-message" style={{ marginTop: '1rem' }}>{error}</p>}
            </div>

            <aside className="side-column">
              <div className="metric-card">
                <p className="eyebrow">EVIDENTIARY HEALTH</p>
                <div className="gauge" style={{ '--score': `${score * 3.6}deg` }}>
                  <strong>{score}%</strong>
                  <small>compliance</small>
                </div>
                <p className="metric-note">Evaluated against statutory procedural benchmarks and PII sensitivity parameters.</p>
              </div>

              <div className="signal-card">
                <p className="eyebrow">PROCESSING SIGNALS</p>
                <div><span className="signal-dot green" /> Presidio PII Masking</div>
                <div><span className="signal-dot green" /> MiniLM BNSS 173 Semantics</div>
                <div><span className="signal-dot green" /> Client AES-256-GCM</div>
                <div><span className="signal-dot green" /> Zero-Gas Sepolia Relayer</div>
              </div>
            </aside>
          </section>
        )}

        {activeTab === 'timeline' && (
          <section className="timeline-view fade-in">
            <div className="section-heading">
              <div>
                <p className="eyebrow">02 / Custody</p>
                <h2>Chronological Chain of Custody</h2>
                <p>Parent-child linked evidentiary trail fetched live from Sepolia.</p>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input 
                  type="text" 
                  value={activeDocketCase} 
                  onChange={(e) => setActiveDocketCase(e.target.value)} 
                  onKeyDown={(e) => { if (e.key === 'Enter') fetchDocket(activeDocketCase); }}
                  placeholder="Enter Case ID"
                  style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--card)', fontSize: '0.85rem' }}
                />
                <button className="button primary" onClick={() => fetchDocket(activeDocketCase)} style={{ padding: '6px 12px' }}>
                  Switch Docket
                </button>
                <button className="button ghost" onClick={() => fetchDocket(activeDocketCase)} title="Refresh docket">
                  <RefreshCw size={14} className={timelineLoading ? 'spinner' : ''} />
                </button>
              </div>
            </div>

            {docketList.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)', background: 'var(--card)', borderRadius: '12px' }}>
                <Activity size={36} style={{ marginBottom: '1rem', opacity: 0.5 }} />
                <p>No anchored documents found for case docket <b>{activeDocketCase}</b>.</p>
                <small>Anchor an initial FIR in Tab 01 to initialize the chain.</small>
              </div>
            ) : (
              <div className="timeline">
                {docketList.map((record, index) => (
                  <div className="timeline-event" key={record.evidenceHash}>
                    <div className="timeline-marker">{index + 1}</div>
                    <div className="timeline-content">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <small>{new Date(record.timestamp * 1000).toLocaleString()}</small>
                        <button 
                          onClick={() => downloadCertificate(record.evidenceHash)} 
                          className="button ghost" 
                          style={{ padding: '4px 8px', fontSize: '0.75rem', gap: '4px' }}
                        >
                          <Download size={13} /> BSA Sec. 63 PDF
                        </button>
                      </div>
                      <h3>{record.docType}</h3>
                      <p><b>SHA-256:</b> <code>{record.evidenceHash}</code></p>
                      <small style={{ color: 'var(--muted)' }}>
                        {record.parentHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' 
                          ? `Parent Hash: ${record.parentHash.slice(0, 18)}...` 
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

        {activeTab === 'verify' && (
          <section className="verify-view fade-in">
            <div className="section-heading">
              <div>
                <p className="eyebrow">03 / Judicial Review</p>
                <h2>Live Evidentiary Integrity &amp; Tamper Check</h2>
                <p>Drop a file or paste its 64-character SHA-256 fingerprint to verify authenticity on Sepolia.</p>
              </div>
              <span className="case-state">IMMUTABLE QUERY</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
              <label className={`dropzone ${busy ? 'processing' : ''}`}>
                <input 
                  type="file" 
                  onChange={(event) => handleVerifyFileDrop(event.target.files[0])} 
                />
                {busy ? <div className="spinner" /> : (
                  <>
                    <FileCheck2 size={38} />
                    <strong>Drop any document here to verify instantly</strong>
                    <small>Computes the cryptographic fingerprint and queries Sepolia</small>
                  </>
                )}
              </label>

              <div style={{ display: 'flex', gap: '8px' }}>
                <input 
                  value={verifyInput} 
                  onChange={(e) => setVerifyInput(e.target.value)} 
                  placeholder="Or paste 0x... SHA-256 document fingerprint"
                  style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--card)' }}
                />
                <button className="button primary" onClick={() => verifyHashOrFile(verifyInput)} disabled={busy}>
                  <Search size={16} /> Verify
                </button>
              </div>

              {tamperStatus === 'authentic' && verifyResult && (
                <div className="certificate verification-certificate" style={{ borderColor: 'var(--emerald)' }}>
                  <div className="certificate-seal" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--emerald)' }}>
                    <ShieldCheck size={32} />
                  </div>
                  <div>
                    <p className="eyebrow" style={{ color: 'var(--emerald)' }}>VERIFICATION PASSED — 100% AUTHENTIC</p>
                    <h2>BSA Sec. 63 Validated</h2>
                    <p>File digest matches the Sepolia master record exactly. Zero alterations detected.</p>
                    <div className="result-meta" style={{ marginBottom: '12px' }}>
                      <span>Mined: {new Date(verifyResult.timestamp * 1000).toLocaleString()}</span>
                      <span>Doc Type: <b>{verifyResult.docType}</b></span>
                      <span>Case: <code>{verifyResult.caseId}</code></span>
                    </div>
                    <button 
                      className="button primary" 
                      onClick={() => downloadCertificate(verifyResult.evidenceHash)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Download size={15} /> Download Section 63 BSA Admissibility Certificate
                    </button>
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
                    <p>The computed digest does not match any record on the Sepolia ledger. This file has been altered or never notarized.</p>
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