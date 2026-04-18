// Browser abstraction — real Playwright in production, mockable in tests.

export interface Clickable {
  role: string;
  label: string;
  selector: string;
  href?: string;
  kind: "link" | "button" | "input_submit" | "other";
}

export interface FormFieldInfo {
  name: string;
  type: string;
  required: boolean;
  placeholder?: string;
  selector: string;
}

export interface DomState {
  url: string;
  title: string;
  h1: string[];
  h2: string[];
  visible_text: string;
  clickables: Clickable[];
  forms: Array<{
    action?: string;
    selector: string;
    fields: FormFieldInfo[];
    submit_label?: string;
  }>;
  html_hash: string;
}

export interface BrowserPage {
  current(): Promise<DomState>;
  goto(url: string): Promise<void>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  submit(formSelector: string): Promise<void>;
  screenshot(filePath: string): Promise<void>;
  close(): Promise<void>;
}

export interface BrowserFactory {
  launchPage(startUrl: string): Promise<BrowserPage>;
}

// Real Playwright-backed factory — imported lazily so tests don't need
// the playwright install.
export async function createPlaywrightFactory(opts: {
  headless?: boolean;
  userAgent?: string;
  viewport?: { width: number; height: number };
}): Promise<BrowserFactory> {
  const pw = await import("playwright-core");
  const { chromium } = pw;
  const browser = await chromium.launch({ headless: opts.headless ?? true });
  return {
    async launchPage(startUrl: string): Promise<BrowserPage> {
      const context = await browser.newContext({
        userAgent: opts.userAgent ?? "TPM-Navigator/1.0",
        viewport: opts.viewport ?? { width: 1280, height: 900 },
      });
      const page = await context.newPage();
      await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });

      async function current(): Promise<DomState> {
        const snapshot = await page.evaluate(() => {
          const txt = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
          const h1 = Array.from(document.querySelectorAll("h1"))
            .map((e) => e.textContent?.trim() ?? "")
            .filter(Boolean);
          const h2 = Array.from(document.querySelectorAll("h2"))
            .map((e) => e.textContent?.trim() ?? "")
            .filter(Boolean);
          const clickables = Array.from(
            document.querySelectorAll("a, button, [role=button], input[type=submit]"),
          )
            .slice(0, 80)
            .map((el, idx) => {
              const e = el as HTMLElement;
              const rect = e.getBoundingClientRect();
              const visible = rect.width > 0 && rect.height > 0;
              if (!visible) return null;
              const tag = e.tagName.toLowerCase();
              const role = e.getAttribute("role") ?? tag;
              const label = (
                e.innerText ||
                e.getAttribute("aria-label") ||
                e.getAttribute("title") ||
                ""
              ).trim();
              if (!label || label.length > 60) return null;
              const selector = `[data-tpm-click-id="${idx}"]`;
              e.setAttribute("data-tpm-click-id", String(idx));
              const kind: "link" | "button" | "input_submit" | "other" =
                tag === "a"
                  ? "link"
                  : tag === "button"
                    ? "button"
                    : tag === "input"
                      ? "input_submit"
                      : "other";
              const out: {
                role: string;
                label: string;
                selector: string;
                href?: string;
                kind: typeof kind;
              } = {
                role,
                label,
                selector,
                kind,
              };
              const href = e.getAttribute("href");
              if (href) out.href = href;
              return out;
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
          const forms = Array.from(document.querySelectorAll("form"))
            .slice(0, 8)
            .map((form, i) => {
              form.setAttribute("data-tpm-form-id", String(i));
              const fields = Array.from(form.querySelectorAll("input, select, textarea"))
                .slice(0, 20)
                .map((ie, j) => {
                  const el = ie as HTMLInputElement;
                  el.setAttribute("data-tpm-field-id", String(i) + "-" + String(j));
                  return {
                    name: el.name || el.id || "",
                    type: (el.type || "text").toLowerCase(),
                    required: el.required,
                    placeholder: el.placeholder || undefined,
                    selector: `[data-tpm-field-id="${String(i)}-${String(j)}"]`,
                  };
                })
                .filter((f) => f.name);
              const submit = form.querySelector(
                "button[type=submit], input[type=submit], button:not([type])",
              );
              return {
                action: form.action || undefined,
                selector: `[data-tpm-form-id="${String(i)}"]`,
                fields,
                submit_label:
                  submit?.textContent?.trim() ||
                  (submit as HTMLInputElement | null)?.value ||
                  undefined,
              };
            });
          return { txt, h1, h2, clickables, forms, title: document.title };
        });
        const html = await page.content();
        // cheap hash
        let h = 0;
        for (let i = 0; i < html.length; i++) h = (h * 31 + html.charCodeAt(i)) & 0xffffffff;
        return {
          url: page.url(),
          title: snapshot.title,
          h1: snapshot.h1,
          h2: snapshot.h2,
          visible_text: snapshot.txt.slice(0, 4000),
          clickables: snapshot.clickables.map((c) => {
            const base: Clickable = {
              role: c.role,
              label: c.label,
              selector: c.selector,
              kind: c.kind,
            };
            if (c.href !== undefined) base.href = c.href;
            return base;
          }),
          forms: snapshot.forms.map((f) => {
            const fields: FormFieldInfo[] = f.fields.map((field) => {
              const out: FormFieldInfo = {
                name: field.name,
                type: field.type,
                required: field.required,
                selector: field.selector,
              };
              if (field.placeholder !== undefined) out.placeholder = field.placeholder;
              return out;
            });
            const formInfo: {
              action?: string;
              selector: string;
              fields: FormFieldInfo[];
              submit_label?: string;
            } = { selector: f.selector, fields };
            if (f.action !== undefined) formInfo.action = f.action;
            if (f.submit_label !== undefined) formInfo.submit_label = f.submit_label;
            return formInfo;
          }),
          html_hash: (h >>> 0).toString(16),
        };
      }

      return {
        current,
        async goto(url) {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        },
        async click(selector) {
          await page.click(selector, { timeout: 10_000 });
          await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
        },
        async fill(selector, value) {
          await page.fill(selector, value, { timeout: 10_000 });
        },
        async submit(formSelector) {
          await page.evaluate((sel: string) => {
            const form = document.querySelector(sel) as HTMLFormElement | null;
            form?.requestSubmit();
          }, formSelector);
          await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
        },
        async screenshot(filePath) {
          await page.screenshot({ path: filePath, fullPage: false });
        },
        async close() {
          await context.close();
        },
      };
    },
  };
}
