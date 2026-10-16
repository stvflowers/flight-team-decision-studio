import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Code2, GitBranch, Plane, RotateCcw, ShieldCheck, UserCheck } from 'lucide-react';
import { buildRequest, defaultInputs, getScenario, simulate } from './decision';

const stages = [
  { node: 0, title: 'Start with context, not a conversation.',
    text: 'A traveller is stranded after a cancelled flight. The application supplies that message as state. The task is a bounded routing decision, not writing a travel plan.',
    value: 'Opportunity: help a consultant identify the right service queue from an unstructured request.' },
  { node: 1, title: 'Define the decision before asking the model.',
    text: 'The application names a question, gives an instruction and describes four allowed choices. Microsoft Decision-1 judges among those choices instead of inventing a new destination or generating a written answer.',
    value: 'Value: an explicit decision contract that application code can validate and consume.' },
  { node: 2, title: 'Microsoft Decision-1 makes a focused judgment.',
    text: 'In live mode, the local server sends state and choices to the deployed model in Foundry. Entra authentication stays on the server. Decision-1 returns a typed choice and option probabilities, not a generated rationale.',
    value: 'Value: model-based judgment about text or JSON, delivered as a structured numerical decision.' },
  { node: 3, title: 'Compare the whole distribution, not just the winner.',
    text: 'The returned probabilities let an application rank choices. A low top probability or a small top-two gap can trigger review. These bars use the local simulator for illustration; they are not live or recorded Decision-1 output.',
    value: 'Value: numerical output supports measurable review rules. Probabilities still need evaluation and calibration.' },
  { node: 4, title: 'The application decides what may happen next.',
    text: 'This demo checks an illustrative 80% threshold and a 10-point top-two gap. Budget, arrival, manager approval and verification gates stay outside model scoring. A high score is never booking permission.',
    value: 'Value: combine model judgment with explicit controls rather than delegating policy authority.' },
  { node: 5, title: 'A recommendation reaches a person, not a booking API.',
    text: 'The consultant sees the proposed queue, scores and application rule observations. Those observations are not the model explaining itself. A person confirms the handoff; this demo performs no operational action.',
    value: 'Opportunity: a more focused handoff with the decision boundary visible to the consultant.' },
  { node: 5, title: 'The same pattern fits three travel decisions.',
    text: 'Classify a service request, compare eligible itineraries, or assess booking readiness. Each uses supplied context and finite choices. With fewer than two eligible itineraries, this app skips inference and requests review.',
    value: 'Value hypothesis: reusable bounded decisions across routing, ranking and readiness. No measured productivity or ROI claim.' },
  { node: 5, title: 'Inspect, evaluate, then decide where to automate.',
    text: 'Use Technical view to compare the actual sent request, validated Foundry response and policy-gated application output. Evaluate labelled examples and tune thresholds before operational use. This walkthrough made no inference calls.',
    value: 'Next: close this walkthrough and run a synthetic example in Foundry live to inspect real model output.' },
];
const nodes = [
  { label: 'Context', icon: Plane }, { label: 'Choices', icon: GitBranch },
  { label: 'Decision-1', icon: Code2 }, { label: 'Probabilities', icon: GitBranch },
  { label: 'App gates', icon: ShieldCheck }, { label: 'Consultant', icon: UserCheck },
];
const example = simulate('triage', defaultInputs, 0.8);
const request = buildRequest('triage', defaultInputs);

