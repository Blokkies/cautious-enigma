/**
 * Build an `attachment` Content-Disposition header value.
 * ASCII fallback (no quotes/backslashes/control/non-ASCII chars) + RFC 5987 UTF-8 name.
 */
export function attachmentContentDisposition(filename: string): string {
  const asciiName = filename.replace(/[^\x20-\x7E]|["\\]/g, "_");
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
