# Authoring Patterns

Patterns are curated knowledge that PM uses in Stage C (delta analysis) to recognize recurring friction modes. The built-in library ships with the CLI (`packages/cli/src/patterns/built-in.yaml`). In v2, projects and orgs will add their own.

## Anatomy of a good pattern

```yaml
- id: demo_gate_on_self_serve_product
  title: "Demo-only entry for a product that could run self-serve"
  category: entry
  body:
    summary: "Every top-level CTA routes to 'Book a demo.' No trial or self-serve path."
    works_when:
      - "Product literally cannot run without infrastructure setup by a human."
      - "The buyer and user are different people (enterprise procurement)."
    fails_when:
      - "The product has a templates system, sample data, or sandbox that is hidden from pre-auth users."
      - "Competitors in the same category do offer self-serve."
    exemplars_good:
      - "Databricks before their free-tier launch — infrastructure genuinely needed setup."
    exemplars_bad:
      - "Any no-code / workflow / analytics product where the templates and sandbox exist in the codebase but aren't surfaced."
    detection_signals:
      - "All primary CTAs route to /demo, /contact, /book, or a calendar URL."
      - "Codebase has a templates route but it's behind auth."
      - "No /signup, /trial, or /free route exists."
    recommendation: "Add a self-serve path with pre-populated templates. Keep demo as a secondary CTA for enterprise."
```

## What makes a pattern worth including

1. **It's a real recurring mode**, not a one-off product choice. If you've seen it in at least 3 different products, it's a pattern.
2. **`works_when` is non-empty**. The best patterns document where the anti-pattern is actually the right move. This is the intentional-vs-uneducated distinction. If `works_when: []`, say so explicitly ("never — always fails").
3. **Detection signals are concrete**, not interpretive. "All primary CTAs route to /demo" is concrete; "feels enterprise-y" is not.
4. **Exemplars name real products** when possible. Generic "some SaaS" is fine but named products are stronger because they resist challenge.
5. **Recommendation is a forward action**, not a diagnosis. "Remove the form" is a recommendation; "they shouldn't be collecting use case" is not.

## Categories

See `packages/shared/src/schemas/patterns.ts` for the fixed enum. Add a new category only when existing ones genuinely don't fit. New categories need a schema migration.

## Testing a new pattern

After adding to `built-in.yaml`:

```bash
pnpm --filter @tpm/cli test  # loader tests enforce uniqueness + required fields
```

Then re-run an audit with `--resume-from C` on an existing `paths.yaml` and verify Stage C matches the pattern correctly.

## Anti-patterns in pattern-authoring

- Vague summaries ("has confusing UX").
- Works_when full of "never" — if the pattern is always wrong, you probably haven't found the `works_when` case yet.
- Detection signals that require human interpretation ("feels off").
- Lists longer than 5 items per field — if you need more, you're conflating patterns.
