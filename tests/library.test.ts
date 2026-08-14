import test from "node:test";
import assert from "node:assert/strict";
import { validateLibraryItem } from "../lib/library-validation.ts";

test("accepts a reusable text item", () => {
  assert.deepEqual(validateLibraryItem({
    name: "Retorno após avaliação",
    contentType: "text",
    textTemplate: "Oi, {{nome}}! Como posso ajudar?",
  }), {
    name: "Retorno após avaliação",
    contentType: "text",
    textTemplate: "Oi, {{nome}}! Como posso ajudar?",
    mediaUrl: null,
    storagePath: null,
  });
});

test("requires media for images and stickers", () => {
  assert.throws(() => validateLibraryItem({ name: "Sticker", contentType: "sticker" }), /Envie a imagem ou o sticker/);
});

test("only accepts HTTPS media", () => {
  assert.throws(() => validateLibraryItem({
    name: "Imagem",
    contentType: "image",
    mediaUrl: "http://example.com/image.png",
  }), /HTTPS/);
});
