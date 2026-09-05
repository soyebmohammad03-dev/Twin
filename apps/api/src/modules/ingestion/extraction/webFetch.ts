import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class WebFetchError extends Error {}

const MAX_RESPONSE_BYTES = 1_000_000; // 1MB
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Fetches a URL and extracts its visible text — real HTTP + HTML
 * stripping, no AI involved. Includes basic SSRF protection: only
 * http/https, and the resolved IP must not be in a private/loopback/
 * link-local range. This is a pre-fetch DNS check, not a fully
 * hardened defense against DNS-rebinding attacks (which would require
 * validating the IP actually connected to, not just resolved) —
 * acceptable for a foundation phase, called out here as a known
 * limitation rather than left undocumented.
 */
export async function fetchAndExtractText(url: string): Promise<{ title: string | null; text: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebFetchError(`Unsupported URL scheme: ${parsed.protocol}`);
  }

  await assertPublicHost(parsed.hostname);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'TwinBot/0.1 (+ingestion; no AI, plain text extraction only)' },
    });
  } catch (err) {
    throw new WebFetchError(`Could not reach ${url}: ${err instanceof Error ? err.message : 'unknown error'}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new WebFetchError(`Fetching ${url} returned HTTP ${response.status}.`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
    throw new WebFetchError(`Unsupported content type for ${url}: ${contentType || 'unknown'}.`);
  }

  const html = await readBodyWithLimit(response, url);
  return { title: extractTitle(html), text: htmlToText(html) };
}

async function readBodyWithLimit(response: Response, url: string): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new WebFetchError(`Response from ${url} exceeded the ${MAX_RESPONSE_BYTES}-byte limit.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (hostname === 'localhost') {
    throw new WebFetchError('Refusing to fetch localhost.');
  }

  const ip = isIP(hostname) ? hostname : (await lookup(hostname)).address;
  if (isPrivateOrReservedIp(ip)) {
    throw new WebFetchError(`Refusing to fetch a private/internal address (${ip}).`);
  }
}

function isPrivateOrReservedIp(ip: string): boolean {
  if (ip.includes(':')) {
    return ip === '::1' || /^f[cd][0-9a-f]{0,2}:/i.test(ip) || /^fe80:/i.test(ip);
  }
  const parts = ip.split('.').map(Number);
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1] ? match[1].trim().slice(0, 200) : null;
}

function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const withoutTags = withoutNoise.replace(/<[^>]+>/g, ' ');
  const decoded = withoutTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return decoded.replace(/\s+/g, ' ').trim().slice(0, 20_000);
}
