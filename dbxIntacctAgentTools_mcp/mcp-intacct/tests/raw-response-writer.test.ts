/**
 * Vitest suite for RawResponseWriter and RawResponseIndexer.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  RawResponseIndexer,
  RawResponseWriter,
  bindRawResponseWriter,
  getRawResponseWriter,
  _resetRawResponseWriter,
} from '../server/intacct/raw_response_writer.js';
import type { MinimalVolumeAPI } from '../server/intacct/raw_response_writer.js';

function fakeVolume(upload: ReturnType<typeof vi.fn>): MinimalVolumeAPI {
  return { upload };
}

const SAMPLE_CAPTURE = {
  requestId: 'req-abc-123',
  tenantId: 'acmecorp',
  method: 'GET',
  path: 'objects/general-ledger/account',
  httpStatus: 200,
  body: { 'ia::result': [{ account_no: '4100' }] },
  capturedAt: '2026-04-25T12:34:56.789Z',
};

afterEach(() => {
  _resetRawResponseWriter();
});

describe('RawResponseWriter.write', () => {
  it('writes to <tenant_id>/<YYYY-MM-DD>/<request_id>.json', async () => {
    const upload = vi.fn().mockResolvedValue(undefined);
    const writer = new RawResponseWriter({ volume: fakeVolume(upload) });

    await writer.write(SAMPLE_CAPTURE);

    expect(upload).toHaveBeenCalledTimes(1);
    const [path, body, opts] = upload.mock.calls[0];
    expect(path).toBe('acmecorp/2026-04-25/req-abc-123.json');
    expect(opts).toEqual({ overwrite: false });

    const parsed = JSON.parse(body as string);
    expect(parsed.requestId).toBe('req-abc-123');
    expect(parsed.body['ia::result'][0].account_no).toBe('4100');
  });

  it('serializes capturedAt verbatim and uses its date prefix', async () => {
    const upload = vi.fn().mockResolvedValue(undefined);
    const writer = new RawResponseWriter({ volume: fakeVolume(upload) });

    await writer.write({ ...SAMPLE_CAPTURE, capturedAt: '2027-01-02T03:04:05.000Z' });

    expect(upload.mock.calls[0][0]).toBe('acmecorp/2027-01-02/req-abc-123.json');
  });

  it('swallows volume upload failures (does not throw)', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('volume not mounted'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const writer = new RawResponseWriter({ volume: fakeVolume(upload) });

    await expect(writer.write(SAMPLE_CAPTURE)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('skips the indexer when the volume upload fails', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('volume not mounted'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const indexQuery = vi.fn().mockResolvedValue(undefined);
    const indexer = new RawResponseIndexer({
      query: indexQuery,
      catalog: 'cat',
      schema: 'sch',
    });
    const writer = new RawResponseWriter({ volume: fakeVolume(upload), indexer });

    await writer.write(SAMPLE_CAPTURE);

    expect(indexQuery).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('calls the indexer with the full volume path after a successful upload', async () => {
    const upload = vi.fn().mockResolvedValue(undefined);
    const indexQuery = vi.fn().mockResolvedValue(undefined);
    const indexer = new RawResponseIndexer({
      query: indexQuery,
      catalog: 'cat',
      schema: 'sch',
    });
    const writer = new RawResponseWriter({
      volume: fakeVolume(upload),
      indexer,
      volumeMountPath: '/Volumes/cat/sch/raw_responses',
    });

    await writer.write(SAMPLE_CAPTURE);

    expect(indexQuery).toHaveBeenCalledTimes(1);
    const sql = indexQuery.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO cat.sch.raw_response_index');
    expect(sql).toContain("'/Volumes/cat/sch/raw_responses/acmecorp/2026-04-25/req-abc-123.json'");
    expect(sql).toContain("'req-abc-123'");
    expect(sql).toContain("'objects/general-ledger/account'");
    expect(sql).toContain('200');
  });

  it('falls back to the relative path when no volumeMountPath is configured', async () => {
    const upload = vi.fn().mockResolvedValue(undefined);
    const indexQuery = vi.fn().mockResolvedValue(undefined);
    const indexer = new RawResponseIndexer({
      query: indexQuery,
      catalog: 'cat',
      schema: 'sch',
    });
    const writer = new RawResponseWriter({ volume: fakeVolume(upload), indexer });

    await writer.write(SAMPLE_CAPTURE);

    const sql = indexQuery.mock.calls[0][0] as string;
    expect(sql).toContain("'acmecorp/2026-04-25/req-abc-123.json'");
  });
});

describe('RawResponseIndexer.index', () => {
  it('escapes single quotes in string fields to avoid injection', async () => {
    const indexQuery = vi.fn().mockResolvedValue(undefined);
    const indexer = new RawResponseIndexer({
      query: indexQuery,
      catalog: 'cat',
      schema: 'sch',
    });

    await indexer.index({
      capture: { ...SAMPLE_CAPTURE, tenantId: "Bobby'); DROP--" },
      volumePath: '/Volumes/.../foo.json',
      bytes: 42,
    });

    const sql = indexQuery.mock.calls[0][0] as string;
    expect(sql).toContain("'Bobby''); DROP--'");
    expect(sql).not.toContain("Bobby'); DROP--'");
  });

  it('uses a custom table name when provided', async () => {
    const indexQuery = vi.fn().mockResolvedValue(undefined);
    const indexer = new RawResponseIndexer({
      query: indexQuery,
      catalog: 'cat',
      schema: 'sch',
      table: 'custom_index',
    });

    await indexer.index({
      capture: SAMPLE_CAPTURE,
      volumePath: '/v/p',
      bytes: 100,
    });

    expect(indexQuery.mock.calls[0][0] as string).toContain('INSERT INTO cat.sch.custom_index');
  });

  it('swallows query errors (does not throw)', async () => {
    const indexQuery = vi.fn().mockRejectedValue(new Error('warehouse asleep'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const indexer = new RawResponseIndexer({
      query: indexQuery,
      catalog: 'cat',
      schema: 'sch',
    });

    await expect(
      indexer.index({ capture: SAMPLE_CAPTURE, volumePath: '/v/p', bytes: 100 }),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('binding helpers', () => {
  it('bindRawResponseWriter sets the singleton; getRawResponseWriter resolves it', () => {
    expect(getRawResponseWriter()).toBeNull();

    const upload = vi.fn();
    const writer = bindRawResponseWriter({ volume: fakeVolume(upload) });

    expect(getRawResponseWriter()).toBe(writer);
  });

  it('subsequent bindRawResponseWriter calls override the previous binding', () => {
    const writerA = bindRawResponseWriter({ volume: fakeVolume(vi.fn()) });
    const writerB = bindRawResponseWriter({ volume: fakeVolume(vi.fn()) });

    expect(getRawResponseWriter()).toBe(writerB);
    expect(getRawResponseWriter()).not.toBe(writerA);
  });

  it('_resetRawResponseWriter clears the binding', () => {
    bindRawResponseWriter({ volume: fakeVolume(vi.fn()) });
    expect(getRawResponseWriter()).not.toBeNull();

    _resetRawResponseWriter();
    expect(getRawResponseWriter()).toBeNull();
  });
});
