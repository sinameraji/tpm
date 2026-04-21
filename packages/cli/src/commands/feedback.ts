import type { Command } from "commander";
import { bootstrap, emit, emitText } from "./_runtime.js";

// Stub command per the v1.2.0 plan. Closes the UX loop referenced in
// the audit completion block ("How was this audit? tpm feedback")
// without requiring a real feedback sink. v1.3.0 decision to build
// something richer if the traffic justifies it.
//
// Explicitly non-automatic: we tell the user nothing is sent unless
// they hit enter on the issue form themselves.

const MESSAGE = `We want to hear how PM worked for you.

  Open an issue:  https://github.com/sinameraji/tpm/issues/new

If you include your spec.md (or the parts you're willing to share),
we can debug specific audits. No data is sent automatically.`;

export function register(program: Command): void {
  program
    .command("feedback")
    .description("How to send feedback about a PM audit.")
    .action(async function action(this: Command) {
      const runtime = bootstrap(this);
      emitText(runtime, MESSAGE);
      emit(runtime, {
        ok: true,
        issues_url: "https://github.com/sinameraji/tpm/issues/new",
      });
    });
}
