/**
 * Vitest suite for RawResponseWriter — verifies the path scheme,
 * payload shape, and graceful failure on volume errors.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import {
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
    const writer = new RawResponseWriter(fakeVolume(upload));

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
    const writer = new RawResponseWriter(fakeVolume(upload));

    await writer.write({ ...SAMPLE_CAPTURE, capturedAt: '2027-01-02T03:04:05.000Z' });

    expect(upload.mock.calls[0][0]).toBe('acmecorp/2027-01-02/req-abc-123.json');
  });

  it('swallows volume upload failures (does not throw)', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('volume not mounted'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const writer = new RawResponseWriter(fakeVolume(upload));

    await expect(writer.write(SAMPLE_CAPTURE)).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('binding helpers', () => {
  it('bindRawResponseWriter sets the singleton; getRawResponseWriter resolves it', () => {
    expect(getRawResponseWriter()).toBeNull();

    const upload = vi.fn();
    const writer = bindRawResponseWriter(fakeVolume(upload));

    expect(getRawResponseWriter()).toBe(writer);
  });

  it('subsequent bindRawResponseWriter calls override the previous binding', () => {
    const writerA = bindRawResponseWriter(fakeVolume(vi.fn()));
    const writerB = bindRawResponseWriter(fakeVolume(vi.fn()));

    expect(getRawResponseWriter()).toBe(writerB);
    expect(getRawResponseWriter()).not.toBe(writerA);
  });

  it('_resetRawResponseWriter clears the binding', () => {
    bindRawResponseWriter(fakeVolume(vi.fn()));
    expect(getRawResponseWriter()).not.toBeNull();

    _resetRawResponseWriter();
    expect(getRawResponseWriter()).toBeNull();
  });
});
