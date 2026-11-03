import { describe, expect, it } from "vitest";
import { getClientIp } from "./client-ip";

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

describe("getClientIp", () => {
  it("prefers X-Real-Ip (set by the proxy)", () => {
    expect(getClientIp(req({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("trims X-Real-Ip", () => {
    expect(getClientIp(req({ "x-real-ip": "  203.0.113.9 " }))).toBe("203.0.113.9");
  });

  it("falls back to the RIGHTMOST X-Forwarded-For entry (the one the proxy appended)", () => {
    expect(getClientIp(req({ "x-forwarded-for": "6.6.6.6, 7.7.7.7,  198.51.100.4 " }))).toBe("198.51.100.4");
  });

  it("a client-forged X-Forwarded-For prefix does not change the key", () => {
    const a = getClientIp(req({ "x-forwarded-for": "1.2.3.4, 198.51.100.4" }));
    const b = getClientIp(req({ "x-forwarded-for": "9.9.9.9, 198.51.100.4" }));
    expect(a).toBe(b);
  });

  it("ignores empty X-Forwarded-For segments", () => {
    expect(getClientIp(req({ "x-forwarded-for": "198.51.100.4, " }))).toBe("198.51.100.4");
  });

  it("handles a single X-Forwarded-For entry", () => {
    expect(getClientIp(req({ "x-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("returns 'unknown' without either header, or with blank values", () => {
    expect(getClientIp(req({}))).toBe("unknown");
    expect(getClientIp(req({ "x-real-ip": " ", "x-forwarded-for": " , " }))).toBe("unknown");
  });
});
