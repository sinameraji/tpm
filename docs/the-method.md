# The TPM Method

TPM's differentiation isn't "AI looks at your app and gives feedback." It's a deterministic six-stage analytical pipeline that separates **intent** from **execution** and finds the highest-leverage gaps between them. Each stage has a defined input, a defined output schema, and a specific model call.

## Stage A — Intent Extraction → `lean-canvas.yaml`

Reconstruct the Lean Canvas from the codebase and the deployed marketing surfaces. Make implicit intent explicit. Derive: intended JTBD per segment, intended value moment per persona, intended critical path per persona.

**Rule:** every claim cites evidence + a calibrated confidence score. Empty arrays are fine when evidence is absent. Don't invent.

## Stage B — Observed Critical Path → `paths.yaml`

For each persona, run a browser navigator (Playwright + `qwen3-30b-a3b-fp8`) through the live product. 25-step budget. Record every step with observation, decision, target, reasoning, and `friction_flags[]` chosen from a fixed 12-value enum:

```
premature_data_collection  required_without_rationale
blank_page_anxiety         forced_tour
configuration_theater      verification_before_value
intent_mismatch            dead_end
fork_without_signal        cycle_detected
orphan_state               missing_affordance
```

## Stage C — Delta Analysis → `delta.yaml`

Compare intent to reality. Every step gets classified against a fixed 7-value taxonomy:

```
necessary | cuttable | cuttable_with_care |
intentional_friction_working | intentional_friction_broken |
cargo_culted | broken
```

For every required step, explicitly answer the **necessity test**: "If I skipped this, what would break later?" Three answers:

1. "Something concrete breaks" → `necessary`
2. "Nothing breaks; a sensible default would be fine" → `cuttable`
3. "A softer version could exist post-value-moment" → `cuttable_with_care`

**The intentional-vs-uneducated distinction** is where TPM beats naive auditors. Friction is _working_ when surrounding copy explains it in user-benefit terms, invites agency, has a visible payoff later, and filters for fit when fit matters. Friction is _uneducated_ when it's demanded without explanation, uses "help us serve you better" business-speak, or when selections don't affect the experience.

## Stage D — Leverage Prioritization → `problems.yaml`

Rank problems by leverage. **Not a formula** — a structured argument per problem:

> "This is rank N because: [severity] × [reach] × [funnel position] × [blast radius] relative to [effort]. Fixing it unblocks [list]. The next priority is lower because: [delta]."

Guardrails:

- Value-moment-unreachable problems dominate before any smaller issue.
- Entry > activation > first_value > retention_loop at equal severity.
- Broken > cuttable > cuttable_with_care > intentional_friction_broken > cargo_culted.
- Intent mismatches against the primary promise outrank other findings.
- Effort is a tie-breaker, not a primary axis.

## Stage E — Solution Specs + Prototypes → `solutions.yaml` + `prototypes/*.html`

For each top-5 problem: a concrete specific change, why it's the right fix, what it unblocks, implementation outline, effort, risks with mitigations, success metric (quantified + measurement window), and a single-file annotated HTML prototype.

## Stage F — Artifact Assembly → `spec.md` + `spec.pdf`

Executive Summary → Intended Product → Observed Reality → The Delta → Top Problems → Recommended Actions → Methodology Appendix.

## Why this is defensible IP

The method's fixed enums, classification taxonomies, necessity test, leverage-argument form, and the intentional-vs-uneducated distinction are the **product**. Any model change (Cloudflare swaps gpt-oss-120b for something new next year) preserves the method. Audit outputs stay comparable across runs and across models because the schema is the contract.
