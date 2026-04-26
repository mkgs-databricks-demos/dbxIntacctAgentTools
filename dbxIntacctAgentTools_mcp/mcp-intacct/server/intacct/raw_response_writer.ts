/**
 * Raw Sage Intacct REST response capture.
 *
 * Every IntacctClient.request() that ships with `onRawResponse` set will
 * invoke the bound writer. The writer drops a JSON file into the
 * raw_responses UC Volume and inserts a pointer row into the UC Delta
 * `raw_response_index` table so SQL queries can find captures without
 * listing the volume.
 *
 * Path scheme:
 *   <volume_root>/<tenant_id>/<YYYY-MM-DD>/<request_id>.json
 *
 * Failure mode: writes are best-effort. The hook logs and swallows any
 * error so a volume outage or warehouse hiccup never blocks an MCP
 * tool result.
 */

import type { RawResponseCapture } from './client.js';

/**
 * Subset of AppKit's VolumeAPI we actually call.
 * Defining it here keeps tests free of the full AppKit dependency.
 */
export interface MinimalVolumeAPI {
  upload(
    filePath: string,
    contents: Buffer | string,
    options?: { overwrite?: boolean },
  ): Promise<void>;
}

/**
 * Subset of AppKit's analytics-plugin SQL surface we actually call.
 * Just the bare query method — we render parameter values inline rather
 * than depending on AppKit's `SQLTypeMarker` parameterization API.
 */
export type SqlExecutor = (sql: string) => Promise<unknown>;

/**
 * Inserts a single row into the UC Delta `raw_response_index` table.
 * Decoupled from the volume writer so the volume path can succeed
 * even if the indexer fails (and vice versa).
 *
 * The INSERT statement renders values inline rather than using bound
 * parameters: the inputs are all bounded-shape (request_id is a UUID,
 * tenant_id and method come from controlled enums, the rest are
 * numbers/timestamps from our own code), so SQL-injection surface is
 * minimal. We still escape single quotes to be safe.
 */
export class RawResponseIndexer {
  private readonly query: SqlExecutor;
  private readonly fullyQualifiedTable: string;

  constructor(opts: { query: SqlExecutor; catalog: string; schema: string; table?: string }) {
    this.query = opts.query;
    const table = opts.table ?? 'raw_response_index';
    this.fullyQualifiedTable = `${opts.catalog}.${opts.schema}.${table}`;
  }

  /**
   * INSERT one pointer row. Logs (does not throw) on persistence failure.
   * The volume write is the source of truth — the index is just a
   * convenience pointer.
   */
  async index(args: {
    capture: RawResponseCapture;
    volumePath: string;
    bytes: number;
  }): Promise<void> {
    const { capture, volumePath, bytes } = args;
    try {
      const sql = `INSERT INTO ${this.fullyQualifiedTable}
        (request_id, tenant_id, endpoint, method, http_status,
         volume_path, bytes, created_at)
      VALUES (
        ${literal(capture.requestId)},
        ${literal(capture.tenantId)},
        ${literal(capture.path)},
        ${literal(capture.method)},
        ${capture.httpStatus},
        ${literal(volumePath)},
        ${bytes},
        CAST(${literal(capture.capturedAt)} AS TIMESTAMP)
      )`;
      await this.query(sql);
    } catch (err) {
      console.error('[raw_response_indexer] insert failed:', { volumePath, err });
    }
  }
}

/** Render a string as a SQL literal, escaping single quotes. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export class RawResponseWriter {
  private readonly volume: MinimalVolumeAPI;
  private readonly indexer: RawResponseIndexer | null;
  /**
   * Volume mount path used for the index row (e.g. /Volumes/.../raw_responses).
   * Combined with the per-capture path scheme to produce the full volume_path
   * value stored in raw_response_index.
   */
  private readonly volumeMountPath: string | null;

  constructor(opts: {
    volume: MinimalVolumeAPI;
    indexer?: RawResponseIndexer | null;
    volumeMountPath?: string | null;
  }) {
    this.volume = opts.volume;
    this.indexer = opts.indexer ?? null;
    this.volumeMountPath = opts.volumeMountPath ?? null;
  }

  /**
   * Hook compatible with `IntacctClientOptions.onRawResponse`. Awaits
   * the volume write so the IntacctClient can guarantee the row landed
   * before returning to the caller.
   */
  async write(capture: RawResponseCapture): Promise<void> {
    const datePart = capture.capturedAt.slice(0, 10); // YYYY-MM-DD prefix of ISO 8601
    const relativePath = `${capture.tenantId}/${datePart}/${capture.requestId}.json`;
    const body = JSON.stringify(capture, null, 2);
    let uploaded = false;
    try {
      await this.volume.upload(relativePath, body, { overwrite: false });
      uploaded = true;
    } catch (err) {
      console.error('[raw_response_writer] upload failed:', { path: relativePath, err });
    }

    if (uploaded && this.indexer) {
      const fullVolumePath = this.volumeMountPath
        ? `${this.volumeMountPath.replace(/\/$/, '')}/${relativePath}`
        : relativePath;
      await this.indexer.index({
        capture,
        volumePath: fullVolumePath,
        bytes: Buffer.byteLength(body, 'utf-8'),
      });
    }
  }
}

let writer: RawResponseWriter | null = null;

/** Bind the writer once during app startup. Subsequent calls override. */
export function bindRawResponseWriter(opts: {
  volume: MinimalVolumeAPI;
  indexer?: RawResponseIndexer | null;
  volumeMountPath?: string | null;
}): RawResponseWriter {
  writer = new RawResponseWriter(opts);
  return writer;
}

/** Resolve the bound writer, or `null` if no writer has been bound yet. */
export function getRawResponseWriter(): RawResponseWriter | null {
  return writer;
}

/** Test-only — clear the bound writer between tests. */
export function _resetRawResponseWriter(): void {
  writer = null;
}
