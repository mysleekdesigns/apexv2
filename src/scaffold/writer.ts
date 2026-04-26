import path from "node:path";
import fs from "fs-extra";
import {
  spliceMarkdownManaged,
  spliceGitignoreManaged,
  spliceSettingsHooks,
  spliceMcpServers,
} from "./managedSection.js";

export type WriteAction =
  | "created"
  | "replaced"
  | "merged"
  | "skipped-existing"
  | "skipped-missing-template"
  | "would-create"
  | "would-replace"
  | "would-merge"
  | "would-skip";

export interface WriteRecord {
  path: string;
  action: WriteAction;
  bytes?: number;
  note?: string;
}

export interface WriterOptions {
  dryRun: boolean;
  /** When true, executable bit is set on the file (chmod 755). */
  executable?: boolean;
}

export class Writer {
  readonly records: WriteRecord[] = [];
  readonly dryRun: boolean;

  constructor(opts: { dryRun: boolean }) {
    this.dryRun = opts.dryRun;
  }

  /** Write a fully-owned APEX file (overwrites unconditionally on upgrade). */
  async writeOwned(filePath: string, content: string, opts: WriterOptions = { dryRun: this.dryRun }): Promise<void> {
    const exists = await fs.pathExists(filePath);
    const action: WriteAction = this.dryRun
      ? exists
        ? "would-replace"
        : "would-create"
      : exists
      ? "replaced"
      : "created";
    if (!this.dryRun) {
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, content, "utf8");
      if (opts.executable) await fs.chmod(filePath, 0o755);
    }
    this.records.push({
      path: filePath,
      action,
      bytes: Buffer.byteLength(content, "utf8"),
    });
  }

  /** Write only if the file does not exist. User-owned (never overwrite). */
  async writeUserOnce(filePath: string, content: string): Promise<void> {
    const exists = await fs.pathExists(filePath);
    if (exists) {
      this.records.push({ path: filePath, action: this.dryRun ? "would-skip" : "skipped-existing" });
      return;
    }
    const action: WriteAction = this.dryRun ? "would-create" : "created";
    if (!this.dryRun) {
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, content, "utf8");
    }
    this.records.push({ path: filePath, action, bytes: Buffer.byteLength(content, "utf8") });
  }

  /** Markdown file with managed `<!-- apex:begin --> ... <!-- apex:end -->` section. */
  async writeMarkdownManaged(filePath: string, managedBody: string): Promise<void> {
    const existing = (await fs.pathExists(filePath))
      ? await fs.readFile(filePath, "utf8")
      : "";
    const { content, hadExisting } = spliceMarkdownManaged(existing, managedBody);
    const fileExisted = existing.length > 0;
    const action: WriteAction = this.dryRun
      ? fileExisted
        ? "would-merge"
        : "would-create"
      : fileExisted
      ? "merged"
      : "created";
    if (!this.dryRun) {
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, content, "utf8");
    }
    this.records.push({
      path: filePath,
      action,
      bytes: Buffer.byteLength(content, "utf8"),
      note: hadExisting ? "replaced existing apex block" : undefined,
    });
  }

  async writeGitignoreManaged(filePath: string, lines: string[]): Promise<void> {
    const existing = (await fs.pathExists(filePath))
      ? await fs.readFile(filePath, "utf8")
      : "";
    const { content } = spliceGitignoreManaged(existing, lines);
    const fileExisted = existing.length > 0;
    const action: WriteAction = this.dryRun
      ? fileExisted
        ? "would-merge"
        : "would-create"
      : fileExisted
      ? "merged"
      : "created";
    if (!this.dryRun) {
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, content, "utf8");
    }
    this.records.push({
      path: filePath,
      action,
      bytes: Buffer.byteLength(content, "utf8"),
    });
  }

  async writeSettingsHooks(
    filePath: string,
    apexHooks: Record<string, unknown[]>,
  ): Promise<void> {
    const existing: Record<string, unknown> | null = (await fs.pathExists(filePath))
      ? await fs.readJson(filePath).catch(() => null)
      : null;
    const merged = spliceSettingsHooks(existing, apexHooks);
    const fileExisted = existing !== null;
    const action: WriteAction = this.dryRun
      ? fileExisted
        ? "would-merge"
        : "would-create"
      : fileExisted
      ? "merged"
      : "created";
    const out = `${JSON.stringify(merged, null, 2)}\n`;
    if (!this.dryRun) {
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, out, "utf8");
    }
    this.records.push({ path: filePath, action, bytes: Buffer.byteLength(out, "utf8") });
  }

  async writeMcpEntry(
    filePath: string,
    serverName: string,
    serverConfig: Record<string, unknown>,
  ): Promise<void> {
    const existing: Record<string, unknown> | null = (await fs.pathExists(filePath))
      ? await fs.readJson(filePath).catch(() => null)
      : null;
    const merged = spliceMcpServers(existing, serverName, serverConfig);
    const fileExisted = existing !== null;
    const action: WriteAction = this.dryRun
      ? fileExisted
        ? "would-merge"
        : "would-create"
      : fileExisted
      ? "merged"
      : "created";
    const out = `${JSON.stringify(merged, null, 2)}\n`;
    if (!this.dryRun) {
      await fs.ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, out, "utf8");
    }
    this.records.push({ path: filePath, action, bytes: Buffer.byteLength(out, "utf8") });
  }

  recordSkippedTemplate(filePath: string, templateName: string): void {
    this.records.push({
      path: filePath,
      action: "skipped-missing-template",
      note: templateName,
    });
  }

  async ensureDir(dirPath: string): Promise<void> {
    if (!this.dryRun) {
      await fs.ensureDir(dirPath);
    }
  }
}
