// Pictures carried inside the content (data: URIs) move to the bucket.
import { describe, expect, it, vi } from "vitest";
import { dataUrlToBlob, isEmbeddedImage, storeEmbeddedImages } from "../src/lib/images";

const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64")}`;
const JPG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 9]).toString("base64")}`;

describe("embedded pictures", () => {
  it("recognises pictures inside the content, not links or drawings", () => {
    expect(isEmbeddedImage(PNG)).toBe(true);
    expect(isEmbeddedImage(JPG)).toBe(true);
    expect(isEmbeddedImage("data:image/webp;base64,AAAA")).toBe(true);
    for (const v of ["https://x.test/a.png", "data:image/svg+xml;utf8,<svg/>", "data:text/html;base64,AAAA", "", null, undefined, 5]) expect(isEmbeddedImage(v), String(v)).toBe(false);
  });

  it("turns one back into the picture's bytes and type", async () => {
    const blob = dataUrlToBlob(PNG);
    expect(blob.type).toBe("image/png");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  });

  it("stores each distinct picture once and maps it to its link", async () => {
    const upload = vi.fn(async (blob) => `https://db.test/storage/v1/object/public/word-images/words/${blob.type.split("/")[1]}.webp`);
    const stored = await storeEmbeddedImages([PNG, "https://x.test/a.png", PNG, JPG, null], upload);
    expect(upload).toHaveBeenCalledTimes(2);
    expect([...stored]).toEqual([[PNG, "https://db.test/storage/v1/object/public/word-images/words/png.webp"], [JPG, "https://db.test/storage/v1/object/public/word-images/words/jpeg.webp"]]);
  });

  it("a picture that can't be stored now is left as it is", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const upload = vi.fn(async (blob) => { if (blob.type === "image/png") throw new Error("offline"); return "https://db.test/j.webp"; });
    const stored = await storeEmbeddedImages([PNG, JPG], upload);
    expect(stored.has(PNG)).toBe(false);
    expect(stored.get(JPG)).toBe("https://db.test/j.webp");
    error.mockRestore();
  });
});
