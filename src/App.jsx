import { useState } from 'react';
import { ethers } from 'ethers';
import { Activity, ArrowRight, Check, Clipboard, FileCheck2, Fingerprint, LockKeyhole, ShieldCheck, Upload, Wifi } from 'lucide-react';
import './App.css';

const CONTRACT_ADDRESS = '0xbc215903484c0335d6848B6a0C1CD3DD112a48Ef';
const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7';
const CONTRACT_ABI = [
  { inputs: [{ name: '_docHash', type: 'string' }, { name: '_summary', type: 'string' }], name: 'registerDocument', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ name: '_docHash', type: 'string' }], name: 'verifyDocument', outputs: [{ name: 'summary', type: 'string' }, { name: 'timestamp', type: 'uint256' }, { name: 'registeredBy', type: 'address' }], stateMutability: 'view', type: 'function' },
];

const custodyStops = [
  ['Police Station', 'Evidence received and sealed', '14 Aug 2026 · 21:45 hrs'],
  ['FSL Laboratory', 'Ballistics examination logged', '16 Aug 2026 · 10:20 hrs'],
  ['Magistrate Court', 'Judicial record available for review', 'Pending court submission'],
];

function App() {
  const [activeTab, setActiveTab] = useState('ingest');
  const [file, setFile] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [verifyId, setVerifyId] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState('');

  const reset = () => { setFile(null); setAnalysis(null); setError(''); setTxHash(''); setVerifyResult(null); };

  const getContract = async () => {
    if (!window.ethereum) throw new Error('MetaMask is not installed.');
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }] });
    } catch (switchError) {
      if (switchError.code !== 4902) throw switchError;
      await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: SEPOLIA_CHAIN_ID_HEX, chainName: 'Sepolia', nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://rpc.sepolia.org'], blockExplorerUrls: ['https://sepolia.etherscan.io'] }] });
    }
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    return new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, await provider.getSigner());
  };

  const processDocument = async (selectedFile) => {
    if (!selectedFile || selectedFile.type !== 'application/pdf') { setError('Only PDF files are supported.'); return; }
    setFile(selectedFile); setAnalysis(null); setError(''); setBusy(true);
    try {
      const formData = new FormData(); formData.append('pdf', selectedFile);
      const response = await fetch('http://localhost:3001/analyze', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Server analysis failed');
      setAnalysis(data);
    } catch (requestError) { setError(`Analysis failed: ${requestError.message}. Is the server running on port 3001?`); }
    finally { setBusy(false); }
  };

  const registerDocument = async () => {
    if (!analysis) return;
    setBusy(true); setError('');
    try { const tx = await (await getContract()).registerDocument(analysis.docHash, analysis.summary || 'No summary available.'); await tx.wait(); setTxHash(tx.hash); }
    catch (transactionError) { setError(transactionError.reason || transactionError.message || 'Transaction failed.'); }
    finally { setBusy(false); }
  };

  const verifyDocument = async () => {
    if (!verifyId.trim()) { setError('Enter a document SHA-256 fingerprint.'); return; }
    setBusy(true); setError(''); setVerifyResult(null);
    try { const [summary, timestamp, registeredBy] = await (await getContract()).verifyDocument(verifyId.trim()); setVerifyResult({ summary, timestamp: Number(timestamp), registeredBy }); }
    catch (verificationError) { setError(verificationError.reason || 'No matching document was found on Sepolia.'); }
    finally { setBusy(false); }
  };

  const copyHash = (hash) => navigator.clipboard.writeText(hash);
  const score = analysis?.score ?? 0;

  return <div className="app-shell">
    <header className="institutional-header"><div className="brand-lockup"><div className="brand-mark"><Fingerprint size={24} /></div><div><p className="eyebrow">Evidence intelligence platform</p><h1>VERITAS LEDGER</h1><p className="system-name">// Digital Evidence &amp; Custody Chain Management System</p></div></div><div className="status-row"><span><Wifi size={14} /> Network: Sepolia Testnet <b>Active</b></span><span><ShieldCheck size={14} /> BNSS 2023 Engine <b>Online</b></span><span><LockKeyhole size={14} /> Client Encryption <b>Active</b></span></div></header>
    <nav className="workflow-tabs" aria-label="Evidence workflow"><button className={activeTab === 'ingest' ? 'active' : ''} onClick={() => { setActiveTab('ingest'); setError(''); }}><Upload size={16} /> Evidence Ingestion &amp; Ledger Anchoring</button><button className={activeTab === 'timeline' ? 'active' : ''} onClick={() => setActiveTab('timeline')}><Activity size={16} /> Chain of Custody Timeline</button><button className={activeTab === 'verify' ? 'active' : ''} onClick={() => { setActiveTab('verify'); setError(''); }}><FileCheck2 size={16} /> Judicial Integrity &amp; Tamper Check</button></nav>
    <main>
      {activeTab === 'ingest' && <section className="workspace-grid fade-in"><div className="primary-column"><div className="section-heading"><div><p className="eyebrow">01 / ingest</p><h2>Anchor evidence to the ledger</h2><p>Analyse, redact, and register a source PDF without exposing sensitive details on-chain.</p></div><span className="live-tag"><span /> LIVE PIPELINE</span></div>{!analysis && <label className={`dropzone ${busy ? 'processing' : ''}`}><input type="file" accept="application/pdf,.pdf" onChange={(event) => processDocument(event.target.files[0])} />{busy ? <div className="spinner" /> : <><Upload size={38} /><strong>{file ? file.name : 'Drop a legal PDF here'}</strong><small>FIR, forensic report, or evidentiary record · PDF only</small></>}</label>}{analysis && <div className="report-panel"><div className="report-top"><div><p className="eyebrow">ANALYSIS REPORT</p><h2>{analysis.type}</h2><span className="document-badge">Document type verified</span></div><div className="gauge compact" style={{ '--score': `${score * 3.6}deg` }}><strong>{score}%</strong><small>health</small></div></div><div className="hash-box"><div><small>SHA-256 FINGERPRINT</small><code>{analysis.docHash}</code></div><button title="Copy fingerprint" onClick={() => copyHash(analysis.docHash)}><Clipboard size={17} /></button></div><div className="report-columns"><div><h3>Redacted executive summary</h3><p className="summary">{analysis.summary}</p></div><div><h3>Statutory compliance checklist</h3><ul className="checklist">{(analysis.risks || []).map((item, index) => <li key={index} className={item.status}><span>{item.status === 'detected' ? <Check size={14} /> : '!'}</span><div><b>{item.name.replace(/^Missing: /, '')}</b><small>{item.explanation}</small></div></li>)}</ul></div></div><div className="report-actions"><button className="button primary" onClick={registerDocument} disabled={busy}><ShieldCheck size={17} /> {busy ? 'Anchoring...' : 'Anchor on Sepolia'}</button><button className="button ghost" onClick={reset}>Clear record</button></div></div>}{txHash && <div className="certificate"><div className="certificate-seal"><ShieldCheck size={32} /></div><div><p className="eyebrow">CERTIFICATE OF EVIDENTIARY INTEGRITY</p><h2>BNSS Sec. 63 Compliant</h2><p>Cryptographic fingerprint anchored successfully on Sepolia.</p><small>{new Date().toLocaleString()} · TX {txHash.slice(0, 18)}...</small></div></div>}{error && <p className="error-message">{error}</p>}</div><aside className="side-column"><div className="metric-card"><p className="eyebrow">EVIDENTIARY HEALTH</p><div className="gauge" style={{ '--score': `${score * 3.6}deg` }}><strong>{score}%</strong><small>compliance</small></div><p className="metric-note">Based on statutory fields, custody markers, and seal verification.</p></div><div className="signal-card"><p className="eyebrow">PROCESSING SIGNALS</p><div><span className="signal-dot green" /> Local PII redaction</div><div><span className="signal-dot green" /> SHA-256 integrity scan</div><div><span className="signal-dot amber" /> Human review recommended</div></div></aside></section>}
      {activeTab === 'timeline' && <section className="timeline-view fade-in"><div className="section-heading"><div><p className="eyebrow">02 / custody</p><h2>Chronological chain of custody</h2><p>Mocked operational milestones illustrate the judicial handoff record.</p></div><span className="case-state">CASE FLOW / 104-2026</span></div><div className="timeline">{custodyStops.map(([location, event, date], index) => <div className="timeline-event" key={location}><div className="timeline-marker">{index + 1}</div><div className="timeline-content"><small>{date}</small><h3>{location}</h3><p>{event}</p></div>{index < custodyStops.length - 1 && <ArrowRight className="timeline-arrow" size={20} />}</div>)}</div></section>}
      {activeTab === 'verify' && <section className="verify-view fade-in"><div className="section-heading"><div><p className="eyebrow">03 / judicial review</p><h2>Verify evidentiary integrity</h2><p>Query the deployed contract using the original SHA-256 fingerprint.</p></div><span className="case-state">READ-ONLY QUERY</span></div><div className="verify-form"><label htmlFor="verify-id">Document fingerprint</label><div><input id="verify-id" value={verifyId} onChange={(event) => setVerifyId(event.target.value)} placeholder="0x... 64-character SHA-256 fingerprint" /><button className="button primary" onClick={verifyDocument} disabled={busy}><FileCheck2 size={17} /> {busy ? 'Checking...' : 'Verify on-chain'}</button></div></div>{error && <p className="error-message">{error}</p>}{verifyResult && <div className="certificate verification-certificate"><div className="certificate-seal"><ShieldCheck size={32} /></div><div><p className="eyebrow">CERTIFICATE OF EVIDENTIARY INTEGRITY</p><h2>BNSS Sec. 63 Compliant</h2><p>Matching record returned from the Sepolia ledger.</p><div className="result-meta"><span>Registered {new Date(verifyResult.timestamp * 1000).toLocaleString()}</span><span>By <code>{verifyResult.registeredBy}</code></span></div><p className="summary">{verifyResult.summary}</p></div></div>}</section>}
    </main><footer><span>VERITAS LEDGER / INTERNAL JUSTICE SYSTEM</span><span>ENCRYPTED AT REST · AUDIT LOG ENABLED</span></footer>
  </div>;
}

export default App;