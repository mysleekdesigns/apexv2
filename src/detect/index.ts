import type { StackDetection } from "../types/shared.js";
import { detectLanguage } from "./language.js";
import { detectFrameworks } from "./framework.js";
import { detectPackageManager } from "./packageManager.js";
import { detectTestRunner } from "./testRunner.js";
import { detectLintFormat } from "./lint.js";
import { detectCi } from "./ci.js";

export async function detect(root: string): Promise<StackDetection> {
  const lang = await detectLanguage(root);
  const [frameworks, pm, testRunner, lintFormat, ci] = await Promise.all([
    detectFrameworks(root, lang.language),
    detectPackageManager(root, lang.language),
    detectTestRunner(root, lang.language),
    detectLintFormat(root, lang.language),
    detectCi(root),
  ]);

  return {
    language: lang.language,
    frameworks,
    packageManager: pm,
    testRunner,
    lint: lintFormat.lint,
    format: lintFormat.format,
    ci,
    hasTypeScript: lang.hasTypeScript,
    rawSignals: lang.signals,
  };
}