export function AutomatedDemo() {
  const [step, setStep] = useState(0);
  const stage = stages[step];
  const finished = step === stages.length - 1;

  return <div className="auto-demo">
    <div className="auto-controls" role="group" aria-label="Walkthrough navigation">
      <button className="text-button" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={16} />Previous</button>
      <span className="auto-step-count">Step {step + 1} of {stages.length}</span>
      <button className="primary-button" disabled={finished} onClick={() => setStep(step + 1)}>Next<ArrowRight size={16} /></button>
      <button className="text-button" onClick={() => setStep(0)}><RotateCcw size={16} />Restart</button>
    </div>
    <div className="auto-disclaimer"><strong>ILLUSTRATIVE PLAYBACK · NO INFERENCE CALLS</strong>
      <p>Synthetic inputs and local simulator scores, not captured model output. Your workspace is unchanged. Advance at your own pace.</p>
    </div>
    <ol className="auto-pipeline" aria-label="Decision process">
      {nodes.map(({ label, icon: Icon }, index) => <li key={label} className={index === stage.node ? 'active' : index < stage.node ? 'complete' : ''} aria-current={index === stage.node ? 'step' : undefined}>
        <span className="auto-node"><Icon size={24} /></span><strong>{label}</strong>
        {index < nodes.length - 1 && <ArrowRight className="auto-connector" size={18} />}
      </li>)}
    </ol>
    <div className="auto-scene" key={step}>
      <div className="auto-narration" aria-live="polite" aria-atomic="true">
        <span className="eyebrow">{finished ? 'WALKTHROUGH COMPLETE' : 'PRESENTER-LED WALKTHROUGH'}</span>
        <h3>{stage.title}</h3><p>{stage.text}</p>
        <div className="auto-value"><Check size={18} /><p>{stage.value}</p></div>
      </div>
      <div className="auto-visual" aria-label="Step illustration">
        {step === 0 && <><Plane size={42} /><span className="eyebrow">SYNTHETIC TRAVELLER MESSAGE</span><blockquote>{defaultInputs.message}</blockquote><span className="auto-chip">state → bounded question</span></>}
        {step === 1 && <><h4>{getScenario('triage').question}</h4>{getScenario('triage').choices.map((choice) => <div className="auto-choice" key={choice.key}><GitBranch size={16} /><div><strong>{choice.label}</strong><small>{choice.description}</small></div></div>)}</>}
        {step === 2 && <><Code2 size={32} /><h4>Microsoft Decision-1 · Foundry</h4><pre tabIndex={0} aria-label="Illustrative choice contract">{[
          'state: traveller message',
          'question: next_step',
          `type: ${request.questions.next_step.type}`,
          `choices: ${Object.keys(request.questions.next_step.criteria).join(', ')}`,
        ].join('\n')}</pre><span className="auto-chip">Typed numerical output, not prose</span></>}
        {step === 3 && <><h4>Illustrative local scores</h4>{example.scores.map((score) => <div className="auto-score" key={score.key}><div><span>{score.label}</span><strong>{(score.probability * 100).toFixed(1)}%</strong></div><div className="score-track"><span style={{ width: `${score.probability * 100}%` }} /></div></div>)}<p className="field-hint">Simulator softmax rule weights. Not model probabilities, model internals or calibrated confidence.</p></>}
        {step === 4 && <><ShieldCheck size={42} /><h4>Scores never override policy</h4><div className="auto-choice"><Check size={18} /><div><strong>Routing example</strong><small>Threshold + gap checked → consultant recommendation</small></div></div><div className="auto-choice"><ShieldCheck size={18} /><div><strong>Booking policy counterexample</strong><small>Fare above AUD 1,000 → manager approval, even if the model chooses “ready”.</small></div></div><div className="auto-chip">Application-owned rules</div></>}
        {step === 5 && <><UserCheck size={42} /><h4>Suggested handoff: Disruption desk</h4><div className="auto-choice"><Check size={18} /><div><strong>Consultant confirms</strong><small>No queue action or booking is executed.</small></div></div><p className="field-hint">The illustrated suggestion comes from local rules. In live mode, the application validates the actual model response first.</p></>}
        {step === 6 && <>{[
          ['01 · Disruption triage', 'Message → one of four service queues'],
          ['02 · Trip shortlist', 'Budget + arrival gates → rank eligible trips'],
          ['03 · Booking readiness', 'Proposed booking → readiness + mandatory review'],
        ].map(([title, text]) => <div className="auto-choice" key={title}><GitBranch size={22} /><div><strong>{title}</strong><small>{text}</small></div></div>)}</>}
        {step === 7 && <><Check size={42} /><h4>Structured judgment. Explicit control.</h4><div className="auto-choice"><Code2 size={20} /><div><strong>Model response</strong><small>Choice + option probabilities</small></div></div><ArrowRight size={20} /><div className="auto-choice"><ShieldCheck size={20} /><div><strong>Application result</strong><small>Validated output + policy gates + human confirmation</small></div></div><span className="auto-chip">Evaluate before operational automation</span></>}
      </div>
    </div>
    <div className="auto-progress" role="progressbar" aria-label="Walkthrough progress" aria-valuemin={0} aria-valuemax={stages.length} aria-valuenow={step + 1}><span style={{ width: `${(step + 1) / stages.length * 100}%` }} /></div>
  </div>;
}
