"use strict";

const path = require("node:path");

const PARSER_NAME = /^(?:validate|parse)[A-Z]/;

const FUNCTION_NODES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "TSFunctionType",
  "TSCallSignatureDeclaration",
  "TSMethodSignature",
  "TSConstructSignatureDeclaration",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
]);

function propertyName(node) {
  if (!node) return null;
  if (node.type === "Identifier" || node.type === "PrivateIdentifier") return node.name;
  return null;
}

function functionName(node) {
  if (node.id && node.id.type === "Identifier") return node.id.name;
  if (node.type === "TSMethodSignature" || node.type === "TSCallSignatureDeclaration") {
    return propertyName(node.key);
  }
  const parent = node.parent;
  if (!parent) return null;
  if (parent.type === "VariableDeclarator" && parent.init === node) return propertyName(parent.id);
  if (
    (parent.type === "MethodDefinition" ||
      parent.type === "Property" ||
      parent.type === "PropertyDefinition") &&
    parent.value === node
  ) {
    return propertyName(parent.key);
  }
  return null;
}

function isGuardParameter(fn, param) {
  const predicate = fn.returnType?.typeAnnotation;
  return (
    predicate?.type === "TSTypePredicate" &&
    predicate.parameterName.type === "Identifier" &&
    param.type === "Identifier" &&
    predicate.parameterName.name === param.name
  );
}

function unwrapType(node) {
  let current = node;
  while (
    current &&
    (current.type === "TSParenthesizedType" || current.type === "TSTypeAnnotation")
  ) {
    current = current.typeAnnotation;
  }
  return current;
}

function bannedParameterType(annotation, visitorKeys) {
  const type = unwrapType(annotation);
  if (!type) return null;
  if (type.type === "TSUnknownKeyword") return "unknown";
  if (
    type.type === "TSTypeReference" &&
    type.typeName.type === "Identifier" &&
    type.typeName.name === "Record" &&
    type.typeArguments &&
    type.typeArguments.params.length === 2 &&
    type.typeArguments.params[0].type === "TSStringKeyword" &&
    type.typeArguments.params[1].type === "TSUnknownKeyword"
  ) {
    return "Record<string, unknown>";
  }
  for (const key of visitorKeys[type.type] ?? []) {
    const children = Array.isArray(type[key]) ? type[key] : [type[key]];
    for (const child of children) {
      if (!child || FUNCTION_NODES.has(child.type)) continue;
      const banned = bannedParameterType(child, visitorKeys);
      if (banned) return banned;
    }
  }
  return null;
}

function isParameterName(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (parent.type === "AssignmentPattern" && parent.left === node) return isParameterName(parent);
  if (parent.type === "TSParameterProperty") return true;
  return Array.isArray(parent.params) && parent.params.includes(node);
}

function parameterAnnotation(param) {
  if (param.type === "AssignmentPattern") return parameterAnnotation(param.left);
  if (param.type === "RestElement") {
    return param.typeAnnotation ?? parameterAnnotation(param.argument);
  }
  if (param.type === "TSParameterProperty") return parameterAnnotation(param.parameter);
  return param.typeAnnotation ?? null;
}

function declarationName(node) {
  let current = node.parent;
  while (current) {
    if (FUNCTION_NODES.has(current.type) || current.type === "MethodDefinition") return null;
    if (
      current.type === "TSInterfaceDeclaration" ||
      current.type === "TSTypeAliasDeclaration" ||
      current.type === "ClassDeclaration"
    ) {
      return current.id && current.id.type === "Identifier" ? current.id.name : null;
    }
    current = current.parent;
  }
  return null;
}

function isRawAdapterInput(node, filename) {
  const name = declarationName(node);
  if (!name || !(/^(?:Raw|Unparsed)/.test(name) || /Input$/.test(name))) return false;
  const normalized = String(filename).split(path.sep).join("/");
  return (
    normalized === "src/adapters" ||
    normalized.startsWith("src/adapters/") ||
    normalized.includes("/src/adapters/")
  );
}

/**
 * Require every property and parameter to be present.
 * `?: never` remains available so a tagged union can exclude a field.
 * Optional fields are also available on a raw input type in src/adapters.
 * That type name starts with Raw or Unparsed, or ends with Input.
 */
const noOptionalProperty = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require every property and parameter to be present. Use null when there is no value.",
    },
    schema: [],
    messages: {
      optional:
        "Declare `{{name}}` on the type. Use `| null` when it can have no value. Do not mark it optional with `?`.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();

    function report(node, name) {
      context.report({
        node: node.key ?? node,
        messageId: "optional",
        data: { name: name ?? "property" },
      });
    }

    function isNeverType(node) {
      return (
        node.typeAnnotation &&
        node.typeAnnotation.typeAnnotation &&
        node.typeAnnotation.typeAnnotation.type === "TSNeverKeyword"
      );
    }

    function reportOptional(node, name) {
      if (isNeverType(node) || isRawAdapterInput(node, filename)) return;
      report(node, name);
    }

    return {
      TSPropertySignature(node) {
        if (node.optional) reportOptional(node, propertyName(node.key));
      },
      TSMethodSignature(node) {
        if (node.optional) report(node, propertyName(node.key));
      },
      TSAbstractMethodDefinition(node) {
        if (node.optional) report(node, propertyName(node.key));
      },
      PropertyDefinition(node) {
        if (node.optional) reportOptional(node, propertyName(node.key));
      },
      TSMappedType(node) {
        if (node.optional === true && !isRawAdapterInput(node, filename)) report(node, "property");
      },
      Identifier(node) {
        if (node.optional && isParameterName(node)) report(node, node.name);
      },
    };
  },
};

const noUndefinedType = {
  meta: {
    type: "problem",
    docs: {
      description: "Reject undefined in types. A missing value is null.",
    },
    schema: [],
    messages: {
      undefinedType: "`undefined` is not a missing value and it is not a failure. Use `null`.",
    },
  },
  create(context) {
    return {
      TSUndefinedKeyword(node) {
        context.report({ node, messageId: "undefinedType" });
      },
    };
  },
};

const unknownOnlyInParser = {
  meta: {
    type: "problem",
    docs: {
      description: "Allow unknown and Record<string, unknown> only on parser parameters.",
    },
    schema: [],
    messages: {
      parserOnly:
        "Keep `{{type}}` on a parser parameter. Name that function `validate...` or `parse...`, or pass a named value instead.",
    },
  },
  create(context) {
    function check(node) {
      const name = functionName(node);
      const allowedParser = name ? PARSER_NAME.test(name) : false;
      for (const param of node.params ?? []) {
        const banned = bannedParameterType(
          parameterAnnotation(param),
          context.sourceCode.visitorKeys,
        );
        if (!banned || allowedParser || isGuardParameter(node, param)) continue;
        context.report({
          node: param,
          messageId: "parserOnly",
          data: { type: banned },
        });
      }
    }

    const visitors = {};
    for (const type of FUNCTION_NODES) visitors[type] = check;
    return visitors;
  },
};

module.exports = {
  "no-optional-property": noOptionalProperty,
  "no-undefined-type": noUndefinedType,
  "unknown-only-in-parser": unknownOnlyInParser,
};
