// Shared output validators used by the stage runner. These catch
// "schema-valid but useless" or "plain-text but degenerate" outputs
// that Zod cannot express.

export interface ValidationResult {
  ok: boolean;
  violations: string[];
}

export function isValidHtmlDocument(
  html: string,
  opts: { minChars?: number; mustContain?: string[] } = {},
): ValidationResult {
  const minChars = opts.minChars ?? 500;
  const violations: string[] = [];
  const h = (html ?? "").trim();
  if (h.length < minChars) {
    violations.push(`HTML too short (${h.length} < ${minChars} chars)`);
  }
  const lower = h.toLowerCase();
  if (!lower.includes("<!doctype html") && !lower.includes("<html")) {
    violations.push("HTML missing <!doctype html> and <html> markers");
  }
  if (!lower.includes("<body")) {
    violations.push("HTML missing <body> tag");
  }
  for (const needle of opts.mustContain ?? []) {
    if (!lower.includes(needle.toLowerCase())) {
      violations.push(`HTML missing required content: "${needle}"`);
    }
  }
  return { ok: violations.length === 0, violations };
}

export function hasRequiredSections(markdown: string, sections: string[]): ValidationResult {
  const violations: string[] = [];
  for (const section of sections) {
    // Match either ## or # at start of a line, followed by the section name.
    const re = new RegExp(`^#{1,3}\\s+${escapeRegExp(section)}\\b`, "mi");
    if (!re.test(markdown)) {
      violations.push(`Markdown missing required section "${section}"`);
    }
  }
  return { ok: violations.length === 0, violations };
}

export function minLength(text: string, minChars: number, label: string): ValidationResult {
  const t = (text ?? "").trim();
  if (t.length < minChars) {
    return { ok: false, violations: [`${label} too short (${t.length} < ${minChars} chars)`] };
  }
  return { ok: true, violations: [] };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function combine(...results: ValidationResult[]): ValidationResult {
  const violations = results.flatMap((r) => r.violations);
  return { ok: violations.length === 0, violations };
}
