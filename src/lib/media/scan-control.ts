/**
 * In-process scan controller: progress persistence + cooperative pause/resume.
 * Survives only for the lifetime of the Node process (self-hosted Next server).
 */
import { getDb } from "../db";

export type ScanPhase =
  | "starting"
  | "walking"
  | "indexing"
  | "cleanup"
  | "assets"
  | "completed"
  | "failed";

export interface ScanProgressSnapshot {
  id: number;
  status: string;
  phase: string | null;
  progress_current: number;
  progress_total: number;
  progress_message: string | null;
  files_found: number;
  files_added: number;
  files_updated: number;
  files_removed: number;
  thumbnails_generated: number;
  blurhashes_generated: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export class ScanController {
  readonly jobId: number;
  private pauseRequested = false;
  private resumeWaiters: Array<() => void> = [];

  constructor(jobId: number) {
    this.jobId = jobId;
  }

  requestPause(): boolean {
    this.pauseRequested = true;
    const db = getDb();
    db.prepare(
      `UPDATE scan_jobs SET status = 'paused', progress_message = COALESCE(progress_message, 'Paused') WHERE id = ? AND status = 'running'`
    ).run(this.jobId);
    return true;
  }

  resume(): boolean {
    if (!this.pauseRequested && this.resumeWaiters.length === 0) {
      // Still allow DB status flip if we were paused
    }
    this.pauseRequested = false;
    const db = getDb();
    db.prepare(
      `UPDATE scan_jobs SET status = 'running', progress_message = 'Resuming…' WHERE id = ? AND status IN ('paused', 'running')`
    ).run(this.jobId);
    const waiters = this.resumeWaiters.splice(0);
    for (const resolve of waiters) resolve();
    return true;
  }

  /**
   * Cooperative checkpoint — call between batches. Blocks while paused.
   */
  async checkpoint(): Promise<void> {
    if (!this.pauseRequested) return;

    const db = getDb();
    db.prepare(
      `UPDATE scan_jobs SET status = 'paused' WHERE id = ? AND status = 'running'`
    ).run(this.jobId);

    await new Promise<void>((resolve) => {
      this.resumeWaiters.push(resolve);
    });
  }

  updateProgress(
    phase: ScanPhase,
    current: number,
    total: number,
    message?: string,
    counters?: Partial<{
      files_found: number;
      files_added: number;
      files_updated: number;
      files_removed: number;
      thumbnails_generated: number;
      blurhashes_generated: number;
    }>
  ): void {
    const db = getDb();
    const sets = [
      "phase = ?",
      "progress_current = ?",
      "progress_total = ?",
      "progress_message = ?",
    ];
    const values: unknown[] = [phase, current, total, message ?? null];

    if (counters?.files_found !== undefined) {
      sets.push("files_found = ?");
      values.push(counters.files_found);
    }
    if (counters?.files_added !== undefined) {
      sets.push("files_added = ?");
      values.push(counters.files_added);
    }
    if (counters?.files_updated !== undefined) {
      sets.push("files_updated = ?");
      values.push(counters.files_updated);
    }
    if (counters?.files_removed !== undefined) {
      sets.push("files_removed = ?");
      values.push(counters.files_removed);
    }
    if (counters?.thumbnails_generated !== undefined) {
      sets.push("thumbnails_generated = ?");
      values.push(counters.thumbnails_generated);
    }
    if (counters?.blurhashes_generated !== undefined) {
      sets.push("blurhashes_generated = ?");
      values.push(counters.blurhashes_generated);
    }

    values.push(this.jobId);
    db.prepare(`UPDATE scan_jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  markCompleted(summary: {
    files_found: number;
    files_added: number;
    files_updated: number;
    files_removed: number;
    thumbnails_generated: number;
    blurhashes_generated: number;
  }): void {
    const db = getDb();
    db.prepare(
      `UPDATE scan_jobs SET
        status = 'completed',
        phase = 'completed',
        completed_at = datetime('now'),
        progress_current = progress_total,
        progress_message = 'Done',
        files_found = ?, files_added = ?, files_updated = ?, files_removed = ?,
        thumbnails_generated = ?, blurhashes_generated = ?
      WHERE id = ?`
    ).run(
      summary.files_found,
      summary.files_added,
      summary.files_updated,
      summary.files_removed,
      summary.thumbnails_generated,
      summary.blurhashes_generated,
      this.jobId
    );
  }

  markFailed(error: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE scan_jobs SET
        status = 'failed',
        phase = 'failed',
        completed_at = datetime('now'),
        error_message = ?,
        progress_message = ?
      WHERE id = ?`
    ).run(error, error, this.jobId);
  }
}

let activeController: ScanController | null = null;

export function getActiveController(): ScanController | null {
  return activeController;
}

export function setActiveController(controller: ScanController | null): void {
  activeController = controller;
}

export function createController(jobId: number): ScanController {
  const controller = new ScanController(jobId);
  activeController = controller;
  return controller;
}

export function clearController(jobId: number): void {
  if (activeController?.jobId === jobId) {
    activeController = null;
  }
}

/** Mark orphaned running/paused jobs from a previous process as failed. */
export function failStaleScanJobs(): void {
  const db = getDb();
  db.prepare(
    `UPDATE scan_jobs SET
      status = 'failed',
      phase = 'failed',
      completed_at = datetime('now'),
      error_message = COALESCE(error_message, 'Scan interrupted (server restarted)')
    WHERE status IN ('running', 'paused')`
  ).run();
}

export function getScanJobById(id: number): ScanProgressSnapshot | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, status, phase, progress_current, progress_total, progress_message,
              files_found, files_added, files_updated, files_removed,
              thumbnails_generated, blurhashes_generated,
              error_message, started_at, completed_at
       FROM scan_jobs WHERE id = ?`
    )
    .get(id) as ScanProgressSnapshot | undefined;
  return row ?? null;
}

export function getActiveScanJob(): ScanProgressSnapshot | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, status, phase, progress_current, progress_total, progress_message,
              files_found, files_added, files_updated, files_removed,
              thumbnails_generated, blurhashes_generated,
              error_message, started_at, completed_at
       FROM scan_jobs
       WHERE status IN ('running', 'paused')
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get() as ScanProgressSnapshot | undefined;
  return row ?? null;
}
