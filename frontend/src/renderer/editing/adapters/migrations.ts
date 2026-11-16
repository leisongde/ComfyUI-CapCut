import { EDITING_PROJECT_VERSION } from '../../../shared/editing'
export const CURRENT_PROJECT_VERSION = EDITING_PROJECT_VERSION
export const migrations = []
export interface MigrationProgress {
  isMigrating: boolean
  fromVersion: number | null
  toVersion: number | null
  projectName: string | null
}
// Native project files are validated by the desktop storage service, independently of Cutia's browser databases.
export async function runStorageMigrations(_options: unknown): Promise<{ migratedCount: number }> {
  return { migratedCount: 0 }
}
