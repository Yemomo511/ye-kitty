export interface ArchitectureLegacyBudgets {
  readonly topLevelFiles?: Readonly<Record<string, number>>;
  readonly forbiddenDirectories?: Readonly<Record<string, number>>;
  readonly forbiddenFileNames?: number;
}

export const CURRENT_LEGACY_BUDGETS: ArchitectureLegacyBudgets;

export function findArchitectureViolations(
  packageRoot: string,
  options?: { readonly legacyBudgets?: ArchitectureLegacyBudgets },
): Promise<string[]>;
