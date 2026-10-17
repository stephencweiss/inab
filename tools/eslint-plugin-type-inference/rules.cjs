"use strict";

const { getParserServices } = require("@typescript-eslint/utils/eslint-utils");
const ts = require("typescript");

function isAnyOrError(type) {
  return Boolean(type.flags & ts.TypeFlags.Any) || type.intrinsicName === "error";
}

function sameType(checker, left, right) {
  if (!left || !right) return false;
  if (isAnyOrError(left) || isAnyOrError(right)) return false;
  return checker.isTypeAssignableTo(left, right) && checker.isTypeAssignableTo(right, left);
}

function parameterAnnotation(param) {
  if (!param) return null;
  if (param.type === "AssignmentPattern" || param.type === "TSParameterProperty") {
    return parameterAnnotation(param.left ?? param.parameter);
  }
  return param.typeAnnotation?.typeAnnotation ?? null;
}

function isContextSensitiveLiteral(node) {
  return node.type === "ObjectExpression" || node.type === "ArrayExpression";
}

function isNamedGuard(fn) {
  const parent = fn.parent;
  if (!parent) return false;
  if (parent.type === "VariableDeclarator" && parent.init === fn) return true;
  if (
    (parent.type === "Property" ||
      parent.type === "PropertyDefinition" ||
      parent.type === "MethodDefinition") &&
    parent.value === fn
  ) {
    return true;
  }
  return false;
}

module.exports = {
  "no-redundant-type": {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        redundant:
          "This annotation copies the type of the value. Remove it so the type can follow the value.",
        parameter:
          "This callback parameter already has a type from the function it is passed to. Remove the annotation.",
        predicate:
          "This type predicate copies a type onto a callback. Use a boolean check, or name a guard function when the predicate is the point of that function.",
      },
    },
    create(context) {
      const services = getParserServices(context);
      const checker = services.program.getTypeChecker();

      function reportIfSame(annotationNode, valueNode, messageId) {
        const annotationType = services.getTypeFromTypeNode(annotationNode);
        const valueType = services.getTypeAtLocation(valueNode);
        if (!sameType(checker, annotationType, valueType)) return;
        context.report({ node: annotationNode, messageId });
      }

      return {
        VariableDeclarator(node) {
          const annotation = node.id.typeAnnotation?.typeAnnotation;
          if (!annotation || !node.init || isContextSensitiveLiteral(node.init)) return;
          reportIfSame(annotation, node.init, "redundant");
        },
        PropertyDefinition(node) {
          const annotation = node.typeAnnotation?.typeAnnotation;
          if (!annotation || !node.value || node.readonly || isContextSensitiveLiteral(node.value))
            return;
          reportIfSame(annotation, node.value, "redundant");
        },
        "ArrowFunctionExpression, FunctionExpression"(node) {
          const predicate = node.returnType?.typeAnnotation;
          if (predicate?.type === "TSTypePredicate" && !isNamedGuard(node)) {
            context.report({ node: predicate, messageId: "predicate" });
          }

          node.params.forEach((param, index) => {
            const annotation = parameterAnnotation(param);
            if (!annotation) return;
            const contextual = services.getContextualType(node);
            if (!contextual) return;
            const tsFunction = services.esTreeNodeToTSNodeMap.get(node);
            const signatures = checker.getSignaturesOfType(contextual, ts.SignatureKind.Call);
            const annotationType = services.getTypeFromTypeNode(annotation);
            const matches = signatures.some((signature) => {
              const symbol = signature.getParameters()[index];
              if (!symbol) return false;
              const parameterType = checker.getTypeOfSymbolAtLocation(symbol, tsFunction);
              return sameType(checker, annotationType, parameterType);
            });
            if (matches) context.report({ node: annotation, messageId: "parameter" });
          });
        },
      };
    },
  },
};
