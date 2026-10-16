import {
  buildRequest, eligibleItineraries, finalizeDecision, getScenario, type DecisionRequest, type DecisionResult,
  type Inputs, type ScenarioId,
} from './decision';

export interface FoundryConfig { endpoint: string; deployment: string; auth: 'Azure CLI / Entra ID' }
export type ModelRequest = DecisionRequest & { model: string };
export interface FoundryResponse {
  model: string;
  answers: {
    next_step: { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number };
  };
  usage?: { input_tokens: number; output_tokens: number };
}
export interface DecisionExchange {
  request: ModelRequest | null;
  response: FoundryResponse | null;
  result: DecisionResult;
  durationMs: number;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function shortlistGate(id: ScenarioId, inputs: Inputs, threshold: number): DecisionResult | null {
  if (id !== 'shortlist') return null;
  const eligible = eligibleItineraries(inputs);
  if (eligible.length >= 2) return null;
  const result = finalizeDecision(id, inputs, threshold, getScenario(id).choices.map((choice) => ({
    key: choice.key, label: choice.label, eligible: eligible.some((item) => item.key === choice.key), probability: 0,
  })).sort((a, b) => Number(b.eligible) - Number(a.eligible)), 'application-gate', [
    eligible.length ? 'Only one eligible itinerary; Decision-1 requires at least two choices. No inference call or model probability.'
      : 'No eligible itinerary; application blocked the model call.',
  ]);
  if (eligible.length) result.disposition = 'Human review - only one eligible itinerary; no model scoring';
  return result;
}
function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
export function readFoundryResponse(value: unknown, request: ModelRequest): FoundryResponse {
  if (!isRecord(value) || typeof value.model !== 'string' || !value.model.trim()
    || !isRecord(value.answers) || !isRecord(value.answers.next_step)) {
    throw new Error('Foundry returned an invalid decision response.');
  }
  const answer = value.answers.next_step;
  const expected = Object.keys(request.questions.next_step.criteria);
  if (answer.type !== 'choice' || typeof answer.choice !== 'string' || !expected.includes(answer.choice)
    || !isRecord(answer.probabilities)) {
    throw new Error('Foundry returned an unsupported choice or probability structure.');
  }
  const probabilities: Record<string, number> = {};
  for (const key of expected) {
    const score = answer.probabilities[key];
    if (!probability(score)) throw new Error('Foundry returned missing or invalid option probabilities.');
    probabilities[key] = score;
  }
  if (Object.keys(answer.probabilities).length !== expected.length
    || Math.abs(Object.values(probabilities).reduce((sum, score) => sum + score, 0) - 1) > 0.01
    || probabilities[answer.choice] < Math.max(...Object.values(probabilities))) {
    throw new Error('Foundry probabilities do not match the requested choice set or selected option.');
  }
  if (answer.confidence !== undefined && !probability(answer.confidence)) {
    throw new Error('Foundry returned invalid confidence.');
  }
  const response: FoundryResponse = {
    model: value.model,
    answers: { next_step: {
      type: 'choice', choice: answer.choice, probabilities,
      ...(answer.confidence !== undefined ? { confidence: answer.confidence } : {}),
    } },
  };
  if (value.usage !== undefined) {
    if (!isRecord(value.usage) || !Number.isInteger(value.usage.input_tokens)
      || !Number.isInteger(value.usage.output_tokens)
      || typeof value.usage.input_tokens !== 'number' || value.usage.input_tokens < 0
      || typeof value.usage.output_tokens !== 'number' || value.usage.output_tokens < 0) {
      throw new Error('Foundry returned invalid token usage.');
    }
    response.usage = { input_tokens: value.usage.input_tokens, output_tokens: value.usage.output_tokens };
  }
  return response;
}
export function modelDecision(
  id: ScenarioId, inputs: Inputs, threshold: number, response: FoundryResponse,
): DecisionResult {
  const request = buildRequest(id, inputs);
  const scores = getScenario(id).choices.map((choice) => ({
    key: choice.key, label: choice.label,
    eligible: Object.hasOwn(request.questions.next_step.criteria, choice.key),
    probability: response.answers.next_step.probabilities[choice.key] ?? 0,
  })).sort((a, b) => b.probability - a.probability
    || Number(b.key === response.answers.next_step.choice) - Number(a.key === response.answers.next_step.choice));
  const observations = ['Scores came from Foundry Decision-1; review thresholds and policy gates are application rules.'];
  if (id === 'shortlist') observations.push('Only itineraries within both budget and arrival constraints were sent for scoring.');
  if (id === 'readiness') {
    if (inputs.fare > 1000 || inputs.cabin !== 'economy') observations.push('Fare or cabin exception requires manager approval, regardless of model selection.');
    if (!inputs.approvedSupplier || !inputs.refundable) observations.push('Supplier or fare conditions require consultant verification, regardless of model selection.');
  }
  return finalizeDecision(id, inputs, threshold, scores, 'foundry', observations);
}

export async function runFoundry(
  scenario: ScenarioId, inputs: Inputs, threshold: number, signal: AbortSignal,
): Promise<DecisionExchange> {
  const response = await fetch('/api/decision', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario, inputs, threshold }), signal,
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(isRecord(body) && typeof body.error === 'string' ? body.error : `Decision adapter returned HTTP ${response.status}.`);
  }
  if (!isRecord(body) || !isRecord(body.result) || typeof body.durationMs !== 'number' || !Number.isFinite(body.durationMs)) {
    throw new Error('The decision adapter returned an invalid exchange.');
  }
  if (body.request === null && body.response === null && scenario === 'shortlist'
    && body.result.source === 'application-gate') {
    const result = shortlistGate(scenario, inputs, threshold);
    if (!result) throw new Error('The adapter unexpectedly blocked eligible itineraries.');
    return {
      request: null, response: null, durationMs: body.durationMs, result,
    };
  }
  if (!isRecord(body.request) || typeof body.request.model !== 'string') throw new Error('The adapter returned no model request.');
  const request = { model: body.request.model, ...buildRequest(scenario, inputs) };
  const validated = readFoundryResponse(body.response, request);
  return { request, response: validated, result: modelDecision(scenario, inputs, threshold, validated), durationMs: body.durationMs };
}
