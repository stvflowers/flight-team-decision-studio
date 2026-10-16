export type ScenarioId = 'triage' | 'shortlist' | 'readiness';
export type Priority = 'balanced' | 'price' | 'flexibility';
export interface Inputs {
  message: string;
  budget: number;
  arrivalBy: number;
  priority: Priority;
  fare: number;
  cabin: 'economy' | 'business';
  approvedSupplier: boolean;
  refundable: boolean;
}
export interface Choice { key: string; label: string; description: string }
export interface Scenario {
  id: ScenarioId;
  title: string;
  subtitle: string;
  question: string;
  description: string;
  value: string;
  choices: Choice[];
}
export const scenarios: Scenario[] = [
  {
    id: 'triage', title: 'Disruption triage', subtitle: 'The right team. First time.',
    question: 'Which team should handle this traveller request?',
    description: 'Turn a traveller message into a focused service handoff.',
    value: 'Support your consultants with a consistent first-touch routing decision.',
    choices: [
      { key: 'disruption', label: 'Disruption desk', description: 'Cancelled or delayed travel and missed connections.' },
      { key: 'leisure', label: 'Leisure consultant', description: 'New holiday enquiries and leisure trip quotes.' },
      { key: 'refunds', label: 'Refund team', description: 'Refund status and reimbursement enquiries without active disruption.' },
      { key: 'support', label: 'General support', description: 'Other account or booking help.' },
    ],
  },
  {
    id: 'shortlist', title: 'Trip shortlist', subtitle: 'Less searching. Better fit.',
    question: 'Which eligible itinerary best fits the stated traveller preferences?',
    description: 'Compare a fixed shortlist, with the traveller in mind.',
    value: 'Bring budget, timing and flexibility into one bounded selection.',
    choices: [
      { key: 'direct', label: 'Harbour Direct', description: 'AUD 920; arrives 14:00; direct; changes permitted.' },
      { key: 'saver', label: 'Skyline Saver', description: 'AUD 640; arrives 18:00; one stop; changes not permitted.' },
      { key: 'flex', label: 'Horizon Flex', description: 'AUD 1,180; arrives 12:00; direct; changes permitted.' },
    ],
  },
  {
    id: 'readiness', title: 'Booking readiness', subtitle: 'Policy before purchase.',
    question: 'What is the next step for this proposed corporate booking?',
    description: 'Surface policy exceptions before a booking goes ahead.',
    value: 'Keep corporate controls visible without slowing down a compliant proposal.',
    choices: [
      { key: 'ready', label: 'Ready for consultant', description: 'All synthetic policy checks pass; consultant still confirms booking.' },
      { key: 'approval', label: 'Manager approval', description: 'Known fare or cabin policy exception requires manager approval.' },
      { key: 'review', label: 'Human review', description: 'Supplier or fare conditions require verification by a consultant.' },
    ],
  },
];
export const defaultInputs: Inputs = {
  message: 'My flight from Sydney to Singapore has been cancelled. I am at the airport and need help getting to my meeting tomorrow.',
  budget: 1200, arrivalBy: 18, priority: 'balanced',
  fare: 920, cabin: 'economy', approvedSupplier: true, refundable: true,
};
export const itineraries = [
  { key: 'direct', price: 920, arrival: 14, direct: true, flexible: true, duration: '8h 20m' },
  { key: 'saver', price: 640, arrival: 18, direct: false, flexible: false, duration: '12h 10m' },
  { key: 'flex', price: 1180, arrival: 12, direct: true, flexible: true, duration: '8h 10m' },
];
export const presets: Record<ScenarioId, { name: string; values: Partial<Inputs> }[]> = {
  triage: [
    { name: 'Cancelled flight', values: { message: defaultInputs.message } },
    { name: 'Holiday enquiry', values: { message: 'We would like a quote for a family holiday in Singapore, including flights and a hotel.' } },
    { name: 'Refund follow-up', values: { message: 'Please check the refund status for my previous booking. My travel is already complete.' } },
    { name: 'Unclear request', values: { message: 'Can you help me with my trip?' } },
  ],
  shortlist: [
    { name: 'Balanced trip', values: { budget: 1200, arrivalBy: 18, priority: 'balanced' } },
    { name: 'Lowest fare', values: { budget: 1200, arrivalBy: 18, priority: 'price' } },
    { name: 'No eligible options', values: { budget: 500, arrivalBy: 18, priority: 'balanced' } },
  ],
  readiness: [
    { name: 'Within policy', values: { fare: 920, cabin: 'economy', approvedSupplier: true, refundable: true } },
    { name: 'Policy exception', values: { fare: 1450, cabin: 'business', approvedSupplier: true, refundable: true } },
    { name: 'Verify supplier', values: { fare: 920, cabin: 'economy', approvedSupplier: false, refundable: true } },
  ],
};
export interface DecisionRequest {
  state: string;
  questions: {
    next_step: { type: 'choice'; instructions: string; criteria: Record<string, string> };
  };
}
export interface DecisionResult {
  source: 'local-simulation' | 'foundry' | 'application-gate';
  scenario: ScenarioId;
  scores: { key: string; label: string; probability: number; eligible: boolean }[];
  selected: string | null;
  selectedLabel: string;
  topScore: number;
  gap: number;
  needsReview: boolean;
  disposition: string;
  observations: string[];
  threshold: number;
}
export function validateInputs(inputs: Inputs, scenario: ScenarioId, threshold: number) {
  if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 0.99) {
    throw new Error('Review threshold must be between 50% and 99%.');
  }
  if (scenario === 'triage' && (!inputs.message.trim() || inputs.message.length > 2000)) {
    throw new Error('Enter a traveller message between 1 and 2,000 characters.');
  }
  if (scenario === 'shortlist') {
    if (!Number.isFinite(inputs.budget) || inputs.budget < 0 || inputs.budget > 10000) {
      throw new Error('Enter a shortlist budget between AUD 0 and AUD 10,000.');
    }
    if (![12, 14, 18].includes(inputs.arrivalBy)) throw new Error('Choose a valid arrival deadline.');
    if (!['balanced', 'price', 'flexibility'].includes(inputs.priority)) throw new Error('Choose a valid trip priority.');
  }
  if (scenario === 'readiness') {
    if (typeof inputs.approvedSupplier !== 'boolean' || typeof inputs.refundable !== 'boolean') {
      throw new Error('Supplier and refundable conditions must be boolean values.');
    }
    if (!Number.isFinite(inputs.fare) || inputs.fare <= 0 || inputs.fare > 100000) {
      throw new Error('Enter a proposed fare greater than AUD 0 and no more than AUD 100,000.');
    }
    if (!['economy', 'business'].includes(inputs.cabin)) throw new Error('Choose a valid cabin.');
  }
}
export function getScenario(id: ScenarioId): Scenario {
  const scenario = scenarios.find((item) => item.id === id);
  if (!scenario) throw new Error('Unknown decision scenario.');
  return scenario;
}
export function eligibleItineraries(inputs: Inputs) {
  return itineraries.filter((item) => item.price <= inputs.budget && item.arrival <= inputs.arrivalBy);
}
export function buildRequest(id: ScenarioId, inputs: Inputs): DecisionRequest {
  const scenario = getScenario(id);
  validateInputs(inputs, id, 0.8);
  let state: string;
  if (id === 'triage') state = inputs.message.trim();
  else if (id === 'shortlist') {
    const eligible = eligibleItineraries(inputs);
    if (!eligible.length) throw new Error('No eligible itinerary. Request human review instead of model scoring.');
    state = JSON.stringify({
      route: 'SYD to SIN', currency: 'AUD', synthetic: true,
      maximumFare: inputs.budget, arrivalByLocalHour: inputs.arrivalBy,
      priority: inputs.priority, candidates: eligible,
    });
  } else {
    state = JSON.stringify({
      synthetic: true, currency: 'AUD', fare: inputs.fare, cabin: inputs.cabin,
      approvedSupplier: inputs.approvedSupplier, refundable: inputs.refundable,
      policy: { maximumFare: 1000, cabin: 'economy', approvedSupplierRequired: true, refundableRequired: true },
    });
  }
  const eligible = new Set(eligibleItineraries(inputs).map((item) => item.key));
  return {
    state,
    questions: {
      next_step: {
        type: 'choice', instructions: scenario.question,
        criteria: Object.fromEntries(scenario.choices
          .filter((choice) => id !== 'shortlist' || eligible.has(choice.key))
          .map((choice) => [choice.key, `${choice.label}: ${choice.description}`])),
      },
    },
  };
}
export function simulate(id: ScenarioId, inputs: Inputs, threshold: number): DecisionResult {
  const scenario = getScenario(id);
  validateInputs(inputs, id, threshold);
  const weights: Record<string, number> = {};
  const observations: string[] = [];
  const eligible = new Set(id === 'shortlist'
    ? eligibleItineraries(inputs).map((item) => item.key)
    : scenario.choices.map((choice) => choice.key));

  if (id === 'triage') {
    const text = inputs.message.toLowerCase();
    const disrupted = /\b(cancelled|canceled|delayed|stranded|missed connection)\b/.test(text);
    const leisure = /\b(holiday|vacation|quote|honeymoon)\b/.test(text);
    const refund = /\b(refund|reimbursement)\b/.test(text);
    const support = /\b(account|password|login|receipt)\b/.test(text);
    Object.assign(weights, {
      disruption: disrupted ? 4.5 : 0,
      leisure: leisure ? 4.5 : 0,
      refunds: refund ? 4.5 : 0,
      support: support ? 4.5 : 0,
    });
    if (disrupted && refund) weights.disruption += 0.7;
    observations.push(disrupted ? 'A disruption keyword matched the synthetic routing rule.'
      : leisure ? 'A leisure keyword matched the synthetic routing rule.'
      : refund ? 'A refund keyword matched the synthetic routing rule.'
      : support ? 'An account-support keyword matched the synthetic routing rule.'
      : 'No specific routing keywords matched; the request is ambiguous.');
    observations.push('Keyword rules do not understand negation, context or urgency like a model might.');
  } else if (id === 'shortlist') {
    for (const item of itineraries) {
      weights[item.key] = inputs.priority === 'price'
        ? (1200 - item.price) / 100
        : inputs.priority === 'flexibility'
          ? (item.flexible ? 3 : 0) + (18 - item.arrival) / 2
          : (item.direct ? 3 : 0) + (item.flexible ? 2 : 0) - item.price / 100 + (18 - item.arrival) / 4;
    }
    observations.push(`${eligible.size} of 3 itineraries meet both the budget and arrival deadline.`);
    observations.push(`The local ranking uses the "${inputs.priority}" preference. No live inventory is checked.`);
  } else {
    const exception = inputs.fare > 1000 || inputs.cabin !== 'economy';
    const verification = !inputs.approvedSupplier || !inputs.refundable;
    Object.assign(weights, { ready: !exception && !verification ? 5 : 0, approval: exception ? 5 : 0, review: verification ? 6 : 0 });
    observations.push(inputs.fare > 1000 ? 'Fare exceeds the synthetic AUD 1,000 policy cap.' : 'Fare is within the synthetic AUD 1,000 policy cap.');
    if (inputs.cabin !== 'economy') observations.push('Business cabin requires manager approval under the synthetic policy.');
    if (!inputs.approvedSupplier) observations.push('Supplier is not verified against the synthetic approved list.');
    if (!inputs.refundable) observations.push('Non-refundable conditions require consultant verification.');
    if (!exception && !verification) observations.push('Economy cabin, approved supplier and refundable conditions pass the synthetic rules.');
  }
  const validWeights = scenario.choices.filter((choice) => eligible.has(choice.key)).map((choice) => weights[choice.key]);
  const max = Math.max(0, ...validWeights);
  const denominator = validWeights.reduce((sum, weight) => sum + Math.exp(weight - max), 0);
  const scores = scenario.choices.map((choice) => ({
    key: choice.key, label: choice.label, eligible: eligible.has(choice.key),
    probability: eligible.has(choice.key) ? Math.exp(weights[choice.key] - max) / denominator : 0,
  })).sort((a, b) => b.probability - a.probability);
  return finalizeDecision(id, inputs, threshold, scores, 'local-simulation', observations);
}

