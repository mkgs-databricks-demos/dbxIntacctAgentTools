/**
 * Raw Sage Intacct REST response capture.
 *
 * Every IntacctClient.request() that ships with `onRawResponse` set will
 * invoke the bound writer. The writer drops a JSON file into the
 * raw_responses UC Volume so debugging schema drift / replaying calls
 * doesn't require re-hitting Sage.
 *
 * Path scheme:
 *   <volume_root>/<tenant_id>/<YYYY-MM-DD>/<request_id>.json
 *
 * Failure mode: writes are best-effort. The hook logs and swallows any
 * error so a volume outage never blocks an MCP tool result.
 *
 * Future (NEXT_STEPS.md §2.1 phase 2): also insert a pointer row into
 * the UC Delta `raw_response_index` table. Out of scope for this layer.
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

export class RawResponseWriter {
  private readonly volume: MinimalVolumeAPI;

  constructor(volume: MinimalVolumeAPI) {
    this.volume = volume;
  }

  /**
   * Hook compatible with `IntacctClientOptions.onRawResponse`. Awaits
   * the volume write so the IntacctClient can guarantee the row landed
   * before returning to the caller.
   */
  async write(capture: RawResponseCapture): Promise<void> {
    const datePart = capture.capturedAt.slice(0, 10); // YYYY-MM-DD prefix of ISO 8601
    const path = `${capture.tenantId}/${datePart}/${capture.requestId}.json`;
    const body = JSON.stringify(capture, null, 2);
    try {
      await this.volume.upload(path, body, { overwrite: false });
    } catch (err) {
      console.error('[raw_response_writer] upload failed:', { path, err });
    }
  }
}

let writer: RawResponseWriter | null = null;

/** Bind the writer once during app startup. Subsequent calls override. */
export function bindRawResponseWriter(volume: MinimalVolumeAPI): RawResponseWriter {
  writer = new RawResponseWriter(volume);
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
