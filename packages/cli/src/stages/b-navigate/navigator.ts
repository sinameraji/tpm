import { z } from "zod";
import type { BrowserPage, DomState } from "./browser.js";
import type { ModelGateway } from "../../gateway/index.js";
import type { CompleteOptionsExt } from "../../gateway/workers-ai.js";
import type { Logger } from "../../core/logger.js";
import {
  FrictionFlag,
  type Decision,
  type PersonaPath,
  type Step,
} from "@tpm/shared/schemas/paths";
import { buildNavigatorUserPrompt, fillSystemPrompt } from "./prompt.js";

export const NAVIGATOR_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

export interface PersonaBriefing {
  persona: string; // segment_id
  actor: string;
  job: string;
  trigger: string;
  successCriterion: string;
  valueMoment: string;
  uvp: string;
}

export interface NavigateDeps {
  gateway: ModelGateway;
  logger: Logger;
  auditId: string;
  sessionId: string;
  stepBudget?: number;
  testCredsNote?: string | null;
}

const DecisionModelResponse = z.object({
  observation_summary: z.string(),
  decision: z.enum([
    "click",
    "fill_form",
    "navigate",
    "scroll",
    "wait",
    "go_back",
    "stuck",
    "value_reached",
  ]),
  target: z.string().nullable(),
  fill_values: z.record(z.string(), z.string()).optional(),
  reasoning: z.string(),
  value_moment_reached: z.boolean(),
  friction_flags: z.array(FrictionFlag).default([]),
});

function stripCodeFences(raw: string): string {
  const m = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/m.exec(raw.trim());
  return m?.[1]?.trim() ?? raw.trim();
}

type DecisionJson = z.infer<typeof DecisionModelResponse>;

export async function askNavigatorForStep(
  briefing: PersonaBriefing,
  stepsRemaining: number,
  dom: DomState,
  priorSteps: Array<{ url: string; decision: string; target: string | null }>,
  deps: NavigateDeps,
): Promise<DecisionJson> {
  const systemPrompt = fillSystemPrompt(briefing);
  const userPrompt = buildNavigatorUserPrompt({
    actor: briefing.actor,
    job: briefing.job,
    trigger: briefing.trigger,
    successCriterion: briefing.successCriterion,
    valueMoment: briefing.valueMoment,
    stepsRemaining,
    priorSteps,
    dom,
    intendedUvp: briefing.uvp,
    testCredsNote: deps.testCredsNote ?? null,
  });

  const opts: CompleteOptionsExt = {
    temperature: 0.2,
    responseFormat: "json",
    auditId: deps.auditId,
    sessionId: deps.sessionId,
    stage: "B",
    maxTokens: 1200,
  };

  const completion = await deps.gateway.complete(
    NAVIGATOR_MODEL,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    opts,
  );

  const raw = stripCodeFences(completion.text);
  const parsed = JSON.parse(raw) as unknown;
  return DecisionModelResponse.parse(parsed);
}

export interface RunNavigatorOptions extends NavigateDeps {
  entryPoint: string;
  page: BrowserPage;
}

function detectCycle(
  urlSeen: Map<string, number>,
  currentUrl: string,
  currentHtmlHash: string,
  domSeen: Map<string, number>,
): boolean {
  const urlCount = urlSeen.get(currentUrl) ?? 0;
  const domCount = domSeen.get(currentHtmlHash) ?? 0;
  urlSeen.set(currentUrl, urlCount + 1);
  domSeen.set(currentHtmlHash, domCount + 1);
  return urlCount + 1 >= 3 && domCount + 1 >= 3;
}

