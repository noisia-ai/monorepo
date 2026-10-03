import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { slugify } from "./slug";

describe("slugify", () => {
  it("normalizes manual slugs before they hit API validation", () => {
    assert.equal(slugify("taxis_mx"), "taxis-mx");
    assert.equal(slugify("Brand OS Mexico"), "brand-os-mexico");
    assert.equal(slugify("Telefonia Movil Mexico"), "telefonia-movil-mexico");
  });

  it("removes accents and collapses separators", () => {
    assert.equal(slugify("  Telefonia movil: Mexico!!  "), "telefonia-movil-mexico");
    assert.equal(slugify("cafe___con---leche"), "cafe-con-leche");
  });

  it("keeps the slug within the requested max length without trailing dashes", () => {
    assert.equal(slugify("brand with very long suffix", 10), "brand-with");
  });
});
