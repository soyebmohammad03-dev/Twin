import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAndExtractText, WebFetchError } from '../src/modules/ingestion/extraction/webFetch.js';

/**
 * Phase 43 — deterministic tests for webFetch.ts's redirect handling.
 *
 * Real internet redirect chains aren't controllable or deterministic
 * enough to assert SSRF behavior against (a CI run can't rely on some
 * external service redirecting to a private IP on demand, and doing so
 * would be irresponsible even if it existed). This file mocks the
 * global `fetch` directly instead — the one seam that lets every hop
 * of a redirect chain be scripted exactly, including hops that must
 * never actually be reached (proven by asserting the mock was never
 * called for them, not just that the final result is an error).
 *
 * IP-literal URLs are used throughout (never a real hostname) so
 * `assertPublicHost`'s `isIP()` fast path is exercised without any
 * real DNS lookup — this file makes no network calls at all.
 */

const PUBLIC_IP_A = '93.184.216.34'; // example.com's real public IP — used only as a literal, never dialed
const PUBLIC_IP_B = '203.0.113.10'; // TEST-NET-3 (RFC 5737), a documentation-reserved public-looking address
const PRIVATE_IP = '10.0.0.5';
const METADATA_IP = '169.254.169.254'; // cloud metadata endpoint — link-local, must always be blocked
const LOOPBACK_IP = '127.0.0.1';

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function redirectResponse(location: string | null, status = 302): Response {
  const headers = new Headers();
  if (location) headers.set('location', location);
  return new Response(null, { status, headers });
}

describe('webFetch.ts — redirect handling (Phase 43 SSRF hardening)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a normal, non-redirecting request still works exactly as before', async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse('<html><title>Hello</title><body>Real content</body></html>'));

    const result = await fetchAndExtractText(`http://${PUBLIC_IP_A}/page`);
    expect(result.title).toBe('Hello');
    expect(result.text).toContain('Real content');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a valid redirect chain to another public address is followed and extracted', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse(`http://${PUBLIC_IP_B}/final`))
      .mockResolvedValueOnce(htmlResponse('<html><title>Final</title><body>Redirected content</body></html>'));

    const result = await fetchAndExtractText(`http://${PUBLIC_IP_A}/start`);
    expect(result.title).toBe('Final');
    expect(result.text).toContain('Redirected content');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toBe(`http://${PUBLIC_IP_A}/start`);
    expect(fetchMock.mock.calls[1]![0]).toBe(`http://${PUBLIC_IP_B}/final`);
  });

  it('a redirect to a private/internal IP is rejected, and the private target is NEVER actually fetched', async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse(`http://${PRIVATE_IP}/internal`));

    await expect(fetchAndExtractText(`http://${PUBLIC_IP_A}/start`)).rejects.toThrow(WebFetchError);
    // Only the first (public) hop was ever dialed — the private
    // redirect target was rejected before any request was made to it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a redirect to the cloud metadata address (169.254.169.254) is rejected', async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse(`http://${METADATA_IP}/latest/meta-data/`));

    await expect(fetchAndExtractText(`http://${PUBLIC_IP_A}/start`)).rejects.toThrow(WebFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a redirect to loopback (127.0.0.1) is rejected', async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse(`http://${LOOPBACK_IP}/`));

    await expect(fetchAndExtractText(`http://${PUBLIC_IP_A}/start`)).rejects.toThrow(WebFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a redirect to the literal hostname "localhost" is rejected, matching the direct-URL guard', async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse('http://localhost:5432/'));

    await expect(fetchAndExtractText(`http://${PUBLIC_IP_A}/start`)).rejects.toThrow(WebFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a redirect to a non-http(s) scheme (e.g. file://) is rejected, never fetched', async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse('file:///etc/passwd'));

    await expect(fetchAndExtractText(`http://${PUBLIC_IP_A}/start`)).rejects.toThrow(WebFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a redirect response with no Location header fails honestly, not silently', async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse(null));

    await expect(fetchAndExtractText(`http://${PUBLIC_IP_A}/start`)).rejects.toThrow(WebFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a redirect chain exceeding the maximum hop count is rejected, not followed indefinitely', async () => {
    // 7 redirects in a row, all to public addresses — still must be rejected once MAX_REDIRECTS is exceeded.
    for (let i = 0; i < 7; i++) {
      fetchMock.mockResolvedValueOnce(redirectResponse(`http://${PUBLIC_IP_A}/hop-${i + 1}`));
    }

    await expect(fetchAndExtractText(`http://${PUBLIC_IP_A}/start`)).rejects.toThrow(WebFetchError);
    // Bounded, not unbounded: the mock was called a small, fixed number of times, never all 7+.
    expect(fetchMock.mock.calls.length).toBeLessThan(7);
  });

  it('a relative Location header is resolved against the current URL before validation', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse('/relative-path'))
      .mockResolvedValueOnce(htmlResponse('<html><title>Relative</title><body>ok</body></html>'));

    const result = await fetchAndExtractText(`http://${PUBLIC_IP_A}/start`);
    expect(result.title).toBe('Relative');
    expect(fetchMock.mock.calls[1]![0]).toBe(`http://${PUBLIC_IP_A}/relative-path`);
  });

  it('direct (non-redirect) SSRF protections remain intact: a private IP as the initial URL is still rejected without any fetch call', async () => {
    await expect(fetchAndExtractText(`http://${PRIVATE_IP}/`)).rejects.toThrow(WebFetchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('direct SSRF protection for "localhost" as the initial URL remains intact', async () => {
    await expect(fetchAndExtractText('http://localhost:5432/')).rejects.toThrow(WebFetchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
