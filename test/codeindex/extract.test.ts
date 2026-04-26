import { describe, it, expect } from "vitest";
import { extractSymbolsFromText } from "../../src/codeindex/extract.js";

describe("extractSymbolsFromText", () => {
  it("extracts TS functions, classes, methods, types and interfaces", async () => {
    const src = `
export interface Req { id: string }
export type Res = { ok: boolean };
export function handle(r: Req): Res { return { ok: true }; }
function internalHelper() { return 1; }
export class Service {
  run(): void {}
  private hidden(): void {}
}
const x = 1;
export const Y = 2;
`;
    const symbols = await extractSymbolsFromText("a.ts", src, "ts");
    const byName = Object.fromEntries(symbols.map((s) => [s.symbol, s]));

    expect(byName["Req"]).toMatchObject({ kind: "interface", exported: true });
    expect(byName["Res"]).toMatchObject({ kind: "type", exported: true });
    expect(byName["handle"]).toMatchObject({ kind: "function", exported: true });
    expect(byName["internalHelper"]).toMatchObject({ kind: "function", exported: false });
    expect(byName["Service"]).toMatchObject({ kind: "class", exported: true });
    expect(byName["run"]).toMatchObject({ kind: "method" });
    expect(byName["x"]).toMatchObject({ kind: "const", exported: false });
    expect(byName["Y"]).toMatchObject({ kind: "const", exported: true });

    const handle = byName["handle"];
    expect(handle).toBeDefined();
    expect(handle!.line).toBeGreaterThan(0);
    expect(handle!.end_line).toBeGreaterThanOrEqual(handle!.line);
  });

  it("extracts JS exports and methods", async () => {
    const src = `
export function slugify(s) { return s.toLowerCase(); }
function helper() {}
export class Builder {
  push(x) {}
  build() { return ""; }
}
export const PI = 3.14;
`;
    const symbols = await extractSymbolsFromText("u.js", src, "js");
    const names = symbols.map((s) => s.symbol).sort();
    expect(names).toContain("slugify");
    expect(names).toContain("helper");
    expect(names).toContain("Builder");
    expect(names).toContain("push");
    expect(names).toContain("build");
    expect(names).toContain("PI");

    const slugify = symbols.find((s) => s.symbol === "slugify");
    expect(slugify?.exported).toBe(true);
    const helper = symbols.find((s) => s.symbol === "helper");
    expect(helper?.exported).toBe(false);
  });

  it("extracts Python functions, classes, and methods", async () => {
    const src = `def hash_password(p):
    return p

def _internal(s):
    return s

class LoginService:
    def __init__(self, secret):
        self.secret = secret
    def verify(self, t):
        return True
    def _private(self):
        return self.secret

PUBLIC = "x"
`;
    const symbols = await extractSymbolsFromText("a.py", src, "py");
    const byName = Object.fromEntries(symbols.map((s) => [s.symbol, s]));

    expect(byName["hash_password"]).toMatchObject({ kind: "function", exported: true });
    expect(byName["_internal"]).toMatchObject({ kind: "function", exported: false });
    expect(byName["LoginService"]).toMatchObject({ kind: "class", exported: true });
    expect(byName["verify"]).toMatchObject({ kind: "method" });
    expect(byName["_private"]).toMatchObject({ kind: "method" });
  });

  it("captures correct line numbers", async () => {
    const src = `// line 1
// line 2
export function foo() {
  return 1;
}
`;
    const symbols = await extractSymbolsFromText("a.ts", src, "ts");
    const foo = symbols.find((s) => s.symbol === "foo");
    expect(foo).toBeDefined();
    expect(foo!.line).toBe(3);
  });
});
