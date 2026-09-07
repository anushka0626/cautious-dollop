import { useState } from 'react';
import { Activity, ArrowRight, Check, Clipboard, FileCheck2, Fingerprint, LockKeyhole, ShieldCheck, Upload, Wifi, WifiOff } from 'lucide-react';
import { API_BASE } from './config';
import { useOnlineStatus } from './useOnlineStatus';
import { useCaptureQueue } from './useCaptureQueue';
import './App.css';

// How each queue state reads in the UI. "duplicate" is deliberately not "anchored": the
// contract rejected a second submission of a document already on the ledger, and the
// officer should see that plainly rather than a success that did not happen.
const QUEUE_STATUS = {
  pending: { dot: 'amber', label: 'Pending — waiting for connectivity' },
  syncing: { dot: 'amber', label: 'Syncing to the ledger…' },
  failed: { dot: 'amber', label: 'Failed — still held on this device' },
  anchored: { dot: 'green', label: 'Anchored on the ledger' },
  duplicate: { dot: 'amber', label: 'Already on ledger — not re-anchored' },
};

const DOC_TYPES = ['FIR', 'Panchnama', 'SeizureMemo', 'ForensicReport', 'Chargesheet'];

// App.css styles form fields only under .verify-form, so the ingest and docket controls
// carry their own inline styling rather than widening a verify-scoped rule.
const controlRow = { display: 'flex', gap: '10px', maxWidth: '760px', marginBottom: '18px' };
const controlField = { flex: '1 1 0', minWidth: 0 };
const controlLabel = { display: 'block', marginBottom: '9px', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: '.7rem', textTransform: 'uppercase' };
const controlInput = { width: '100%', minWidth: 0, padding: '12px', color: 'var(--text)', border: '1px solid var(--line)', outline: 'none', background: 'var(--canvas)', fontFamily: 'var(--mono)', fontSize: '.75rem' };

const shortHash = (hash) => (hash ? `${hash.slice(0, 12)}...${hash.slice(-8)}` : '');
const formatTime = (seconds) => new Date(seconds * 1000).toLocaleString();

