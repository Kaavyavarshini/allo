import { describe, it, expect } from "vitest";
import { bearerMatches } from "../lib/auth";

describe("bearerMatches", () => {
  it("accepts the right token", () => expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true));
  it("rejects a wrong token, wrong length, wrong scheme, missing header", () => {
    expect(bearerMatches("Bearer nope", "s3cret")).toBe(false);
    expect(bearerMatches("Bearer s3cre", "s3cret")).toBe(false);
    expect(bearerMatches("Basic s3cret", "s3cret")).toBe(false);
    expect(bearerMatches(null, "s3cret")).toBe(false);
  });
  it("fails closed when the secret is unset (regression: 'Bearer undefined' used to pass)", () => {
    expect(bearerMatches("Bearer undefined", undefined)).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
    expect(bearerMatches("Bearer x", "")).toBe(false);
  });
});
