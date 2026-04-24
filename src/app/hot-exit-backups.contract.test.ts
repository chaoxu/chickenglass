import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type {
  HotExitBackup,
  HotExitBackupSummary,
} from "./tauri-client/recovery";

const backupFieldShape = {
  version: true,
  id: true,
  projectRoot: true,
  projectKey: true,
  path: true,
  name: true,
  content: true,
  contentHash: true,
  baselineHash: true,
  createdAt: true,
  updatedAt: true,
} satisfies Required<Record<keyof HotExitBackup, true>>;

const summaryFieldShape = {
  id: true,
  projectRoot: true,
  projectKey: true,
  path: true,
  name: true,
  contentHash: true,
  baselineHash: true,
  updatedAt: true,
  bytes: true,
} satisfies Required<Record<keyof HotExitBackupSummary, true>>;

type IsOptional<T, K extends keyof T> = Record<string, never> extends Pick<T, K>
  ? true
  : false;

const baselineHashOptionalContract: {
  readonly backup: IsOptional<HotExitBackup, "baselineHash">;
  readonly summary: IsOptional<HotExitBackupSummary, "baselineHash">;
} = {
  backup: true,
  summary: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readContract(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    readFileSync(resolve(process.cwd(), "tests/contracts/hot-exit-backups.contract.json"), "utf8"),
  );
  if (!isRecord(parsed)) {
    throw new Error("expected hot-exit backup contract object");
  }
  return parsed;
}

const contract = readContract();

function getContractRecord(name: string): Record<string, unknown> {
  const value = contract[name];
  if (!isRecord(value)) {
    throw new Error(`expected contract record: ${name}`);
  }
  return value;
}

function sortedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort();
}

function shapeKeys(shape: Record<string, true>, options?: {
  readonly omitBaselineHash?: boolean;
}): string[] {
  const keys = Object.keys(shape);
  return (options?.omitBaselineHash
    ? keys.filter((key) => key !== "baselineHash")
    : keys).sort();
}

describe("hot-exit backup persisted payload contract", () => {
  it("keeps baselineHash optional in the TypeScript interfaces", () => {
    expect(baselineHashOptionalContract).toEqual({
      backup: true,
      summary: true,
    });
  });

  it("keeps HotExitBackup fields aligned with the Rust serde payload", () => {
    const backup = getContractRecord("backup");
    const withoutBaseline = {
      ...backup,
    };
    delete withoutBaseline.baselineHash;

    expect(sortedKeys(backup)).toEqual(shapeKeys(backupFieldShape));
    expect(backup.version).toBe(1);

    expect(sortedKeys(withoutBaseline)).toEqual(shapeKeys(backupFieldShape, {
      omitBaselineHash: true,
    }));
    expect(withoutBaseline.version).toBe(1);
  });

  it("keeps HotExitBackupSummary fields aligned with the Rust serde payload", () => {
    const summary = getContractRecord("summary");
    const withoutBaseline = {
      ...summary,
    };
    delete withoutBaseline.baselineHash;

    expect(sortedKeys(summary)).toEqual(shapeKeys(summaryFieldShape));

    expect(sortedKeys(withoutBaseline)).toEqual(shapeKeys(summaryFieldShape, {
      omitBaselineHash: true,
    }));
  });
});
