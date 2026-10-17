"use strict";

const path = require("node:path");

const DISALLOWED_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Keep source files under src as TypeScript.",
    },
    schema: [],
    messages: {
      typescriptOnly:
        "Source files under src must be .ts or .tsx. Found {{extension}}. Add support for that type before introducing it.",
    },
  },
  create(context) {
    return {
      Program(node) {
        const filename = context.filename ?? context.getFilename();
        const normalized = filename.split(path.sep).join("/");
        const underSrc =
          normalized === "src" || normalized.startsWith("src/") || normalized.includes("/src/");
        if (!underSrc) return;

        const extension = path.extname(filename);
        if (!DISALLOWED_EXTENSIONS.has(extension)) return;

        context.report({
          node,
          messageId: "typescriptOnly",
          data: { extension },
        });
      },
    };
  },
};
