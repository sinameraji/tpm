// Minimal D1-compatible adapter over better-sqlite3 for tests.
// Only implements the surface the backend uses: prepare().bind().first() and .run().
import Database, { type Database as Db } from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadInitSql(): string {
  const candidates = [
    path.resolve(HERE, "../../migrations/0001_init.sql"),
    path.resolve(HERE, "../migrations/0001_init.sql"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  throw new Error(`0001_init.sql not found near ${HERE}`);
}

function toArgs(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (typeof a === "boolean") return a ? 1 : 0;
    if (a === undefined) return null;
    return a;
  });
}

export class ShimStatement {
  constructor(
    private readonly db: Db,
    private readonly sql: string,
    private readonly boundArgs: unknown[] = [],
  ) {}
  bind(...args: unknown[]): ShimStatement {
    return new ShimStatement(this.db, this.sql, toArgs(args));
  }
  async first<T = unknown>(): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...this.boundArgs);
    return (row as T | undefined) ?? null;
  }
  async all<T = unknown>(): Promise<{ results: T[]; success: true }> {
    const stmt = this.db.prepare(this.sql);
    const results = stmt.all(...this.boundArgs) as T[];
    return { results, success: true };
  }
  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const stmt = this.db.prepare(this.sql);
    const info = stmt.run(...this.boundArgs);
    return { success: true, meta: { changes: info.changes } };
  }
}

export class ShimD1 {
  constructor(private readonly db: Db) {}
  prepare(sql: string): ShimStatement {
    return new ShimStatement(this.db, sql);
  }
}

export function makeD1(): { d1: ShimD1; raw: Db } {
  const db = new Database(":memory:");
  db.exec(loadInitSql());
  return { d1: new ShimD1(db), raw: db };
}

export class ShimKV {
  private readonly store = new Map<string, { value: string; expires?: number }>();
  async get(key: string): Promise<string | null> {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expires && Date.now() > hit.expires) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }
  async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
    const expires = opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined;
    const entry: { value: string; expires?: number } = expires ? { value, expires } : { value };
    this.store.set(key, entry);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async list(): Promise<{ keys: Array<{ name: string }> }> {
    return { keys: Array.from(this.store.keys()).map((name) => ({ name })) };
  }
}

export const STUB_JWT_SECRET = "test-secret-" + "x".repeat(40);

export function baseEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DB: null,
    SESSIONS: new ShimKV(),
    RATE_LIMITS: new ShimKV(),
    ARTIFACTS: null,
    AI: null,
    JWT_SECRET: STUB_JWT_SECRET,
    TPM_API_VERSION: "v1",
    ENV: "test",
    ...overrides,
  };
}

export function mockCtx(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}