export async function runNavigatorForPersona(
  briefing: PersonaBriefing,
  opts: RunNavigatorOptions,
): Promise<PersonaPath> {
  const stepBudget = opts.stepBudget ?? 25;
  const startedAt = new Date();
  const steps: Step[] = [];
  const priorForPrompt: Array<{ url: string; decision: string; target: string | null }> = [];
  const urlSeen = new Map<string, number>();
  const domSeen = new Map<string, number>();
  let valueReached = false;
  let stuckReason: string | null = null;
  let stuckAtStep: number | null = null;
  let loopClosed = false;
  let outcomeStatus: PersonaPath["outcome"]["status"] = "step_budget_exhausted";

  for (let n = 1; n <= stepBudget; n++) {
    const dom = await opts.page.current();
    if (detectCycle(urlSeen, dom.url, dom.html_hash, domSeen)) {
      outcomeStatus = "cycle_detected";
      stuckReason = "navigator has revisited the same URL+DOM state 3 times";
      stuckAtStep = n;
      steps.push({
        n,
        url: dom.url,
        observation_summary: "Detected cycle: same URL+DOM state revisited repeatedly",
        decision: "stuck",
        target: null,
        reasoning: stuckReason,
        value_moment_reached: false,
        friction_flags: [{ type: "cycle_detected", detail: `url=${dom.url}` }],
      });
      break;
    }

    let decision: DecisionJson;
    try {
      decision = await askNavigatorForStep(briefing, stepBudget - n + 1, dom, priorForPrompt, opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.logger.warn(
        { stage: "B", step: n, err: msg },
        "navigator decision failed; marking stuck",
      );
      outcomeStatus = "error";
      stuckReason = `navigator error: ${msg}`;
      stuckAtStep = n;
      steps.push({
        n,
        url: dom.url,
        observation_summary: "Navigator decision call failed",
        decision: "stuck",
        target: null,
        reasoning: stuckReason,
        value_moment_reached: false,
        friction_flags: [],
        action_error: msg,
      });
      break;
    }

    // Record the step BEFORE execution so we capture intent even on action failure.
    const pre: Step = {
      n,
      url: dom.url,
      observation_summary: decision.observation_summary,
      decision: decision.decision as Decision,
      target: decision.target ?? null,
      reasoning: decision.reasoning,
      value_moment_reached: decision.value_moment_reached,
      friction_flags: decision.friction_flags,
    };

    if (decision.value_moment_reached || decision.decision === "value_reached") {
      valueReached = true;
      outcomeStatus = "value_reached";
      loopClosed = true;
      steps.push(pre);
      break;
    }

    if (decision.decision === "stuck") {
      outcomeStatus = "stuck";
      stuckReason = decision.reasoning;
      stuckAtStep = n;
      steps.push(pre);
      break;
    }

    try {
      if (decision.decision === "click" && decision.target) {
        await opts.page.click(decision.target);
      } else if (decision.decision === "navigate" && decision.target) {
        await opts.page.goto(decision.target);
      } else if (decision.decision === "fill_form" && decision.target) {
        const values = decision.fill_values ?? {};
        for (const [sel, val] of Object.entries(values)) {
          await opts.page.fill(sel, val);
        }
        await opts.page.submit(decision.target);
      } else if (decision.decision === "scroll") {
        // scrolling — no-op; real impl could scroll the page
      } else if (decision.decision === "wait") {
        await new Promise((r) => setTimeout(r, 1500));
      } else if (decision.decision === "go_back") {
        // go back via navigation — best-effort
        await opts.page.goto(opts.entryPoint);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pre.action_error = msg;
      opts.logger.warn(
        { stage: "B", step: n, err: msg, decision: decision.decision },
        "action failed",
      );
    }

    steps.push(pre);
    priorForPrompt.push({
      url: dom.url,
      decision: decision.decision,
      target: decision.target ?? null,
    });
  }

  const endedAt = new Date();
  const timeToValue = valueReached ? endedAt.getTime() - startedAt.getTime() : null;

  return {
    persona: briefing.persona,
    goal: briefing.job,
    value_moment_target: briefing.valueMoment,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    step_budget: stepBudget,
    steps_taken: steps.length,
    entry_point: opts.entryPoint,
    steps,
    outcome: {
      status: outcomeStatus,
      loop_closed: loopClosed,
      value_moment_reached: valueReached,
      time_to_value_ms: timeToValue,
      stuck_at_step: stuckAtStep,
      stuck_reason: stuckReason,
    },
  };
}
