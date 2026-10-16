import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp,
  Code2, Compass, GitBranch, Plane, Play, RotateCcw,
  Route, ShieldCheck, Unplug, X,
} from 'lucide-react';
import {
  buildRequest, defaultInputs, eligibleItineraries, getScenario, itineraries,
  presets, scenarios, simulate, type DecisionResult, type Inputs, type ScenarioId,
} from './decision';
import { isRecord, runFoundry, shortlistGate, type DecisionExchange, type FoundryConfig } from './foundry';
import { AutomatedDemo } from './AutomatedDemo';

const icons = { triage: Route, shortlist: Plane, readiness: ShieldCheck };
const money = (value: number) => new Intl.NumberFormat('en-AU', {
  style: 'currency', currency: 'AUD', maximumFractionDigits: 0,
}).format(value);
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
type ModalKind = 'guide' | 'integration' | 'payload' | 'automated' | null;

function JsonPreview({ label, value }: { label: string; value: unknown }) {
  return <pre tabIndex={0} aria-label={label}>{JSON.stringify(value, (_key, entry: unknown) =>
    typeof entry === 'number' && !Number.isFinite(entry) ? 'Invalid number' : entry, 2)}</pre>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return <dialog ref={ref} className={`modal${wide ? ' modal-wide' : ''}`} onCancel={onClose} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  }} aria-labelledby="modal-title">
    <div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20} /></button></div>
    {children}
  </dialog>;
}

