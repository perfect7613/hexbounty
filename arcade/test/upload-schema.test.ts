import { describe, expect, it } from "vitest";
import {
  MAX_ROM_BYTES,
  uploadMetadataSchema,
  validateRomUploadFiles,
} from "../lib/uploads/schema";

const valid = {
  title: "Pocket Quest",
  slug: "pocket-quest",
  description: "A short Game Boy adventure.",
  priceMon: "1.5",
  rightsAttestation: true as const,
  rightsNote: "I own or licensed this ROM for distribution.",
  bountyMon: "0.01",
  bountyTxHash: `0x${"12".repeat(32)}`,
  bountyId: "7",
  bountyDeadline: 1787483700,
  bountyMetadataURI: "https://arcade.example/api/games/pocket-quest/metadata?creator=0x1111111111111111111111111111111111111111",
};

describe("uploadMetadataSchema", () => {
  it("accepts a strict valid payload", () => {
    expect(uploadMetadataSchema.parse(valid)).toEqual(valid);
  });

  it("trims title, description, and rightsNote", () => {
    expect(
      uploadMetadataSchema.parse({
        ...valid,
        title: "  Pocket Quest  ",
        description: "  A short Game Boy adventure.  ",
        rightsNote: "  I own or licensed this ROM for distribution.  ",
      }),
    ).toEqual(valid);
  });

  it("rejects unknown keys", () => {
    expect(() => uploadMetadataSchema.parse({ ...valid, extra: "nope" })).toThrow();
  });

  it("rejects a missing field", () => {
    expect(() =>
      uploadMetadataSchema.parse({
        slug: valid.slug,
        description: valid.description,
        priceMon: valid.priceMon,
        rightsAttestation: valid.rightsAttestation,
        rightsNote: valid.rightsNote,
      }),
    ).toThrow();
  });
});

describe("rights", () => {
  it("requires rightsAttestation to be the literal true", () => {
    expect(() => uploadMetadataSchema.parse({ ...valid, rightsAttestation: false })).toThrow();
    expect(() => uploadMetadataSchema.parse({ ...valid, rightsAttestation: "true" })).toThrow();
  });

  it("rejects a rightsNote shorter than 10 after trim", () => {
    expect(() => uploadMetadataSchema.parse({ ...valid, rightsNote: "too short" })).toThrow();
    expect(() => uploadMetadataSchema.parse({ ...valid, rightsNote: "   short   " })).toThrow();
  });

  it("rejects a rightsNote longer than 240 after trim", () => {
    expect(() => uploadMetadataSchema.parse({ ...valid, rightsNote: "x".repeat(241) })).toThrow();
  });
});

describe("slug", () => {
  it("accepts lowercase hyphenated segments of length 3..48", () => {
    expect(uploadMetadataSchema.parse({ ...valid, slug: "abc" }).slug).toBe("abc");
    expect(uploadMetadataSchema.parse({ ...valid, slug: "a-b-c1" }).slug).toBe("a-b-c1");
    expect(uploadMetadataSchema.parse({ ...valid, slug: "a".repeat(48) }).slug).toHaveLength(48);
  });

  it("rejects uppercase, underscores, leading/trailing/double hyphens, and short slugs", () => {
    for (const slug of ["AB", "ab", "Abc", "a_b", "-abc", "abc-", "a--b", "a b", ""]) {
      expect(() => uploadMetadataSchema.parse({ ...valid, slug }), slug).toThrow();
    }
  });

  it("rejects a slug longer than 48", () => {
    expect(() => uploadMetadataSchema.parse({ ...valid, slug: `a-${"b".repeat(47)}` })).toThrow();
  });
});

describe("priceMon", () => {
  it("accepts a positive decimal with up to 18 fractional digits", () => {
    expect(uploadMetadataSchema.parse({ ...valid, priceMon: "1" }).priceMon).toBe("1");
    expect(uploadMetadataSchema.parse({ ...valid, priceMon: "0.1" }).priceMon).toBe("0.1");
    expect(uploadMetadataSchema.parse({ ...valid, priceMon: `0.${"1".repeat(18)}` }).priceMon).toBe(
      `0.${"1".repeat(18)}`,
    );
  });

  it("rejects zero, negative, scientific, extra decimals, and overlong values", () => {
    for (const priceMon of [
      "0",
      "0.0",
      "0.000",
      "-1",
      "1e2",
      "01",
      "1.1234567890123456789",
      `${"1".repeat(20)}.1`,
      "not-a-number",
      "1000000.000000000000000001",
      "1000001",
      "",
    ]) {
      expect(() => uploadMetadataSchema.parse({ ...valid, priceMon }), priceMon).toThrow();
    }
  });
});

describe("title and description bounds", () => {
  it("rejects empty or oversized trimmed title and description", () => {
    expect(() => uploadMetadataSchema.parse({ ...valid, title: "   " })).toThrow();
    expect(() => uploadMetadataSchema.parse({ ...valid, title: "t".repeat(81) })).toThrow();
    expect(() => uploadMetadataSchema.parse({ ...valid, description: "   " })).toThrow();
    expect(() => uploadMetadataSchema.parse({ ...valid, description: "d".repeat(501) })).toThrow();
  });
});

describe("ROM file validator", () => {
  const ok = { name: "pocket.gb", size: 32_768, type: "application/octet-stream" };

  it("accepts exactly one .gb or .gbc under 8MB with an allowlisted MIME", () => {
    expect(validateRomUploadFiles([ok])).toEqual({ ok: true, file: ok });
    expect(
      validateRomUploadFiles([{ name: "color.gbc", size: 1, type: "application/x-gameboy-color-rom" }])
        .ok,
    ).toBe(true);
    expect(
      validateRomUploadFiles([{ name: "classic.GB", size: MAX_ROM_BYTES, type: "application/x-gameboy-rom" }])
        .ok,
    ).toBe(true);
  });

  it("rejects zero, many, or wrong-extension files", () => {
    expect(validateRomUploadFiles([]).ok).toBe(false);
    expect(validateRomUploadFiles([ok, ok]).ok).toBe(false);
    expect(validateRomUploadFiles([{ ...ok, name: "game.nes" }]).ok).toBe(false);
    expect(validateRomUploadFiles([{ ...ok, name: "game.gba" }]).ok).toBe(false);
  });

  it("rejects oversized or empty files", () => {
    expect(validateRomUploadFiles([{ ...ok, size: MAX_ROM_BYTES + 1 }]).ok).toBe(false);
    expect(validateRomUploadFiles([{ ...ok, size: 0 }]).ok).toBe(false);
  });

  it("rejects MIME types outside the Game Boy binary allowlist", () => {
    expect(validateRomUploadFiles([{ ...ok, type: "text/plain" }]).ok).toBe(false);
    expect(validateRomUploadFiles([{ ...ok, type: "application/zip" }]).ok).toBe(false);
    expect(validateRomUploadFiles([{ ...ok, type: "application/vnd.nintendo.snes.rom" }]).ok).toBe(
      false,
    );
  });
});
