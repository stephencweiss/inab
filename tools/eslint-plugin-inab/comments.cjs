"use strict";

const DEFAULT_ALLOW = ["^approved:\\s*\\S", "^eslint-", "^@ts-", "^<reference\\b"];

function commentText(comment) {
  return comment.value.trim().replace(/^\/+\s*/, "");
}

function isJsdoc(comment) {
  return comment.type === "Block" && comment.value.startsWith("*");
}

module.exports = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Allow JSDoc comments and an explicit allowlist. Disallow every other comment.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      onlyJsdoc:
        "Only JSDoc comments are allowed. Start the comment with an allowed prefix and a reason to keep it.",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const patterns = (options.allow ?? DEFAULT_ALLOW).map((source) => new RegExp(source));

    return {
      Program() {
        const sourceCode = context.sourceCode ?? context.getSourceCode();
        for (const comment of sourceCode.getAllComments()) {
          if (isJsdoc(comment)) continue;
          const text = commentText(comment);
          if (patterns.some((pattern) => pattern.test(text))) continue;
          context.report({ loc: comment.loc, messageId: "onlyJsdoc" });
        }
      },
    };
  },
};
