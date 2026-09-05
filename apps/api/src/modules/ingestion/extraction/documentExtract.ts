import { PDFParse } from 'pdf-parse';

export class DocumentExtractionError extends Error {}

/**
 * Phase 42: real, deterministic text-layer extraction for an uploaded
 * PDF — no OCR, no AI. `pdf-parse` (wrapping Mozilla's pdf.js) reads
 * the PDF's own embedded text layer, exactly the text a user could
 * select/copy from the document themselves; it never invents content
 * for a scanned page with no text layer. Mirrors webFetch.ts's
 * contract exactly: a real parse that either returns genuine extracted
 * text or throws a typed error the caller turns into an honest failed
 * job — never a fabricated memory.
 */
const MAX_DOCUMENT_BYTES = 20_000_000; // 20MB
const MAX_DOCUMENT_CONTENT_CHARS = 20_000; // same ceiling every other ingestion input type already enforces

export async function extractPdfText(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
  if (buffer.length === 0) {
    throw new DocumentExtractionError('The uploaded file is empty.');
  }
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentExtractionError(`The uploaded file exceeds the ${MAX_DOCUMENT_BYTES}-byte limit.`);
  }

  const parser = new PDFParse({ data: buffer });
  let text: string;
  let pageCount: number;
  try {
    const result = await parser.getText();
    text = result.text.replace(/\s+/g, ' ').trim();
    pageCount = result.total;
  } catch (err) {
    throw new DocumentExtractionError(`Could not parse PDF: ${err instanceof Error ? err.message : 'unknown error'}`);
  } finally {
    await parser.destroy();
  }

  if (!text) {
    // A real, common case: a scanned PDF with no embedded text layer.
    // Honest failure — never fabricated OCR text.
    throw new DocumentExtractionError('No extractable text found in this PDF (it may be a scanned image with no text layer).');
  }

  return { text: text.slice(0, MAX_DOCUMENT_CONTENT_CHARS), pageCount };
}
