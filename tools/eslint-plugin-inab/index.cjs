"use strict";

module.exports = {
  rules: {
    ...require("./interfaces.cjs"),
    ...require("./type-inference.cjs"),
    "only-jsdoc-comments": require("./comments.cjs"),
  },
};
