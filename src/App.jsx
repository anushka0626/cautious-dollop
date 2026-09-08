import { useCallback, useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowUpRight, Bug, Check, Clipboard, Download,
  Eye, FileCheck2, FileText, Fingerprint, Landmark, LockKeyhole, RefreshCw,
  Search, ShieldCheck, Upload, Wifi, WifiOff,
} from 'lucide-react';
import { API_BASE } from './config';
import { useOnlineStatus } from './useOnlineStatus';
import { useCaptureQueue } from './useCaptureQueue';
import './App.css';

const DEFAULT_CASE_ID = 'MH-PUN-2026-001';
const ZERO_HASH = `0x${'0'.repeat(64)}`;

const DOC_TYPES = [
  { value: 'FIR', label: 'First Information Report (FIR)' },
  { value: 'Panchnama', label: 'Panchnama' },
  { value: 'SeizureMemo', label: 'Seizure Memo' },
  { value: 'ForensicReport', label: 'Forensic Analysis Report' },
  { value: 'Chargesheet', label: 'Final Chargesheet' },
];

// How each queue state reads in the UI. "duplicate" is deliberately not "anchored": the
// contract rejected a second submission of a document already on the ledger, and the
// officer should see that plainly rather than a success that did not happen.
const QUEUE_STATUS = {
  pending: { dot: 'amber', label: 'Pending — waiting for connectivity' },
  syncing: { dot: 'amber', label: 'Syncing to the ledger…' },
  failed: { dot: 'red', label: 'Failed — still held on this device' },
  anchored: { dot: 'green', label: 'Anchored on the ledger' },
  duplicate: { dot: 'amber', label: 'Already on ledger — not re-anchored' },
};

const shortHash = (hash) => (hash ? `${hash.slice(0, 12)}…${hash.slice(-8)}` : '');
const formatTime = (seconds) => new Date(seconds * 1000).toLocaleString();
const isRootHash = (hash) => !hash || /^0x0+$/.test(hash);

