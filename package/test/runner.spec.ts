import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runWireEntry } from "../src/runner.js";

type Fixture = { entries: { name: string; kind: string; bytes_hex: string; version: { activated: number; ergoTree: number } }[] };

export const fixture = (name: string): Fixture =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

describe("Constant round-trip", () => {
  for (const e of fixture("Constant").entries) {
    it(`round-trips ${e.name}`, () => {
      expect(runWireEntry(e)).toEqual({ bytes_hex: e.bytes_hex, error: null });
    });
  }
});
