import { describe, expect, it } from 'vitest';
import {
  buildRequest, defaultInputs, getScenario, presets, scenarios, simulate, type Inputs,
} from './decision';

const input = (patch: Partial<Inputs> = {}): Inputs => ({ ...defaultInputs, ...patch });

describe('disruption triage', () => {
  it.each([
    ['My flight was cancelled.', 'disruption'],
    ['Our flight is delayed.', 'disruption'],
    ['Please quote a holiday.', 'leisure'],
    ['Where is my refund?', 'refunds'],
    ['I cannot access my account.', 'support'],
  ])('routes "%s" to %s using explicit demo rules', (message, selected) => {
    const result = simulate('triage', input({ message }), 0.8);
    expect(result.selected).toBe(selected);
    expect(result.needsReview).toBe(false);
    expect(result.source).toBe('local-simulation');
  });

  it('requires review for an unclear request', () => {
    const result = simulate('triage', input({ message: 'Can you help?' }), 0.8);
    expect(result.needsReview).toBe(true);
    expect(result.topScore).toBe(0.25);
  });

  it('requires review for close options even when the threshold passes', () => {
    const result = simulate('triage', input({ message: 'Please quote a holiday and check a refund' }), 0.5);
    expect(result.gap).toBeLessThan(0.1);
    expect(result.needsReview).toBe(true);
  });

  it('changes disposition when the review threshold exceeds the top score', () => {
    const result = simulate('triage', input(), 0.99);
    expect(result.topScore).toBeLessThan(0.99);
    expect(result.needsReview).toBe(true);
    expect(result.disposition).toContain('below score threshold');
  });

  it.each(['', '   ', 'a'.repeat(2001)])('rejects invalid message lengths', (message) => {
    expect(() => simulate('triage', input({ message }), 0.8)).toThrow('traveller message');
    expect(() => buildRequest('triage', input({ message }))).toThrow('traveller message');
  });
});

describe('trip shortlist', () => {
  it('selects the direct balanced option without unnecessary review', () => {
    const result = simulate('shortlist', input(), 0.8);
    expect(result.selected).toBe('direct');
    expect(result.needsReview).toBe(false);
  });

  it('changes the selection with the preference', () => {
    expect(simulate('shortlist', input({ priority: 'price' }), 0.8).selected).toBe('saver');
    expect(simulate('shortlist', input({ priority: 'flexibility' }), 0.8).selected).toBe('flex');
  });

  it('enforces budget and arrival constraints before scoring', () => {
    const values = input({ budget: 1000, arrivalBy: 14, priority: 'price' });
    const result = simulate('shortlist', values, 0.8);
    expect(result.selected).toBe('direct');
    expect(result.topScore).toBe(1);
    expect(result.scores.filter((item) => !item.eligible).every((item) => item.probability === 0)).toBe(true);
    expect(Object.keys(buildRequest('shortlist', values).questions.next_step.criteria)).toEqual(['direct']);
  });

  it('accepts exact budget and arrival boundaries', () => {
    const result = simulate('shortlist', input({ budget: 920, arrivalBy: 14 }), 0.8);
    expect(result.selected).toBe('direct');
  });

  it('does not fabricate an option when none is eligible', () => {
    const values = input({ budget: 500 });
    const result = simulate('shortlist', values, 0.5);
    expect(result.selected).toBeNull();
    expect(result.topScore).toBe(0);
    expect(result.needsReview).toBe(true);
    expect(result.scores.every((score) => score.probability === 0)).toBe(true);
    expect(() => buildRequest('shortlist', values)).toThrow('No eligible itinerary');
  });

  it.each([NaN, Infinity, -1, 10001])('rejects invalid budget %s', (budget) => {
    expect(() => simulate('shortlist', input({ budget }), 0.8)).toThrow('shortlist budget');
  });
});

describe('booking readiness gates', () => {
  it('marks a compliant proposal as ready for a consultant, not booked', () => {
    const result = simulate('readiness', input(), 0.8);
    expect(result.selected).toBe('ready');
    expect(result.needsReview).toBe(false);
    expect(result.disposition).toContain('consultant confirms');
  });

  it.each([{ fare: 1000.01 }, { cabin: 'business' as const }])('always requires approval for a policy exception', (patch) => {
    const result = simulate('readiness', input(patch), 0.5);
    expect(result.selected).toBe('approval');
    expect(result.topScore).toBeGreaterThan(0.9);
    expect(result.needsReview).toBe(true);
    expect(result.disposition).toBe('Manager approval required');
  });

  it('accepts the exact policy cap', () => {
    expect(simulate('readiness', input({ fare: 1000 }), 0.8).selected).toBe('ready');
  });

  it.each([{ approvedSupplier: false }, { refundable: false }])('requires verification despite a high score', (patch) => {
    const result = simulate('readiness', input(patch), 0.5);
    expect(result.selected).toBe('review');
    expect(result.needsReview).toBe(true);
  });

  it('preserves both verification and manager approval', () => {
    const result = simulate('readiness', input({ fare: 1450, approvedSupplier: false }), 0.5);
    expect(result.disposition).toBe('Human review and manager approval required');
  });

  it.each([NaN, Infinity, -10, 0, 100001])('rejects invalid fare %s', (fare) => {
    expect(() => simulate('readiness', input({ fare }), 0.8)).toThrow('proposed fare');
  });
});

describe('shared decision contract', () => {
  it.each([0.49, 1, NaN, Infinity])('rejects invalid threshold %s', (threshold) => {
    expect(() => simulate('triage', input(), threshold)).toThrow('Review threshold');
  });

  it('treats the threshold as inclusive', () => {
    const first = simulate('triage', input(), 0.8);
    expect(simulate('triage', input(), first.topScore).needsReview).toBe(false);
    expect(simulate('triage', input(), first.topScore + 0.001).needsReview).toBe(true);
  });

  it('uses documented choice request keys without pretending to be a response', () => {
    const request = buildRequest('triage', input());
    expect(request.state).toBe(defaultInputs.message);
    expect(request.questions.next_step.type).toBe('choice');
    expect(Object.keys(request.questions.next_step.criteria)).toEqual(['disruption', 'leisure', 'refunds', 'support']);
    expect(Object.keys(request)).toEqual(['state', 'questions']);
  });

  for (const scenario of scenarios) {
    for (const preset of presets[scenario.id]) {
      it(`${scenario.id}/${preset.name} has finite normalized deterministic scores`, () => {
        const values = input(preset.values);
        const result = simulate(scenario.id, values, 0.8);
        expect(result).toEqual(simulate(scenario.id, values, 0.8));
        expect(result.scores.every((score) => Number.isFinite(score.probability) && score.probability >= 0 && score.probability <= 1)).toBe(true);
        const sum = result.scores.reduce((total, score) => total + score.probability, 0);
        expect(sum).toBeCloseTo(result.selected === null ? 0 : 1, 12);
        expect(values).toEqual(input(preset.values));
        expect(result.scores.map((score) => score.key).sort()).toEqual(getScenario(scenario.id).choices.map((choice) => choice.key).sort());
      });
    }
  }
});