export function finalizeDecision(
  id: ScenarioId, inputs: Inputs, threshold: number, scores: DecisionResult['scores'],
  source: DecisionResult['source'], observations: string[],
): DecisionResult {
  validateInputs(inputs, id, threshold);
  const eligible = scores.filter((score) => score.eligible);
  const forcedReview = id === 'readiness' && (!inputs.approvedSupplier || !inputs.refundable);
  const mandatoryApproval = id === 'readiness' && (inputs.fare > 1000 || inputs.cabin !== 'economy');
  const top = scores.find((score) => score.eligible);
  const topScore = top?.probability ?? 0;
  const gap = topScore - (scores.filter((score) => score.eligible)[1]?.probability ?? 0);
  const needsReview = forcedReview || mandatoryApproval || topScore < threshold || gap < 0.1;
  let disposition = 'Recommendation only - consultant confirms';
  if (!eligible.length) disposition = 'Human review - no eligible itinerary';
  else if (forcedReview) disposition = mandatoryApproval ? 'Human review and manager approval required' : 'Human review - verify booking conditions';
  else if (mandatoryApproval) disposition = 'Manager approval required';
  else if (topScore < threshold) disposition = 'Human review - below score threshold';
  else if (gap < 0.1) disposition = 'Human review - options are too close';
  return {
    source, scenario: id, scores, selected: top?.key ?? null,
    selectedLabel: top?.label ?? 'No eligible itinerary', topScore, gap, needsReview,
    disposition, observations, threshold,
  };
}
