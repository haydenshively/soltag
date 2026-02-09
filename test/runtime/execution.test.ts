import { describe, expect, it } from "vitest";

import { deriveAddress } from "../../src/runtime/execution.js";

describe("execution", () => {
  describe("deriveAddress", () => {
    it("returns a valid checksummed address", () => {
      const addr = deriveAddress("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
      expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/);
    });

    it("returns deterministic results", () => {
      const hash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as const;
      const a = deriveAddress(hash);
      const b = deriveAddress(hash);
      expect(a).toBe(b);
    });

    it("returns different addresses for different hashes", () => {
      const a = deriveAddress("0x1111111111111111111111111111111111111111111111111111111111111111");
      const b = deriveAddress("0x2222222222222222222222222222222222222222222222222222222222222222");
      expect(a).not.toBe(b);
    });
  });
});
