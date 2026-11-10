import {
  closeSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertOutsideCheckout, readBoundedFile } from "./files.js";
import type { BudgetCommand, BudgetCoverage } from "../../application/budget-ports.js";
export type EditableBudgetDraft = {
  facts: Extract<BudgetCommand, { kind: "activate" }>["facts"];
  coverage: BudgetCoverage;
};
export type BudgetEditorRunner = (path: string) => Promise<number>;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
type EditableShape =
  | null
  | { fields: Record<string, EditableShape> }
  | { each: EditableShape }
  | { variants: Record<string, EditableShape> };
const allocationShape: EditableShape = {
  variants: {
    income: { fields: { kind: null } },
    unallocated: { fields: { kind: null } },
    categories: {
      fields: { kind: null, lines: { each: { fields: { categoryId: null, amountCents: null } } } },
    },
  },
};
const activityFields = {
  kind: null,
  id: null,
  sourceId: null,
  date: null,
  order: null,
  amountCents: null,
};
const editableShape: EditableShape = {
  fields: {
    facts: {
      fields: {
        startMonth: null,
        currency: null,
        opening: {
          fields: {
            accounts: {
              each: {
                fields: {
                  accountId: null,
                  kind: null,
                  balanceCents: null,
                  closed: null,
                  evidence: null,
                },
              },
            },
            categories: {
              each: { fields: { categoryId: null, availableCents: null, evidence: null } },
            },
            readyToAssignCents: null,
            evidence: null,
            deficitAcknowledged: null,
          },
        },
        categories: {
          each: {
            fields: { id: null, groupId: null, name: null, archived: null, cardAccountId: null },
          },
        },
        assignments: { each: { fields: { month: null, categoryId: null, amountCents: null } } },
        events: {
          each: {
            variants: {
              transaction: {
                fields: { ...activityFields, accountId: null, allocation: allocationShape },
              },
              transfer: {
                fields: {
                  ...activityFields,
                  fromAccountId: null,
                  toAccountId: null,
                  categoryId: null,
                },
              },
            },
          },
        },
      },
    },
    coverage: {
      fields: {
        throughDate: null,
        evidence: null,
        includedTransactionIds: null,
        postedBridgeEventIds: null,
      },
    },
  },
};
function validateEditableKeys(value: unknown, shape: EditableShape): void {
  if (shape === null) return;
  if ("each" in shape) {
    if (!Array.isArray(value)) throw new Error("invalid-editable-budget");
    for (const item of value) validateEditableKeys(item, shape.each);
    return;
  }
  if (!isRecord(value)) throw new Error("invalid-editable-budget");
  if ("variants" in shape) {
    if (typeof value.kind !== "string" || !Object.hasOwn(shape.variants, value.kind))
      throw new Error("invalid-editable-budget");
    validateEditableKeys(value, shape.variants[value.kind] ?? null);
    return;
  }
  for (const key of Object.keys(value))
    if (!Object.hasOwn(shape.fields, key)) throw new Error(`unknown-budget-editor-field:${key}`);
  for (const [key, child] of Object.entries(shape.fields)) validateEditableKeys(value[key], child);
}
/** The parser must validate facts, coverage, and their relationships. Only facts and coverage can be edited. */
export function createBudgetEditor(parseDraft: (value: object) => EditableBudgetDraft) {
  function parseEditableDraft(value: unknown): EditableBudgetDraft {
    if (
      !isRecord(value) ||
      Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, "facts") ||
      !Object.hasOwn(value, "coverage")
    )
      throw new Error("invalid-editable-budget-fields");
    const parsed = parseDraft(value);
    validateEditableKeys(value, editableShape);
    return parsed;
  }
  return async (
    draft: EditableBudgetDraft,
    run: BudgetEditorRunner,
  ): Promise<EditableBudgetDraft | null> => {
    const contents = JSON.stringify(parseEditableDraft(draft), null, 2) + "\n";
    if (Buffer.byteLength(contents) > 64 * 1024 * 1024) throw new Error("input-limit");
    const parent = realpathSync(tmpdir());
    assertOutsideCheckout(parent);
    const directory = mkdtempSync(join(parent, "inab-budget-edit-")),
      path = join(directory, "draft.json");
    try {
      const descriptor = openSync(path, "wx", 0o600);
      try {
        writeFileSync(descriptor, contents);
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      const status = await run(path);
      if (status === 1) return null;
      if (status !== 0) throw new Error("vim-editor-failed");
      const file = readBoundedFile(path);
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes));
      } catch {
        throw new Error("invalid-budget-editor-json");
      }
      return parseEditableDraft(value);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
}