export function App() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>('triage');
  const [inputs, setInputs] = useState<Inputs>({ ...defaultInputs });
  const [preset, setPreset] = useState('0');
  const [threshold, setThreshold] = useState(80);
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<ModalKind>(null);
  const [technical, setTechnical] = useState(false);
  const [source, setSource] = useState<'foundry' | 'simulation'>('foundry');
  const [config, setConfig] = useState<FoundryConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [exchange, setExchange] = useState<DecisionExchange | null>(null);
  const [running, setRunning] = useState(false);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const load = async () => {
      try {
        const response = await fetch('/api/config', { signal: abort.signal });
        const value: unknown = await response.json();
        if (!response.ok || !isRecord(value) || typeof value.endpoint !== 'string' || typeof value.deployment !== 'string') {
          throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : 'Foundry adapter configuration is unavailable. Restart the local Vite server.');
        }
        setConfig({ endpoint: value.endpoint, deployment: value.deployment, auth: 'Azure CLI / Entra ID' });
      } catch (err) {
        if (!abort.signal.aborted) setConfigError(err instanceof Error ? err.message : 'Unable to load Foundry configuration.');
      }
    };
    void load();
    return () => { abort.abort(); controller.current?.abort(); };
  }, []);
  const [runCount, setRunCount] = useState(0);
  const [notice, setNotice] = useState('');
  const scenario = getScenario(scenarioId);
  const Icon = icons[scenarioId];
  const activeInputs = scenarioId === 'triage' ? { message: inputs.message }
    : scenarioId === 'shortlist' ? { budget: inputs.budget, arrivalBy: inputs.arrivalBy, priority: inputs.priority }
    : { fare: inputs.fare, cabin: inputs.cabin, approvedSupplier: inputs.approvedSupplier, refundable: inputs.refundable };
  const clearResult = () => {
    requestId.current += 1;
    controller.current?.abort();
    setRunning(false); setExchange(null); setResult(null); setError(''); setNotice('');
  };
  const change = (patch: Partial<Inputs>) => {
    setInputs((current) => ({ ...current, ...patch }));
    setPreset('custom');
    clearResult();
  };
  const switchScenario = (id: ScenarioId) => {
    setScenarioId(id);
    setInputs({ ...defaultInputs });
    setPreset('0');
    clearResult();
  };
  const reset = () => {
    setInputs({ ...defaultInputs });
    setThreshold(80);
    setPreset('0');
    clearResult();
  };
  const run = async () => {
    const id = ++requestId.current;
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setRunning(true); setResult(null); setExchange(null); setError(''); setNotice('');
    try {
      if (source === 'foundry') {
        if (!config) throw new Error(configError || 'Foundry configuration is still loading. Try again shortly.');
        const completed = await runFoundry(scenarioId, inputs, threshold / 100, abort.signal);
        if (id !== requestId.current) return;
        setExchange(completed);
        setResult(completed.result);
      } else {
        setResult(simulate(scenarioId, inputs, threshold / 100));
      }
      setRunCount((count) => count + 1);
    } catch (err) {
      if (id !== requestId.current) return;
      setResult(null);
      setError(err instanceof Error ? err.message : 'Unable to run this decision. No simulation fallback was used.');
    } finally { if (id === requestId.current) setRunning(false); }
  };
  const requestPreview = () => {
    try {
      const request = buildRequest(scenarioId, inputs);
      if (source === 'foundry') {
        const gate = shortlistGate(scenarioId, inputs, threshold / 100);
        if (gate) return gate.observations.join('\n');
      }
      return JSON.stringify(source === 'foundry' ? { model: config?.deployment ?? '(configuration unavailable)', ...request } : request, null, 2);
    }
    catch (err) { return err instanceof Error ? err.message : 'Unable to construct request.'; }
  };
  const exportRun = () => {
    if (!result) return;
    const file = new Blob([JSON.stringify({
      disclaimer: 'Synthetic travel data. Source is explicit in result.source. Not booking authorization.',
      exportedAt: new Date().toISOString(), request: exchange ? exchange.request : (result.selected ? buildRequest(scenarioId, inputs) : null),
      response: exchange?.response ?? null, durationMs: exchange?.durationMs ?? null,
      result,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `flight-team-${scenarioId}-${result.source}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Synthetic run exported as JSON.');
  };

  return <>
    <a href="#workspace" className="skip-link">Skip to decision workspace</a>
    <header className="site-header">
      <a className="brand" href="#" aria-label="Flight Team Decision Studio home" onClick={(event) => { event.preventDefault(); switchScenario('triage'); }}>
        <span className="brand-icon"><Compass size={25} strokeWidth={1.7} /></span>
        <span>Flight Team<span className="brand-sub">DECISION STUDIO</span></span>
      </a>
      <nav className="site-navigation" aria-label="Main navigation">
        <a href="#workspace">Decision studio</a>
        <button onClick={() => setModal('automated')}><Play size={17} />Automated demo</button>
        <button onClick={() => setModal('guide')}><CircleHelp size={17} />Presenter guide</button>
        <button onClick={() => setModal('integration')}><Unplug size={17} />Data & integration</button>
      </nav>
      <span className="header-label">TRAVEL DECISIONS, SIMPLIFIED</span>
    </header>

    <div className="app-shell">
      <header className="topbar">
        <div className="breadcrumb">Workspace <span>/</span> <strong>Decision studio</strong></div>
        <div className="top-actions">
          <div className="view-toggle" role="group" aria-label="Studio view">
            <button aria-pressed={!technical} onClick={() => setTechnical(false)}>Experience</button>
            <button aria-pressed={technical} onClick={() => setTechnical(true)}><Code2 size={15} />Technical</button>
          </div>
          <label className="source-selector">Execution
            <select aria-label="Decision source" value={source} onChange={(event) => {
              setSource(event.target.value === 'foundry' ? 'foundry' : 'simulation'); clearResult();
            }}><option value="foundry">Foundry live · Entra ID</option><option value="simulation">Local simulation</option></select>
          </label>
        </div>
      </header>
      <main>
        {technical ? <section className="technical-intro" aria-labelledby="page-title">
          <span className="eyebrow">UNDER THE HOOD</span>
          <h1 id="page-title">The decision, unpacked<span>.</span></h1>
          <p>Edit the context below, then inspect the request, decision contract and output. {source === 'foundry' ? 'Runs call Foundry with server-side Entra authentication.' : 'Local simulation makes no model calls.'}</p>
        </section> : <section className="hero" aria-labelledby="page-title">
          <div className="hero-copy">
            <div className="eyebrow"><span className="short-rule" /> SMALL DECISIONS. BETTER JOURNEYS.</div>
            <h1 id="page-title">Every journey.<br />A smarter next step<span>.</span></h1>
            <p>Turn everyday travel complexity into clear, bounded decisions.<br className="desktop-break" /> Three possibilities for your travel team. One simple studio.</p>
            <div className="hero-tags"><span><Check size={13} />Defined choices</span><span><Check size={13} />Visible scores</span><span><Check size={13} />People in control</span></div>
          </div>
          <div className="journey-art" aria-label="Illustrative route from Sydney to Singapore">
            <div className="journey-kicker"><span className="live-dot" /> A CLEARER WAY FORWARD</div>
            <svg viewBox="0 0 380 120" aria-hidden="true" className="journey-line">
              <path className="route-grid" d="M0 90H380 M0 50H380 M40 0V120 M110 0V120 M180 0V120 M250 0V120 M320 0V120" />
              <path className="route-back" d="M35 99 Q190 -45 345 99" />
              <path className="route-front" d="M35 99 Q140 2 211 34" />
              <circle cx="35" cy="99" r="5" /><circle cx="345" cy="99" r="5" />
            </svg>
            <span className="floating-plane"><Plane size={25} /></span>
            <div className="journey-cities"><div><strong>SYD</strong><span>Sydney</span></div><span className="route-label">THE NEXT BEST STEP <ArrowRight size={13} /></span><div><strong>SIN</strong><span>Singapore</span></div></div>
            <div className="art-caption"><GitBranch size={14} />Context in. Decision out.</div>
          </div>
        </section>}

        <section aria-labelledby="scenarios-title" className="scenario-section">
          <div className="section-heading"><h2 id="scenarios-title">Where could decisions make a difference?</h2><span>03 USE CASES TO EXPLORE</span></div>
          <div className="scenario-grid">
            {scenarios.map((item, index) => {
              const ItemIcon = icons[item.id];
              return <button key={item.id} aria-pressed={scenarioId === item.id} className={`scenario-card ${scenarioId === item.id ? 'selected' : ''}`} onClick={() => switchScenario(item.id)}>
                <div className="scenario-top"><span className="scenario-icon"><ItemIcon size={21} /></span><span className="scenario-number">0{index + 1}</span></div>
                <h3>{item.title}<ArrowUpRight size={17} /></h3><p>{item.subtitle}</p>
                <span className="scenario-type">{item.id === 'triage' ? 'CLASSIFY & ROUTE' : item.id === 'shortlist' ? 'COMPARE & SELECT' : 'CHECK & GATE'}</span>
              </button>;
            })}
          </div>
        </section>

        <section id="workspace" className="workspace-section" aria-labelledby="workspace-title">
          <div className="section-heading workspace-heading"><div><h2 id="workspace-title">Try a decision</h2><p>Change the context. Explore the outcome.</p></div><span className="local-label"><Unplug size={14} />{source === 'foundry' ? 'Foundry live · Azure CLI / Entra ID' : 'Local simulator · no model calls'}</span></div>
          {source === 'foundry' && configError && <p className="error-message" role="alert">{configError}</p>}
          <div className="workspace-grid">
            <div className="input-panel panel">
              <div className="panel-heading"><span className="step-number">1</span><h3>Set the context</h3><button className="text-button reset-button" onClick={reset}><RotateCcw size={13} />Reset</button></div>
              <form onSubmit={(event) => { event.preventDefault(); void run(); }} noValidate>
                <div className="form-body">
                  <label htmlFor="example">Example scenario</label>
                  <div className="select-wrap"><select id="example" value={preset} onChange={(event) => {
                    const value = event.target.value;
                    setPreset(value);
                    const example = presets[scenarioId][Number(value)];
                    if (example) setInputs((current) => ({ ...current, ...example.values }));
                    clearResult();
                  }}>
                    {presets[scenarioId].map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}
                    {preset === 'custom' && <option value="custom">Custom context</option>}
                  </select><ChevronDown size={15} /></div>

                  {scenarioId === 'triage' && <>
                    <div className="label-row"><label htmlFor="message">Traveller message</label><span>SYNTHETIC INPUT</span></div>
                    <textarea id="message" maxLength={2000} rows={5} value={inputs.message} aria-invalid={!!error} aria-describedby="message-hint" onChange={(event) => change({ message: event.target.value })} />
                    <p className="field-hint" id="message-hint">Edit this example or write your own. No real traveller data.</p>
                    <div className="context-chips"><span><Plane size={13} />Leisure & corporate</span><span><Route size={13} />4 service queues</span></div>
                  </>}
                  {scenarioId === 'shortlist' && <>
                    <div className="field-grid">
                      <div><label htmlFor="budget">Maximum fare (AUD)</label><input id="budget" type="number" min="0" max="10000" value={Number.isNaN(inputs.budget) ? '' : inputs.budget} onChange={(event) => change({ budget: event.target.valueAsNumber })} /></div>
                      <div><label htmlFor="arrival">Arrive by (Singapore)</label><select id="arrival" value={inputs.arrivalBy} onChange={(event) => change({ arrivalBy: Number(event.target.value) })}><option value="12">12:00</option><option value="14">14:00</option><option value="18">18:00</option></select></div>
                    </div>
                    <label htmlFor="priority">Traveller priority</label><select id="priority" value={inputs.priority} onChange={(event) => change({ priority: event.target.value as Inputs['priority'] })}><option value="balanced">Balanced fit</option><option value="price">Lowest fare</option><option value="flexibility">Flexibility & early arrival</option></select>
                    <div className="itinerary-list">
                      {itineraries.map((item) => {
                        const choice = scenario.choices.find((entry) => entry.key === item.key)!;
                        const eligible = eligibleItineraries(inputs).some((entry) => entry.key === item.key);
                        return <div className={`itinerary ${eligible ? '' : 'ineligible'}`} key={item.key}>
                          <span className="mini-plane"><Plane size={15} /></span><div><strong>{choice.label}</strong><small>{item.arrival}:00 arrival · {item.duration} · {item.direct ? 'Direct' : '1 stop'}</small><small>{item.flexible ? 'Changes permitted' : 'No changes'}{!eligible ? ' · Outside constraints' : ''}</small></div><b>{money(item.price)}</b>
                        </div>;
                      })}
                    </div>
                    <p className="field-hint">Fictional SYD to SIN itineraries. Fares are not live offers.</p>
                  </>}
                  {scenarioId === 'readiness' && <>
                    <div className="field-grid">
                      <div><label htmlFor="fare">Proposed fare (AUD)</label><input id="fare" type="number" min="1" max="100000" value={Number.isNaN(inputs.fare) ? '' : inputs.fare} onChange={(event) => change({ fare: event.target.valueAsNumber })} /></div>
                      <div><label htmlFor="cabin">Cabin</label><select id="cabin" value={inputs.cabin} onChange={(event) => change({ cabin: event.target.value as Inputs['cabin'] })}><option value="economy">Economy</option><option value="business">Business</option></select></div>
                    </div>
                    <label className="checkbox-label"><input type="checkbox" checked={inputs.approvedSupplier} onChange={(event) => change({ approvedSupplier: event.target.checked })} />Supplier is on the approved list</label>
                    <label className="checkbox-label"><input type="checkbox" checked={inputs.refundable} onChange={(event) => change({ refundable: event.target.checked })} />Fare has refundable conditions</label>
                    <div className="policy-note"><ShieldCheck size={17} /><div><strong>Illustrative policy, not an operational policy</strong><p>Economy · up to AUD 1,000 · approved supplier · refundable fare. Exceptions need approval or review.</p></div></div>
                  </>}

                  <div className="threshold-control"><div className="label-row"><label htmlFor="threshold">Human-review threshold</label><output htmlFor="threshold">{threshold}%</output></div><input id="threshold" type="range" min="50" max="99" value={threshold} onChange={(event) => { setThreshold(Number(event.target.value)); clearResult(); }} /><div className="range-labels"><span>More recommendations</span><span>More review</span></div></div>
                  {error && <p className="error-message" role="alert">{error}</p>}
                </div>
                <div className="run-footer"><button className="primary-button" type="submit" disabled={running}><Play size={15} fill="currentColor" />{running ? 'Running decision...' : source === 'foundry' ? 'Run Foundry decision' : 'Run simulation'}<ArrowRight size={17} /></button><span>{source === 'foundry' ? 'Synthetic inputs sent to Foundry. No automatic booking.' : 'Deterministic rules. Zero API calls.'}</span></div>
              </form>
            </div>

            <div className="result-panel panel">
              <div className="panel-heading"><span className="step-number">2</span><h3>{technical ? 'Application output JSON' : 'Explore the decision'}</h3><span className="tiny-badge">{result?.source === 'application-gate' ? 'GATE · NO CALL' : source === 'foundry' ? 'FOUNDRY LIVE' : 'SIMULATED'}</span></div>
              <div className="result-body" aria-live="polite" aria-atomic="true">
                {technical ? <div className="technical-output">
                  <p className="field-hint">Application result with explicit source and enforced policy gates. {source === 'simulation' ? 'Scores are normalized local rule weights.' : 'Foundry probabilities are not calibrated for operational use.'} Observations are application rules, not generated explanations.</p>
                  {result ? <JsonPreview label="Application output JSON" value={result} />
                    : <p className="technical-empty">{error ? `Decision failed: ${error}` : running ? 'Waiting for the decision...' : 'No current output. Run a decision to produce a result. Editing inputs clears stale output.'}</p>}
                </div> : !result ? <div className="empty-result">
                  <div className="decision-orbit"><span /><span /><Icon size={32} strokeWidth={1.4} /></div>
                  <span className="eyebrow">FROM CONTEXT TO CLARITY</span>
                  <h3>A small decision.<br />A meaningful next step.</h3>
                  <p>{scenario.description} {running ? 'Waiting for Foundry...' : 'Set the context, then run a decision to see the options side by side.'}</p>
                  <div className="empty-flow"><span>Context</span><ArrowRight size={13} /><span>Score</span><ArrowRight size={13} /><span>Next step</span></div>
                </div> : <div className="decision-result">
                  <div className="result-eyebrow"><span className={`status-dot ${result.needsReview ? 'review' : ''}`} /><span>{result.needsReview ? 'HUMAN IN THE LOOP' : 'RECOMMENDATION AVAILABLE'}</span></div>
                  <h3>{result.selectedLabel}</h3>
                  <p className="result-disposition">{result.disposition}</p>
                  <div className="result-metrics"><div><strong>{result.source === 'application-gate' ? 'Not scored' : percent(result.topScore)}</strong><span>{result.source === 'foundry' ? 'Top model probability' : result.source === 'application-gate' ? 'Application gate · no model call' : 'Top synthetic score'}</span></div>{result.source !== 'application-gate' && <div><strong>{(result.gap * 100).toFixed(1)}<small> pp</small></strong><span>Top-two score gap</span></div>}</div>
                  <div className="score-heading"><h4>Options compared</h4><span>{result.source === 'foundry' ? 'FOUNDRY PROBABILITIES' : result.source === 'application-gate' ? 'MODEL CALL BLOCKED' : 'LOCAL RULE WEIGHTS'}</span></div>
                  <div className="score-list">{result.scores.map((score, index) => <div key={score.key} className={`score-item ${index === 0 && score.eligible ? 'top-score' : ''}`}>
                    <div className="score-label"><span>{score.label}{score.key === result.selected && <Check size={13} />}</span><strong>{!score.eligible ? 'Ineligible' : result.source === 'application-gate' ? 'Not scored' : percent(score.probability)}</strong></div>
                    <div className="score-track" role="meter" aria-label={`${score.label} ${result.source === 'foundry' ? 'model probability' : 'synthetic score'}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score.probability * 100}><span style={{ width: `${score.probability * 100}%` }} /></div>
                  </div>)}</div>
                  <details className="rule-details"><summary>Application rule observations <ChevronDown size={14} /></summary><ul>{result.observations.map((observation) => <li key={observation}>{observation}</li>)}</ul><p>These are local rule observations, not a model's explanation.</p></details>
                  <p className="score-disclaimer">{result.source === 'foundry' ? 'Model probabilities, not calibrated confidence.' : 'Application-only scores, not model probabilities.'} Review if below {threshold}% or if the top-two gap is under 10 pp. Policy gates always apply.{exchange?.response && ` Model: ${exchange.response.model}. Round trip: ${exchange.durationMs} ms.`}</p>
                </div>}
              </div>
              <div className="result-footer"><button className="text-button" onClick={() => setModal('payload')}><Code2 size={15} />Inspect payload</button><button className="text-button" disabled={!result} onClick={exportRun}><ArrowDownToLine size={15} />Export run</button></div>
            </div>
          </div>
          {notice && <p className="export-notice" role="status">{notice}</p>}
        </section>

        {technical && <section className="technical-section" aria-labelledby="technical-title">
          <div className="section-heading"><div><h2 id="technical-title">Decision contract & data</h2><p>{source === 'foundry' ? 'Inputs are sent to Foundry only when you run a decision. Tokens stay on the local server.' : 'Local simulation: nothing is sent to Azure.'}</p></div></div>
          <div className="technical-grid">
            <article className="panel technical-card">
              <h3>Input JSON</h3>
              <p className="field-hint">Active scenario fields and application review settings. Invalid numeric fields are explicitly marked.</p>
              <JsonPreview label="Input JSON" value={{ scenario: scenarioId, inputs: activeInputs, reviewThreshold: threshold / 100 }} />
            </article>
            <article className="panel technical-card">
              <h3>Decision structure</h3>
              <p className="field-hint">Application inspection metadata, not an additional API payload. Policy gates remain outside model scoring.</p>
              <JsonPreview label="Decision structure JSON" value={{
                question: 'next_step', type: 'choice', instructions: scenario.question,
                choices: scenario.choices.map((choice) => ({
                  ...choice,
                  eligible: scenarioId !== 'shortlist' || eligibleItineraries(inputs).some((item) => item.key === choice.key),
                })),
                scoring: source === 'foundry' ? 'Validated Foundry choice probabilities; no local score fallback.' : 'Softmax-normalized deterministic local rule weights; not model confidence.',
                review: { minimumTopScore: threshold / 100, minimumTopTwoGap: 0.1, consultantConfirmationRequired: true },
                gates: scenarioId === 'shortlist'
                  ? ['Fare <= budget AND arrival <= deadline.', 'Exclude ineligible options from the request.', 'Fewer than two eligible itineraries: no scoring request; human review.']
                  : scenarioId === 'readiness'
                    ? ['Fare > AUD 1,000 OR non-economy cabin: manager approval.', 'Unapproved supplier OR non-refundable fare: consultant verification.', 'Preserve both requirements when both apply.']
                    : ['Low top score or close options require human review.', 'Consultant confirms routing.'],
              }} />
            </article>
            <article className="panel technical-card technical-request">
              <h3>Proposed request JSON</h3>
              <p className="field-hint">{source === 'foundry' ? `Endpoint: ${config?.endpoint ?? 'Loading configuration...'}. Deployment: ${config?.deployment ?? 'Not available'}. Auth: Azure CLI / Entra ID.` : 'Preview only; local mode does not send this request.'} Invalid inputs or fewer than two eligible itineraries block live inference.</p>
              <pre tabIndex={0} aria-label="Proposed request JSON">{requestPreview()}</pre>
            </article>
            {source === 'foundry' && <article className="panel technical-card technical-request">
              <h3>Last Foundry exchange</h3>
              <p className="field-hint">Actual sent request and validated response fields, separate from the application result. No credentials or authorization headers are included. Cleared on context changes.</p>
              {exchange ? <>
                <JsonPreview label="Sent request JSON" value={exchange.request} />
                <JsonPreview label="Foundry response JSON" value={exchange.response} />
                <p className="field-hint">{exchange.response ? `${exchange.durationMs} ms including authentication and inference. Confidence is shown as returned, not used as a policy permission.` : 'Application eligibility gate blocked inference. Zero score fields mean not scored, not model probabilities. No request was sent.'}</p>
              </> : <p className="technical-empty">No completed exchange for the current inputs.</p>}
            </article>}
          </div>
        </section>}

        <section className="principles-strip" aria-label="Demo guardrails">
          <div><span className="principle-icon"><GitBranch size={19} /></span><div><h3>Decisions, not dialogue</h3><p>Defined options. Structured output.</p></div></div>
          <div><span className="principle-icon"><ShieldCheck size={19} /></span><div><h3>People stay in control</h3><p>Scores never override policy.</p></div></div>
          <div><span className="principle-icon"><Unplug size={19} /></span><div><h3>Explicit execution source</h3><p>Live Foundry or local simulation. Never a silent fallback.</p></div></div>
        </section>
        <footer className="page-footer"><span>FLIGHT TEAM <span>/</span> DECISION STUDIO</span><p>Independent concept demo · Synthetic data only · Not a booking tool</p><span>{runCount} {runCount === 1 ? 'run' : 'runs'} this session</span></footer>
      </main>
    </div>

    {modal && <Modal wide={modal === 'automated'} title={modal === 'automated' ? 'How decision models create value' : modal === 'guide' ? 'Your five-minute walkthrough' : modal === 'integration' ? 'An honest model boundary' : 'Inside the decision'} onClose={() => setModal(null)}>
      {modal === 'automated' && <AutomatedDemo />}
      {modal === 'guide' && <div className="guide-content">
        <p className="modal-intro">Choose Foundry live for real Decision-1 inference or Local simulation for deterministic comparisons. All travel data and policies remain synthetic.</p>
        <ol className="guide-steps">
          <li><strong>Start with a disruption.</strong><p>Run the cancelled-flight example. Compare the four service queues, then load the unclear request to explore the illustrative review threshold.</p></li>
          <li><strong>Find a better-fitting trip.</strong><p>Switch to trip shortlist. Compare balanced fit with lowest fare, then lower the budget to AUD 500. No eligible itinerary means no recommendation.</p></li>
          <li><strong>Make policy visible.</strong><p>Switch to booking readiness. Run within policy, then load the policy exception. High scores cannot remove an approval requirement.</p></li>
          <li><strong>Explain the boundary.</strong><p>Switch to Technical. Compare the sent request and validated Foundry response with the application result. Decision-1 returns numerical decisions, not a written rationale. The application retains policy and review gates.</p></li>
        </ol>
        <div className="policy-note"><CircleHelp size={20} /><p>Discovery prompt: which queue, shortlist or policy gate is repetitive enough to test with real labelled examples?</p></div>
        <p className="field-hint">Examples span leisure and corporate travel. Use cases are hypotheses, not confirmed customer requirements.</p>
      </div>}
      {modal === 'integration' && <div className="integration-content">
        <span className="simulation-badge"><span />{source === 'foundry' ? 'Foundry live selected' : 'Local simulation selected'}</span>
        <p className="modal-intro">Live inference uses the existing Decision-1 deployment with Entra ID. Synthetic policies stay in application code.</p>
        <div className="integration-flow"><span>Web interface<small>No tokens</small></span><ArrowRight size={18} /><span>Local server adapter<small>Azure CLI credential</small></span><ArrowRight size={18} /><span>Foundry model<small>{config?.deployment ?? 'Not configured'}</small></span></div>
        <h3>Authentication & configuration</h3><ul><li>The ignored server-side .env stores the endpoint, deployment and optional subscription ID, never a token or key.</li><li>AzureCliCredential uses the signed-in Azure CLI identity. Tokens stay in server memory and are acquired for Cognitive Services.</li><li>No global Azure account context is changed. Missing sign-in, access failures and invalid responses are explicit errors, not simulation fallbacks.</li></ul>
        <h3>Controls that remain outside scoring</h3><ul><li>Budget and arrival gates exclude ineligible itineraries before inference.</li><li>Fare/cabin exceptions and supplier/refund verification remain mandatory, regardless of model selection.</li><li>Review thresholds must be evaluated and calibrated before operational use.</li></ul>
        <p className="field-hint">In live mode, running a decision sends the current synthetic scenario to Azure and may incur usage charges. Local mode sends no inference request. No booking or routing action is executed. Inputs and results remain in page memory unless exported; Azure service processing and retention follow your resource configuration.</p>
        <div className="source-links"><a href="https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision" target="_blank" rel="noreferrer">Decision-1 documentation <ArrowUpRight size={13} /></a></div>
      </div>}
      {modal === 'payload' && <div className="payload-content">
        <p className="modal-intro">{source === 'foundry' ? 'Request preview and last completed exchange for the current context. Credentials stay on the server.' : 'Local simulation only. No request has been sent to Foundry.'}</p>
        <h3>Request preview</h3><pre tabIndex={0}>{requestPreview()}</pre>
        {exchange && <><h3>Sent request</h3><JsonPreview label="Dialog sent request JSON" value={exchange.request} /><h3>Validated Foundry response</h3><JsonPreview label="Dialog Foundry response JSON" value={exchange.response} /></>}
        <h3>Application result <span className="subtle">(includes policy gates)</span></h3><pre tabIndex={0}>{result ? JSON.stringify(result, null, 2) : 'Run a decision to inspect the result.'}</pre>
        <p className="field-hint">Decision-1 supplies numerical decisions, not generated explanations. Application rule observations are separate from the model response.</p>
      </div>}
    </Modal>}
  </>;
}
