import { describe, expect, it } from "vitest";
import { NATIONALITY_OPTIONS, toCountryCode, toCountryName } from "@/lib/countries";

describe("nationality country mapping", () => {
  it("uses the Singapore PR display label without changing the country code", () => {
    expect(NATIONALITY_OPTIONS.find(({ code }) => code === "SG")).toEqual({
      code: "SG",
      label: "Singapore/Singapore PR",
    });
  });

  it("keeps both the canonical and display labels mapped to Singapore", () => {
    expect(toCountryCode("Singapore")).toBe("SG");
    expect(toCountryCode("Singapore/Singapore PR")).toBe("SG");
    expect(toCountryCode("Singaporean/ Singapore PR")).toBe("SG");
  });

  it("uses the combined label whenever Singapore is displayed", () => {
    expect(toCountryName("SG")).toBe("Singapore/Singapore PR");
    expect(toCountryName("Singapore")).toBe("Singapore/Singapore PR");
    expect(toCountryName("Singaporean/ Singapore PR")).toBe("Singapore/Singapore PR");
  });
});