// SHA-256 in the exact shape server/storage.js anchors on chain: lowercase, two chars per
// byte, '0x' prefixed, 66 characters. Any drift here makes every verification fail.
const hashFile = async (target) => {
  if (!window.crypto?.subtle) throw new Error('Hashing needs a secure context. Open the app on http://localhost, not a LAN address.');
  const digest = await window.crypto.subtle.digest('SHA-256', await target.arrayBuffer());
  return '0x' + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const readResponse = async (response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Server responded ${response.status}`);
  return data;
};

const describe = (thrown) => (thrown instanceof TypeError ? `${thrown.message}. Is the server running on ${API_BASE}?` : thrown.message);

function App() {
  const [activeTab, setActiveTab] = useState('ingest');
  const [caseId, setCaseId] = useState('');
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [file, setFile] = useState(null);
  const [stagedHash, setStagedHash] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [docketId, setDocketId] = useState('');
  const [docket, setDocket] = useState(null);
  const [verifyFile, setVerifyFile] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [queuedNotice, setQueuedNotice] = useState(null);
  const { isOnline } = useOnlineStatus();
  const queue = useCaptureQueue(isOnline);

  const switchTab = (tab) => { setActiveTab(tab); setError(''); };
  const reset = () => { setFile(null); setStagedHash(''); setReceipt(null); setError(''); setQueuedNotice(null); };

  // Offline capture: hold the file and its fingerprint on the device instead of posting.
  // Deliberately separate from anchorDocument so the online path is untouched.
  const queueDocument = async () => {
    if (!file || !caseId.trim() || !stagedHash) return;
    setBusy(true); setError('');
    try {
      const persisted = await queue.enqueue({ file, caseId: caseId.trim(), docType, hash: stagedHash });
      setQueuedNotice({ caseId: caseId.trim(), docType, hash: stagedHash, capturedAt: Date.now(), persisted });
      setFile(null); setStagedHash(''); setReceipt(null);
    } catch (queueError) {
      setError(`Could not hold this capture on the device: ${queueError.message}`);
    } finally { setBusy(false); }
  };

  // Stage only: hash locally so the record can be reviewed before anything is committed.
  const stageDocument = async (selectedFile) => {
    if (!selectedFile) return;
    if (selectedFile.type !== 'application/pdf') { setError('Only PDF files are supported.'); return; }
    setFile(selectedFile); setReceipt(null); setStagedHash(''); setError(''); setBusy(true);
    try {
      const hash = await hashFile(selectedFile);
      console.log('[veritas] staged SHA-256:', hash);
      setStagedHash(hash);
    } catch (hashError) { setFile(null); setError(hashError.message); }
    finally { setBusy(false); }
  };

  const anchorDocument = async () => {
    if (!file || !caseId.trim()) return;
    setBusy(true); setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('caseId', caseId.trim());
      formData.append('docType', docType);
      const data = await readResponse(await fetch(`${API_BASE}/api/evidence/upload`, { method: 'POST', body: formData }));
      if ((data.evidenceHash || '').toLowerCase() !== stagedHash) {
        throw new Error(`hash mismatch. Browser computed ${stagedHash}, server recorded ${data.evidenceHash || '(none)'}. The record was not accepted.`);
      }
      console.log('[veritas] anchored, server hash matches:', data.evidenceHash);
      setReceipt(data);
    } catch (uploadError) { setError(`Anchoring failed: ${describe(uploadError)}`); }
    finally { setBusy(false); }
  };

  const loadDocket = async () => {
    if (!docketId.trim()) { setError('Enter a Case ID to load its docket.'); return; }
    setBusy(true); setError(''); setDocket(null);
    try {
      const data = await readResponse(await fetch(`${API_BASE}/api/evidence/docket/${encodeURIComponent(docketId.trim())}`));
      setDocket(data.docket || []);
    } catch (docketError) { setError(`Could not load docket: ${describe(docketError)}`); }
    finally { setBusy(false); }
  };

  // The PDF is hashed in the browser and never uploaded; only the digest is sent.
  const verifyDocument = async () => {
    if (!verifyFile) { setError('Select the PDF you want to verify.'); return; }
    setBusy(true); setError(''); setVerifyResult(null);
    try {
      const hash = await hashFile(verifyFile);
      console.log('[veritas] verifying SHA-256:', hash);
      const data = await readResponse(await fetch(`${API_BASE}/api/evidence/verify/${hash}`));
      setVerifyResult({ ...data, hash });
    } catch (verificationError) { setError(`Verification failed: ${describe(verificationError)}`); }
    finally { setBusy(false); }
  };

  const copyHash = (hash) => navigator.clipboard.writeText(hash);
  const anchoredHash = receipt?.evidenceHash || stagedHash;
  // Populated once server/ml_engine/analyzer.py is wired into the upload route. The report
  // columns and gauges below stay in place, dormant, until the response carries `analysis`.
  const analysis = receipt?.analysis ?? null;
  const score = analysis?.score ?? 0;

  return <div className="app-shell">
    <header className="institutional-header"><div className="brand-lockup"><div className="brand-mark"><Fingerprint size={24} /></div><div><p className="eyebrow">Evidence intelligence platform</p><h1>VERITAS LEDGER</h1><p className="system-name">// Digital Evidence &amp; Custody Chain Management System</p></div></div><div className="status-row"><span>{isOnline ? <Wifi size={14} /> : <WifiOff size={14} style={{ color: 'var(--amber)' }} />} Evidence server <b style={isOnline ? undefined : { color: 'var(--amber)' }}>{isOnline ? 'Reachable' : 'Offline'}</b></span><span><ShieldCheck size={14} /> BNSS 2023 Engine <b>Online</b></span><span><LockKeyhole size={14} /> Client Hashing <b>Active</b></span></div></header>
    <nav className="workflow-tabs" aria-label="Evidence workflow"><button className={activeTab === 'ingest' ? 'active' : ''} onClick={() => switchTab('ingest')}><Upload size={16} /> Evidence Ingestion &amp; Ledger Anchoring</button><button className={activeTab === 'timeline' ? 'active' : ''} onClick={() => switchTab('timeline')}><Activity size={16} /> Chain of Custody Timeline</button><button className={activeTab === 'verify' ? 'active' : ''} onClick={() => switchTab('verify')}><FileCheck2 size={16} /> Judicial Integrity &amp; Tamper Check</button></nav>
    <main>
      {activeTab === 'ingest' && <section className="workspace-grid fade-in">
        <div className="primary-column">
          <div className="section-heading"><div><p className="eyebrow">01 / ingest</p><h2>Anchor evidence to the ledger</h2><p>Hash a source PDF in the browser, review the staged record, then commit the fingerprint through the server relayer.</p></div><span className="live-tag"><span /> LIVE PIPELINE</span></div>
          <div className="ingest-controls" style={controlRow}>
            <div style={controlField}>
              <label style={controlLabel} htmlFor="ingest-case-id">Case ID</label>
              <input id="ingest-case-id" style={controlInput} value={caseId} onChange={(event) => setCaseId(event.target.value)} placeholder="e.g. 104-2026" />
            </div>
            <div style={controlField}>
              <label style={controlLabel} htmlFor="ingest-doc-type">Document type</label>
              <select id="ingest-doc-type" style={controlInput} value={docType} onChange={(event) => setDocType(event.target.value)}>{DOC_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select>
            </div>
          </div>
          {!file && <label className={`dropzone ${busy ? 'processing' : ''}`}>
            <input type="file" accept="application/pdf,.pdf" disabled={!caseId.trim() || busy} onChange={(event) => stageDocument(event.target.files[0])} />
            {busy ? <div className="spinner" /> : <><Upload size={38} /><strong>{caseId.trim() ? 'Drop a legal PDF here' : 'Enter a Case ID to enable upload'}</strong><small>FIR, forensic report, or evidentiary record · PDF only</small></>}
          </label>}
          {file && <div className="report-panel">
            <div className="report-top">
              <div><p className="eyebrow">{analysis ? 'ANALYSIS REPORT' : 'STAGED FOR ANCHORING'}</p><h2>{analysis ? analysis.type : file.name}</h2><span className="document-badge">{receipt ? `${receipt.docType} · anchored` : `${docType} · awaiting anchor`}</span></div>
              {analysis && <div className="gauge compact" style={{ '--score': `${score * 3.6}deg` }}><strong>{score}%</strong><small>health</small></div>}
            </div>
            <div className="hash-box"><div><small>SHA-256 FINGERPRINT {receipt ? '· CONFIRMED BY SERVER' : '· COMPUTED IN BROWSER'}</small><code>{anchoredHash}</code></div><button title="Copy fingerprint" onClick={() => copyHash(anchoredHash)}><Clipboard size={17} /></button></div>
            {analysis && <div className="report-columns">
              <div><h3>Redacted executive summary</h3><p className="summary">{analysis.summary}</p></div>
              <div><h3>Statutory compliance checklist</h3><ul className="checklist">{(analysis.risks || []).map((item, index) => <li key={index} className={item.status}><span>{item.status === 'detected' ? <Check size={14} /> : '!'}</span><div><b>{item.name.replace(/^Missing: /, '')}</b><small>{item.explanation}</small></div></li>)}</ul></div>
            </div>}
            <div className="report-actions">
              <button className="button primary" onClick={isOnline ? anchorDocument : queueDocument} disabled={busy || !!receipt || !stagedHash}><ShieldCheck size={17} /> {receipt ? 'Anchored' : busy ? (isOnline ? 'Anchoring...' : 'Queueing...') : isOnline ? 'Anchor to Ledger' : 'Queue for Sync'}</button>
              <button className="button ghost" onClick={reset}>Clear record</button>
            </div>
            {!isOnline && !receipt && <p className="error-message">Offline — this capture will be held on the device and anchored automatically when the evidence server is reachable.</p>}
          </div>}
          {receipt?.txHash && <div className="certificate"><div className="certificate-seal"><ShieldCheck size={32} /></div><div><p className="eyebrow">CERTIFICATE OF EVIDENTIARY INTEGRITY</p><h2>BNSS Sec. 63 Compliant</h2><p>Fingerprint anchored by the server relayer and confirmed against the browser hash.</p><small>Case {receipt.caseId} · block {receipt.blockNumber} · TX <code>{shortHash(receipt.txHash)}</code></small></div></div>}
          {queuedNotice && <div className="certificate">
            <div className="certificate-seal"><Upload size={32} /></div>
            <div>
              <p className="eyebrow">HELD FOR SYNC</p>
              <h2>Captured offline</h2>
              <p>{queuedNotice.docType} for case {queuedNotice.caseId} is stored on this device. It anchors automatically when the evidence server is reachable.</p>
              <small>Captured locally {new Date(queuedNotice.capturedAt).toLocaleString()} · <code>{shortHash(queuedNotice.hash)}</code></small>
              {!queuedNotice.persisted && <p className="error-message">Device storage is unavailable — this capture is held in memory only and will not survive a reload.</p>}
            </div>
          </div>}
          {error && <p className="error-message">{error}</p>}

          {queue.items.length > 0 && <section className="timeline-view fade-in" style={{ marginTop: '22px' }}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">OFFLINE CAPTURE QUEUE</p>
                <h2>Held on this device</h2>
                <p>Captures wait here until the evidence server is reachable, then anchor in the order they were taken. Capture times are recorded by this device, not by the ledger.</p>
              </div>
              <span className="case-state">{queue.items.filter((item) => item.status === 'pending' || item.status === 'failed').length} PENDING{queue.syncing ? ' · SYNCING' : ''}</span>
            </div>
            <div className="timeline">
              {queue.items.map((item, index) => <div className="timeline-event" key={item.id}>
                <div className="timeline-marker">{index + 1}</div>
                <div className="timeline-content">
                  <small>Captured locally {new Date(item.capturedAt).toLocaleString()}</small>
                  <h3>{item.docType}</h3>
                  <p>Case {item.caseId}</p>
                  <p><code>{shortHash(item.hash)}</code></p>
                  <p><span className={`signal-dot ${(QUEUE_STATUS[item.status] || QUEUE_STATUS.pending).dot}`} style={item.status === 'failed' ? { background: 'var(--crimson)' } : undefined} /> {(QUEUE_STATUS[item.status] || QUEUE_STATUS.pending).label}</p>
                  {item.status === 'anchored' && <p>Anchored {new Date(item.anchoredAt).toLocaleString()} <small>({item.anchorTimeSource === 'chain' ? 'block time' : 'device clock'})</small></p>}
                  {item.status === 'duplicate' && <p>This exact document was already on the ledger, so the contract rejected a second submission. It was anchored {new Date(item.anchoredAt).toLocaleString()} <small>({item.anchorTimeSource === 'chain' ? 'block time' : 'device clock'})</small>.</p>}
                  {item.status === 'failed' && <>
                    <p className="error-message">{item.error}</p>
                    <button className="button ghost" onClick={() => queue.retry(item.id)} disabled={queue.syncing}>Retry</button>
                  </>}
                </div>
              </div>)}
            </div>
            {/* Rehearsal aid: shown in preview too, since that is where the demo runs. */}
            <div className="report-actions">
              <button className="button ghost" onClick={queue.clearAll} disabled={queue.syncing}>Clear queue (rehearsal reset)</button>
            </div>
          </section>}
        </div>
        <aside className="side-column">
          {analysis && <div className="metric-card"><p className="eyebrow">EVIDENTIARY HEALTH</p><div className="gauge" style={{ '--score': `${score * 3.6}deg` }}><strong>{score}%</strong><small>compliance</small></div><p className="metric-note">Based on statutory fields, custody markers, and seal verification.</p></div>}
          <div className="signal-card"><p className="eyebrow">PROCESSING SIGNALS</p><div><span className="signal-dot green" /> Client-side SHA-256 hashing</div><div><span className="signal-dot green" /> AES-256-GCM at rest</div><div><span className="signal-dot amber" /> Human review recommended</div></div>
        </aside>
      </section>}

      {activeTab === 'timeline' && <section className="timeline-view fade-in">
        <div className="section-heading"><div><p className="eyebrow">02 / custody</p><h2>Chronological chain of custody</h2><p>Every document anchored against a case, in the order the ledger recorded it.</p></div><span className="case-state">{docket ? `${docket.length} RECORD${docket.length === 1 ? '' : 'S'} ON LEDGER` : 'CASE DOCKET'}</span></div>
        <div className="ingest-controls" style={controlRow}>
          <div style={controlField}>
            <label style={controlLabel} htmlFor="docket-case-id">Case ID</label>
            <input id="docket-case-id" style={controlInput} value={docketId} onChange={(event) => setDocketId(event.target.value)} placeholder="e.g. 104-2026" />
          </div>
          <button className="button primary" style={{ alignSelf: 'flex-end' }} onClick={loadDocket} disabled={busy || !isOnline}><Activity size={17} /> {busy ? 'Loading...' : 'Load docket'}</button>
        </div>
        {!isOnline && <p className="error-message">Offline — the custody docket is read from the ledger and cannot be loaded without connectivity.</p>}
        {error && <p className="error-message">{error}</p>}
        {docket?.length === 0 && <p className="error-message">No records anchored against this Case ID yet.</p>}
        {docket?.length > 0 && <div className="timeline">{docket.map((record, index) => <div className="timeline-event" key={record.evidenceHash}>
          <div className="timeline-marker">{index + 1}</div>
          <div className="timeline-content"><small>{formatTime(record.timestamp)}</small><h3>{record.docType}</h3><p><code>{shortHash(record.evidenceHash)}</code></p><p>{record.parentHash && !/^0x0+$/.test(record.parentHash) ? `Follows ${shortHash(record.parentHash)}` : 'Root document of this docket'}</p></div>
          {index < docket.length - 1 && <ArrowRight className="timeline-arrow" size={20} />}
        </div>)}</div>}
      </section>}

      {activeTab === 'verify' && <section className="verify-view fade-in">
        <div className="section-heading"><div><p className="eyebrow">03 / judicial review</p><h2>Verify evidentiary integrity</h2><p>Select the PDF in question. It is hashed locally and only the fingerprint is sent — the file never leaves this machine.</p></div><span className="case-state">READ-ONLY QUERY</span></div>
        <div className="verify-form">
          <label htmlFor="verify-file">Document under review</label>
          <div>
            <input id="verify-file" type="file" accept="application/pdf,.pdf" onChange={(event) => { setVerifyFile(event.target.files[0] || null); setVerifyResult(null); setError(''); }} />
            <button className="button primary" onClick={verifyDocument} disabled={busy}><FileCheck2 size={17} /> {busy ? 'Checking...' : 'Verify on-chain'}</button>
          </div>
        </div>
        {error && <p className="error-message">{error}</p>}
        {verifyResult?.authentic === false && <ul className="checklist" style={{ maxWidth: '760px', marginTop: '22px' }}>
          <li className="warning" style={{ borderColor: 'var(--crimson)', background: 'rgba(239,68,68,.08)' }}>
            <span style={{ color: 'var(--crimson)' }}>!</span>
            <div><b>TAMPER DETECTED · no matching record on the ledger</b><small>{verifyResult.message || 'This fingerprint was never anchored, or the file has been altered since it was.'}</small><small><code>{verifyResult.hash}</code></small></div>
          </li>
        </ul>}
        {verifyResult?.authentic && <div className="certificate verification-certificate"><div className="certificate-seal"><ShieldCheck size={32} /></div><div><p className="eyebrow">CERTIFICATE OF EVIDENTIARY INTEGRITY</p><h2>BNSS Sec. 63 Compliant</h2><p>The fingerprint of this file matches a record on the ledger.</p><div className="result-meta"><span>Registered {formatTime(verifyResult.record.timestamp)}</span><span>Case <code>{verifyResult.record.caseId}</code></span><span>By <code>{verifyResult.record.loggedBy}</code></span></div><p className="summary">{verifyResult.record.docType} · stored at {verifyResult.record.storageURI}</p></div></div>}
      </section>}
    </main><footer><span>VERITAS LEDGER / INTERNAL JUSTICE SYSTEM</span><span>ENCRYPTED AT REST · AUDIT LOG ENABLED</span></footer>
  </div>;
}

export default App;
