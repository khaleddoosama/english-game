// /api/hello: public, answers 200 with a greeting.
import { describe, expect, it } from "vitest";
import { GET } from "../api/hello.js";

describe("GET /api/hello", () => {
  it("returns a greeting as JSON", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ message: "Hello from Word Hunter!" });
  });
});
