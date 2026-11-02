import { describe, expect, it } from "vitest";
import { attachmentContentDisposition } from "./content-disposition";

/** Header values must be ByteStrings; keep them printable ASCII so no proxy mangles them. */
function assertValidHeader(value: string) {
  expect(() => new Headers({ "Content-Disposition": value })).not.toThrow();
  expect(/^[\x20-\x7E]*$/.test(value)).toBe(true);
}

describe("attachmentContentDisposition", () => {
  it("keeps plain ASCII names as-is", () => {
    const v = attachmentContentDisposition("stock_2024.xlsx");
    expect(v).toBe(`attachment; filename="stock_2024.xlsx"; filename*=UTF-8''stock_2024.xlsx`);
    assertValidHeader(v);
  });

  it("replaces an en dash in the fallback and percent-encodes it in filename*", () => {
    const v = attachmentContentDisposition("Stock – March.xlsx");
    expect(v).toBe(`attachment; filename="Stock _ March.xlsx"; filename*=UTF-8''Stock%20%E2%80%93%20March.xlsx`);
    assertValidHeader(v);
  });

  it("replaces non-Latin1 characters (one underscore per UTF-16 code unit)", () => {
    const v = attachmentContentDisposition("倉庫.xlsx");
    expect(v).toContain(`filename="__.xlsx"`);
    expect(v).toContain(`filename*=UTF-8''%E5%80%89%E5%BA%AB.xlsx`);
    assertValidHeader(v);

    // Astral characters are two code units -> two underscores
    expect(attachmentContentDisposition("\u{1F4E6}.xlsx")).toContain(`filename="__.xlsx"`);
  });

  it("replaces Latin-1 accented characters too (fallback is strict ASCII)", () => {
    const v = attachmentContentDisposition("Zoë.xlsx");
    expect(v).toContain(`filename="Zo_.xlsx"`);
    expect(v).toContain(`filename*=UTF-8''Zo%C3%AB.xlsx`);
    assertValidHeader(v);
  });

  it("neutralises quotes and backslashes in the fallback name", () => {
    const v = attachmentContentDisposition(`a"b\\c.xlsx`);
    expect(v).toContain(`filename="a_b_c.xlsx"`);
    expect(v).toContain(`filename*=UTF-8''a%22b%5Cc.xlsx`);
    assertValidHeader(v);
  });

  it("replaces control characters such as CR/LF (no header injection)", () => {
    const v = attachmentContentDisposition("evil\r\nSet-Cookie: x.xlsx");
    expect(v).toContain(`filename="evil__Set-Cookie: x.xlsx"`);
    assertValidHeader(v);
  });

  it("leaves ' ( ) unescaped in filename* (encodeURIComponent semantics)", () => {
    // RFC 5987 attr-char technically excludes these; browsers accept them. Characterised only.
    expect(attachmentContentDisposition("it's (1).xlsx")).toContain(`filename*=UTF-8''it's%20(1).xlsx`);
  });
});