// SHA-256 in the exact shape server/storage.js anchors on chain: lowercase, two chars per
// byte, '0x' prefixed, 66 characters. Any drift here makes every verification fail.
const hashFile = async (target) => {
  if (!window.crypto?.subtle) {
    throw new Error('Hashing needs a secure context. Open the app on http://localhost, not a LAN address.');
  }
  const digest = await window.crypto.subtle.digest('SHA-256', await target.arrayBuffer());
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const readResponse = async (response) => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Server responded ${response.status}`);
  return data;
};

const describe = (thrown) =>
  (thrown instanceof TypeError ? `${thrown.message}. Is the server running on ${API_BASE}?` : thrown.message);

// The audit service returns flags as one sentence, e.g.
// "BNSS 173 Defect: Missing 'Place of Occurrence' (Confidence: 31%)".
// Splitting on the first colon gives a heading and its detail without losing anything.
const splitFlag = (flag) => {
  const at = flag.indexOf(':');
  return at === -1
    ? { heading: 'Procedural requirement', detail: flag }
    : { heading: flag.slice(0, at).trim(), detail: flag.slice(at + 1).trim() };
};

// A hashing failure means there is no record to work with at all; an audit failure is
// recoverable, so only the former discards the staged file.
const stagedHashFailed = (thrown) => /secure context/i.test(thrown.message || '');

// Mirrors the weighting used by the audit service: a docket citing no penal section at all
// is barely a docket, and every unmet BNSS 173 pillar costs a fixed slice of the score.
const scoreAudit = (sections, flags) =>
  (sections.length === 0 ? 30 : Math.max(30, 100 - flags.length * 15));

function App() {
  const [activeTab, setActiveTab] = useState('ingest');

  // Ingestion
  const [caseId, setCaseId] = useState(DEFAULT_CASE_ID);
  const [docType, setDocType] = useState(DOC_TYPES[0].value);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [stagedHash, setStagedHash] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [auditNotice, setAuditNotice] = useState('');
  const [auditOnline, setAuditOnline] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [queuedNotice, setQueuedNotice] = useState(null);

  // Custody register
  const [docketId, setDocketId] = useState(DEFAULT_CASE_ID);
  const [docket, setDocket] = useState(null);
  const [docketLoading, setDocketLoading] = useState(false);

  // Judicial verification
  const [verifyInput, setVerifyInput] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const { isOnline } = useOnlineStatus();
  const queue = useCaptureQueue(isOnline);

  const switchTab = (tab) => { setActiveTab(tab); setError(''); };

  const resetIngest = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null); setPreviewUrl(null); setStagedHash(''); setAnalysis(null);
    setAuditNotice(''); setReceipt(null); setQueuedNotice(null); setError('');
  };

  const loadDocket = useCallback(async (targetCase, { quiet = false } = {}) => {
    const id = (targetCase || '').trim();
    if (!id) { setError('Enter a Case ID to load its docket.'); return []; }
    setDocketLoading(true);
    if (!quiet) setError('');
    try {
      const data = await readResponse(
        await fetch(`${API_BASE}/api/evidence/docket/${encodeURIComponent(id)}`),
      );
      const records = data.docket || [];
      setDocket(records);
      return records;
    } catch (docketError) {
      if (!quiet) setError(`Could not load docket: ${describe(docketError)}`);
      return [];
    } finally {
      setDocketLoading(false);
    }
  }, []);

  // Show the register for the default case on first load, so the custody tab is not an
  // empty box during a demo. Quiet: a cold server here is not the officer's problem yet.
  useEffect(() => {
    if (isOnline) loadDocket(DEFAULT_CASE_ID, { quiet: true });
  }, [isOnline, loadDocket]);

  // Stage: hash in the browser, then ask the audit service what it makes of the document.
  // The audit is advisory — if the AI service is down the record can still be anchored,
  // because integrity does not depend on it.
  const stageDocument = async (selected) => {
    if (!selected) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);

    setFile(selected);
    setPreviewUrl(selected.type.startsWith('image/') ? URL.createObjectURL(selected) : null);
    setStagedHash(''); setAnalysis(null); setAuditNotice(''); setReceipt(null);
    setQueuedNotice(null); setError(''); setBusy(true);

    try {
      const hash = await hashFile(selected);
      setStagedHash(hash);

      if (!isOnline) {
        setAuditNotice('Offline — the statutory audit runs when this capture syncs.');
        return;
      }

      const formData = new FormData();
      formData.append('file', selected);
      const data = await readResponse(
        await fetch(`${API_BASE}/api/evidence/analyze`, { method: 'POST', body: formData }),
      );

      const sections = data.sections_detected || [];
      const flags = data.procedural_flags || [];
      setAuditOnline(true);
      setAnalysis({
        rawText: data.raw_text || '',
        redactedText: data.redacted_text || '',
        maskedCount: (data.entities_masked || []).length,
        sections,
        flags,
        score: scoreAudit(sections, flags),
      });
    } catch (thrown) {
      if (stagedHashFailed(thrown)) { setFile(null); setPreviewUrl(null); setError(thrown.message); return; }
      setAuditOnline(false);
      setAuditNotice(`Statutory audit unavailable — ${describe(thrown)} The document can still be anchored.`);
    } finally {
      setBusy(false);
    }
  };

  const anchorDocument = async () => {
    if (!file || !caseId.trim() || !stagedHash) return;
    setBusy(true); setError('');
    try {
      // Chain of custody: a new document links to the last one anchored against this case,
      // so the docket reads as a chain rather than a pile of files.
      const existing = await loadDocket(caseId, { quiet: true });
      const parentHash = existing.length > 0 ? existing[existing.length - 1].evidenceHash : '';

      const formData = new FormData();
      formData.append('file', file);
      formData.append('caseId', caseId.trim());
      formData.append('docType', docType);
      if (parentHash && parentHash !== ZERO_HASH) formData.append('parentHash', parentHash);

      const data = await readResponse(
        await fetch(`${API_BASE}/api/evidence/upload`, { method: 'POST', body: formData }),
      );

      if ((data.evidenceHash || '').toLowerCase() !== stagedHash) {
        throw new Error(
          `hash mismatch. Browser computed ${stagedHash}, server recorded ${data.evidenceHash || '(none)'}. The record was not accepted.`,
        );
      }

      setReceipt({ ...data, parentHash });
      setDocketId(caseId.trim());
      loadDocket(caseId, { quiet: true });
    } catch (uploadError) {
      setError(`Anchoring failed: ${describe(uploadError)}`);
    } finally {
      setBusy(false);
    }
  };

  // Offline capture: hold the file and its fingerprint on the device instead of posting.
  // Deliberately separate from anchorDocument so the online path is untouched.
  const queueDocument = async () => {
    if (!file || !caseId.trim() || !stagedHash) return;
    setBusy(true); setError('');
    try {
      const persisted = await queue.enqueue({ file, caseId: caseId.trim(), docType, hash: stagedHash });
      setQueuedNotice({ caseId: caseId.trim(), docType, hash: stagedHash, capturedAt: Date.now(), persisted });
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setFile(null); setPreviewUrl(null); setStagedHash(''); setAnalysis(null); setReceipt(null);
    } catch (queueError) {
      setError(`Could not hold this capture on the device: ${queueError.message}`);
    } finally {
      setBusy(false);
    }
  };

  const verifyHash = useCallback(async (candidate) => {
    const target = (candidate || '').trim();
    if (!target) { setError('Provide a document or its SHA-256 fingerprint.'); return; }
    setBusy(true); setError(''); setVerifyResult(null);
    try {
      const data = await readResponse(
        await fetch(`${API_BASE}/api/evidence/verify/${encodeURIComponent(target)}`),
      );
      setVerifyResult({ ...data, hash: target });
    } catch (verificationError) {
      setError(`Verification failed: ${describe(verificationError)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  // The PDF or scan is hashed in the browser and never uploaded; only the digest is sent.
  const verifyDroppedFile = async (dropped) => {
    if (!dropped) return;
    setBusy(true); setError(''); setVerifyResult(null);
    try {
      const hash = await hashFile(dropped);
      setVerifyInput(hash);
      await verifyHash(hash);
    } catch (hashError) {
      setError(hashError.message);
      setBusy(false);
    }
  };

  // Demo aid: flip one hex digit of a genuine fingerprint and put it through the same
  // verification path. One altered character is enough to break the match.
  const runTamperTest = async () => {
    if (!stagedHash) { setError('Stage a document first, then run the tamper test against it.'); return; }
    const last = stagedHash.slice(-1);
    const flipped = last === 'a' ? 'b' : 'a';
    const tampered = stagedHash.slice(0, -1) + flipped;
    setVerifyInput(tampered);
    setActiveTab('verify');
    await verifyHash(tampered);
  };

  const downloadCertificate = (hash) => window.open(`${API_BASE}/api/evidence/certificate/${hash}`, '_blank');
  const copyHash = (hash) => navigator.clipboard?.writeText(hash);

  const anchoredHash = receipt?.evidenceHash || stagedHash;
  const score = analysis?.score ?? 0;
  const meterTone = score >= 80 ? '' : score >= 50 ? 'is-warn' : 'is-alert';
  const pendingCount = queue.items.filter((item) => item.status === 'pending' || item.status === 'failed').length;

  return (
    <div className="app-shell">
      <header className="institutional-header">
        <div className="brand-lockup">
          <div className="brand-mark"><Fingerprint size={24} /></div>
          <div>
            <p className="eyebrow">National Crime Records · Evidence Custody</p>
            <h1>Veritas Ledger</h1>
            <p className="system-name">Digital evidence and chain-of-custody management for legal and investigation documents</p>
          </div>
        </div>
        <div className="status-row">
          <span className={isOnline ? 'is-ok' : 'is-warn'}>
            {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
            Evidence API <b>{isOnline ? 'Reachable' : 'Offline'}</b>
          </span>
          <span className={auditOnline === false ? 'is-warn' : auditOnline ? 'is-ok' : undefined}>
            <ShieldCheck size={14} />
            BNSS 173 audit <b>{auditOnline === false ? 'Unavailable' : auditOnline ? 'Ready' : 'Standby'}</b>
          </span>
          <span><Landmark size={14} /> Ledger <b>Sepolia</b></span>
          <span><LockKeyhole size={14} /> Storage <b>AES-256-GCM</b></span>
        </div>
      </header>

      <nav className="workflow-tabs" aria-label="Evidence workflow">
        <button className={activeTab === 'ingest' ? 'active' : ''} onClick={() => switchTab('ingest')}>
          <Upload size={16} /> Ingestion &amp; ledger anchoring
        </button>
        <button
          className={activeTab === 'timeline' ? 'active' : ''}
          onClick={() => { switchTab('timeline'); if (isOnline) loadDocket(docketId, { quiet: true }); }}
        >
          <Activity size={16} /> Chain of custody
        </button>
        <button className={activeTab === 'verify' ? 'active' : ''} onClick={() => switchTab('verify')}>
          <FileCheck2 size={16} /> Judicial integrity check
        </button>
      </nav>

      <main>
        {/* ------------------------------------------------------------ INGEST */}
        {activeTab === 'ingest' && (
          <section className="workspace-grid fade-in">
            <div className="primary-column">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">01 / Ingest</p>
                  <h2>Anchor evidence to the ledger</h2>
                  <p>
                    The document is hashed in this browser and audited against BNSS 173 before anything is
                    committed. Only the 32-byte digest reaches the chain; the file itself is encrypted into
                    object storage.
                  </p>
                </div>
                <span className="live-tag"><span /> Live pipeline</span>
              </div>

              <div className="field-row">
                <div className="field">
                  <label htmlFor="ingest-case-id">Case docket ID</label>
                  <input
                    id="ingest-case-id"
                    value={caseId}
                    onChange={(event) => setCaseId(event.target.value)}
                    placeholder="e.g. MH-PUN-2026-001"
                  />
                </div>
                <div className="field">
                  <label htmlFor="ingest-doc-type">Document class</label>
                  <select id="ingest-doc-type" value={docType} onChange={(event) => setDocType(event.target.value)}>
                    {DOC_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                </div>
              </div>

              {!file && (
                <label className={`dropzone ${busy ? 'processing' : ''} ${!caseId.trim() ? 'disabled' : ''}`}>
                  <input
                    type="file"
                    accept="application/pdf,image/*"
                    disabled={!caseId.trim() || busy}
                    onChange={(event) => stageDocument(event.target.files[0])}
                  />
                  {busy ? <div className="spinner" /> : (
                    <>
                      <Upload size={34} />
                      <strong>{caseId.trim() ? 'Select an FIR, panchnama or forensic report' : 'Enter a Case ID to enable capture'}</strong>
                      <small>PDF, or a photograph / scan of a paper docket</small>
                    </>
                  )}
                </label>
              )}

              {stagedHash && (
                <div className="hash-box">
                  <div>
                    <small>SHA-256 fingerprint {receipt ? '· confirmed by server' : '· computed in browser'}</small>
                    <code>{anchoredHash}</code>
                  </div>
                  <div className="hash-actions">
                    <button className="button ghost small" onClick={runTamperTest} title="Alter one character and re-verify">
                      <Bug size={14} /> Tamper test
                    </button>
                    <button className="icon-button" onClick={() => copyHash(anchoredHash)} title="Copy fingerprint">
                      <Clipboard size={16} />
                    </button>
                  </div>
                </div>
              )}

              {file && (
                <div className="report-panel">
                  <div className="report-top">
                    <div>
                      <p className="eyebrow">{analysis ? 'Docket extract' : 'Staged for anchoring'}</p>
                      <h2>{file.name}</h2>
                      <span className="document-badge">
                        {receipt ? `${receipt.docType} · anchored` : `${docType} · awaiting anchor`}
                      </span>
                    </div>
                  </div>

                  {auditNotice && <p className="notice warn">{auditNotice}</p>}

                  {analysis && (
                    <>
                      <div className={`diff-grid ${previewUrl ? 'two-up' : ''}`} style={{ marginTop: '18px' }}>
                        {previewUrl && (
                          <div className="diff-pane">
                            <header><Eye size={14} /> Original intake scan</header>
                            <img src={previewUrl} alt={`Scan of ${file.name}`} />
                          </div>
                        )}
                        <div className="diff-pane">
                          <header>
                            <FileText size={14} />
                            PII-redacted text
                            {analysis.maskedCount > 0 && ` · ${analysis.maskedCount} entities masked`}
                          </header>
                          <pre>{analysis.redactedText || 'No text could be extracted from this document.'}</pre>
                        </div>
                      </div>

                      {analysis.sections.length > 0 && (
                        <>
                          <h3>Penal sections cited</h3>
                          <div className="tag-row">
                            {analysis.sections.map((section) => (
                              <span className="section-tag" key={section}>{section}</span>
                            ))}
                          </div>
                        </>
                      )}

                      <h3>Statutory compliance · BNSS 173</h3>
                      <ul className="checklist">
                        {analysis.flags.length === 0 ? (
                          <li>
                            <span><Check size={13} /></span>
                            <div>
                              <b>All mandatory elements present</b>
                              <small>The docket satisfies every BNSS 173 pillar the audit checks for.</small>
                            </div>
                          </li>
                        ) : (
                          analysis.flags.map((flag, index) => {
                            const { heading, detail } = splitFlag(flag);
                            return (
                              <li className="missing" key={index}>
                                <span>!</span>
                                <div><b>{heading}</b><small>{detail}</small></div>
                              </li>
                            );
                          })
                        )}
                      </ul>
                    </>
                  )}

                  <div className="report-actions">
                    <button
                      className={`button primary ${receipt ? 'done' : ''}`}
                      onClick={isOnline ? anchorDocument : queueDocument}
                      disabled={busy || !!receipt || !stagedHash}
                    >
                      <ShieldCheck size={16} />
                      {receipt ? 'Anchored on ledger'
                        : busy ? (isOnline ? 'Anchoring…' : 'Queueing…')
                        : isOnline ? 'Anchor to ledger' : 'Queue for sync'}
                    </button>
                    <button className="button ghost" onClick={resetIngest}>Clear record</button>
                  </div>

                  {!isOnline && !receipt && (
                    <p className="notice warn">
                      Offline — this capture is held on the device and anchors automatically when the evidence
                      server is reachable again.
                    </p>
                  )}
                </div>
              )}

              {receipt?.txHash && (
                <div className="certificate">
                  <div className="certificate-seal"><ShieldCheck size={28} /></div>
                  <div>
                    <p className="eyebrow">Certificate of evidentiary integrity</p>
                    <h2>Admissible under BSA Section 63</h2>
                    <p>
                      Encrypted into object storage and permanently anchored on Sepolia at block {receipt.blockNumber}.
                      The server-recorded digest matches the one this browser computed.
                    </p>
                    <div className="result-meta">
                      <span>Case <b>{receipt.caseId}</b></span>
                      <span>Block <b>{receipt.blockNumber}</b></span>
                      <span>
                        <a href={`https://sepolia.etherscan.io/tx/${receipt.txHash}`} target="_blank" rel="noreferrer">
                          TX {shortHash(receipt.txHash)} <ArrowUpRight size={12} />
                        </a>
                      </span>
                    </div>
                    <p style={{ margin: 0 }}>
                      {isRootHash(receipt.parentHash)
                        ? 'Root document of this docket.'
                        : `Linked to parent ${shortHash(receipt.parentHash)}.`}
                    </p>
                  </div>
                  <button className="button primary" onClick={() => downloadCertificate(receipt.evidenceHash)}>
                    <Download size={15} /> Section 63 certificate
                  </button>
                </div>
              )}

              {queuedNotice && (
                <div className="certificate is-warn">
                  <div className="certificate-seal"><Upload size={26} /></div>
                  <div>
                    <p className="eyebrow">Held for sync</p>
                    <h2>Captured offline</h2>
                    <p>
                      {queuedNotice.docType} for case {queuedNotice.caseId} is stored on this device. It anchors
                      automatically when the evidence server is reachable.
                    </p>
                    <small>
                      Captured locally {new Date(queuedNotice.capturedAt).toLocaleString()} · <code>{shortHash(queuedNotice.hash)}</code>
                    </small>
                    {!queuedNotice.persisted && (
                      <p className="notice alert">
                        Device storage is unavailable — this capture is held in memory only and will not survive a reload.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {error && <p className="error-message">{error}</p>}

              {queue.items.length > 0 && (
                <section className="timeline-view fade-in" style={{ marginTop: '26px' }}>
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Offline capture queue</p>
                      <h2>Held on this device</h2>
                      <p>
                        Captures wait here until the evidence server is reachable, then anchor in the order they
                        were taken. Capture times are recorded by this device, not by the ledger.
                      </p>
                    </div>
                    <span className="case-state">{pendingCount} pending{queue.syncing ? ' · syncing' : ''}</span>
                  </div>
                  <div className="timeline">
                    {queue.items.map((item, index) => {
                      const state = QUEUE_STATUS[item.status] || QUEUE_STATUS.pending;
                      return (
                        <div className="timeline-event" key={item.id}>
                          <div className="timeline-marker">{index + 1}</div>
                          <div className="timeline-content">
                            <small>Captured locally {new Date(item.capturedAt).toLocaleString()}</small>
                            <h3>{item.docType}</h3>
                            <p>Case {item.caseId} · <code>{shortHash(item.hash)}</code></p>
                            <p><span className={`signal-dot ${state.dot}`} /> {state.label}</p>
                            {item.status === 'anchored' && (
                              <p>
                                Anchored {new Date(item.anchoredAt).toLocaleString()}{' '}
                                <small>({item.anchorTimeSource === 'chain' ? 'block time' : 'device clock'})</small>
                              </p>
                            )}
                            {item.status === 'duplicate' && (
                              <p>
                                This exact document was already on the ledger, so the contract rejected a second
                                submission. It was anchored {new Date(item.anchoredAt).toLocaleString()}{' '}
                                <small>({item.anchorTimeSource === 'chain' ? 'block time' : 'device clock'})</small>.
                              </p>
                            )}
                            {item.status === 'failed' && (
                              <>
                                <p className="error-message">{item.error}</p>
                                <button className="button ghost small" onClick={() => queue.retry(item.id)} disabled={queue.syncing}>
                                  Retry
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="report-actions">
                    <button className="button ghost" onClick={queue.clearAll} disabled={queue.syncing}>
                      Clear queue (rehearsal reset)
                    </button>
                  </div>
                </section>
              )}
            </div>

            <aside className="side-column">
              <div className="metric-card">
                <p className="eyebrow">Evidentiary health</p>
                <div className="metric-score">
                  <strong>{analysis ? score : '—'}</strong>
                  <span>{analysis ? '/ 100 compliance' : 'awaiting audit'}</span>
                </div>
                <div className={`meter ${analysis ? meterTone : ''}`}>
                  <i style={{ width: `${analysis ? score : 0}%` }} />
                </div>
                <p className="metric-note">
                  {analysis
                    ? `${analysis.flags.length} statutory ${analysis.flags.length === 1 ? 'defect' : 'defects'} flagged against the five mandatory BNSS 173 pillars.`
                    : 'Scored against the five mandatory BNSS 173 pillars once a document is staged.'}
                </p>
              </div>

              <div className="signal-card">
                <p className="eyebrow">Processing signals</p>
                <div><span className="signal-dot green" /> Client-side SHA-256 hashing</div>
                <div><span className="signal-dot green" /> AES-256-GCM encryption at rest</div>
                <div><span className={`signal-dot ${auditOnline === false ? 'red' : 'green'}`} /> Presidio PII masking</div>
                <div><span className={`signal-dot ${auditOnline === false ? 'red' : 'green'}`} /> MiniLM BNSS 173 semantics</div>
                <div><span className={`signal-dot ${isOnline ? 'green' : 'amber'}`} /> Zero-gas relayer (no officer wallet)</div>
              </div>
            </aside>
          </section>
        )}

        {/* ---------------------------------------------------------- CUSTODY */}
        {activeTab === 'timeline' && (
          <section className="timeline-view fade-in">
            <div className="section-heading">
              <div>
                <p className="eyebrow">02 / Custody</p>
                <h2>Chain of custody register</h2>
                <p>Every document anchored against a case, in the order the ledger recorded it, each one linked to the digest of the document before it.</p>
              </div>
              <div className="docket-toolbar">
                <input
                  className="text-input"
                  value={docketId}
                  onChange={(event) => setDocketId(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') loadDocket(docketId); }}
                  placeholder="Case ID"
                  aria-label="Case ID"
                />
                <button className="button primary" onClick={() => loadDocket(docketId)} disabled={docketLoading || !isOnline}>
                  <Search size={15} /> Load
                </button>
                <button
                  className="icon-button"
                  onClick={() => loadDocket(docketId)}
                  disabled={docketLoading || !isOnline}
                  title="Refresh docket"
                >
                  {docketLoading ? <div className="spinner inline" /> : <RefreshCw size={15} />}
                </button>
              </div>
            </div>

            {!isOnline && (
              <p className="notice warn">
                Offline — the custody register is read from the ledger and cannot be loaded without connectivity.
              </p>
            )}
            {error && <p className="error-message">{error}</p>}

            {docket?.length === 0 && (
              <div className="empty-state">
                <Activity size={32} />
                <p>No documents anchored against <b>{docketId}</b> yet.</p>
                <small>Anchor an FIR in the ingestion tab to open this chain.</small>
              </div>
            )}

            {docket?.length > 0 && (
              <div className="timeline">
                {docket.map((record, index) => (
                  <div className="timeline-event" key={record.evidenceHash}>
                    <div className="timeline-marker">{index + 1}</div>
                    <div className="timeline-content">
                      <div className="timeline-row">
                        <small>{formatTime(record.timestamp)}</small>
                        <button className="button ghost small" onClick={() => downloadCertificate(record.evidenceHash)}>
                          <Download size={13} /> Section 63 PDF
                        </button>
                      </div>
                      <h3>{record.docType}</h3>
                      <p><code>{record.evidenceHash}</code></p>
                      <p>
                        {isRootHash(record.parentHash)
                          ? 'Root document of this docket'
                          : <>Follows <code>{shortHash(record.parentHash)}</code></>}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ----------------------------------------------------------- VERIFY */}
        {activeTab === 'verify' && (
          <section className="verify-view fade-in">
            <div className="section-heading">
              <div>
                <p className="eyebrow">03 / Judicial review</p>
                <h2>Verify evidentiary integrity</h2>
                <p>
                  Drop the document in question, or paste its fingerprint. Files are hashed locally and only the
                  digest is sent — the document never leaves this machine.
                </p>
              </div>
              <span className="case-state">Read-only query</span>
            </div>

            <label className={`dropzone ${busy ? 'processing' : ''}`}>
              <input type="file" accept="application/pdf,image/*" onChange={(event) => verifyDroppedFile(event.target.files[0])} />
              {busy ? <div className="spinner" /> : (
                <>
                  <FileCheck2 size={34} />
                  <strong>Drop a document here to verify it against the ledger</strong>
                  <small>Computes the fingerprint locally, then queries the registry contract</small>
                </>
              )}
            </label>

            <div className="docket-toolbar" style={{ marginTop: '14px' }}>
              <input
                className="text-input mono-input"
                style={{ flex: 1 }}
                value={verifyInput}
                onChange={(event) => setVerifyInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') verifyHash(verifyInput); }}
                placeholder="0x… SHA-256 fingerprint"
                aria-label="SHA-256 fingerprint"
              />
              <button className="button primary" onClick={() => verifyHash(verifyInput)} disabled={busy}>
                <Search size={15} /> Verify
              </button>
            </div>

            {error && <p className="error-message">{error}</p>}

            {verifyResult?.authentic && (
              <div className="certificate">
                <div className="certificate-seal"><ShieldCheck size={28} /></div>
                <div>
                  <p className="eyebrow">Verification passed</p>
                  <h2>Record matches the ledger</h2>
                  <p>The fingerprint of this file matches an anchored record exactly. No alteration since notarisation.</p>
                  <div className="result-meta">
                    <span>Anchored {formatTime(verifyResult.record.timestamp)}</span>
                    <span>Class <b>{verifyResult.record.docType}</b></span>
                    <span>Case <code>{verifyResult.record.caseId}</code></span>
                    <span>By <code>{shortHash(verifyResult.record.loggedBy)}</code></span>
                  </div>
                  <button className="button primary" onClick={() => downloadCertificate(verifyResult.record.evidenceHash)}>
                    <Download size={15} /> Download Section 63 admissibility certificate
                  </button>
                </div>
              </div>
            )}

            {verifyResult?.authentic === false && (
              <div className="certificate is-alert">
                <div className="certificate-seal"><AlertTriangle size={28} /></div>
                <div>
                  <p className="eyebrow">Tamper detected — no matching record</p>
                  <h2>Evidentiary chain broken</h2>
                  <p>
                    {verifyResult.message
                      ? 'No record on the ledger carries this fingerprint. The file was never anchored, or it has been altered since it was.'
                      : 'This fingerprint was never anchored, or the file has been altered since it was.'}
                  </p>
                  <p>Inadmissible under BSA Section 63 without a valid attestation.</p>
                  <small><code>{verifyResult.hash}</code></small>
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      <footer>
        <span>Veritas Ledger · SIH 2026 · PS 26190</span>
        <span>Encrypted at rest · Audit trail preserved</span>
      </footer>
    </div>
  );
}

export default App;
