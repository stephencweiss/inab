import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import ts from "typescript";

type Layer = "domain" | "application" | "cli" | "composition" | "other";
type Dependency = { readonly node: ts.Node; readonly target: string | null };

function layer(file: string): Layer {
  if (file === "bootstrap.ts") return "composition";
  const directory = file.split("/")[0];
  if (["accounts", "budget", "lib"].includes(directory ?? "")) return "domain";
  if (directory === "application") return "application";
  if (directory === "cli") return "cli";
  return "other";
}

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.[cm]?tsx?$/.test(entry.name) ? [file] : [];
  });
}

function literalTarget(node: ts.Node | undefined): string | null {
  return node !== undefined && ts.isStringLiteralLike(node) ? node.text : null;
}

function dependency(node: ts.Node): Dependency | null {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    if (node.moduleSpecifier === undefined) return null;
    return { node, target: literalTarget(node.moduleSpecifier) };
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return { node, target: literalTarget(node.moduleReference.expression) };
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return { node, target: literalTarget(node.argument.literal) };
  }
  if (ts.isCallExpression(node) && isModuleCall(node)) {
    return { node, target: literalTarget(node.arguments[0]) };
  }
  return null;
}

function isModuleCall(node: ts.CallExpression): boolean {
  return (
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === "require")
  );
}

function permits(from: Layer, to: Layer): boolean {
  if (to === "domain") return true;
  if (from === "application") return to === "application";
  return from === "cli" && ["cli", "application", "composition"].includes(to);
}

function compilerOptions(root: string): ts.CompilerOptions {
  const configPath = path.join(root, "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error !== undefined)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const errors = parsed.errors.filter((error) => error.code !== 18003);
  if (errors.length > 0)
    throw new Error(
      errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n")).join("\n"),
    );
  return parsed.options;
}

function permitsDomainFile(fromFile: string, targetFile: string, root: string): boolean {
  const fromDirectory = path.relative(path.join(root, "src"), fromFile).split(path.sep)[0];
  const targetDirectory = targetFile.split("/")[0];
  return targetDirectory === fromDirectory || targetDirectory === "lib";
}

function dependencyProblem(
  from: Layer,
  target: string | null,
  file: string,
  root: string,
  options: ts.CompilerOptions,
): string | null {
  if (target === null)
    return "Computed module imports cannot be checked. Use a literal module path.";
  if (isBuiltin(target)) {
    return from === "cli" && target !== "node:sqlite" && target !== "sqlite"
      ? null
      : `Forbidden runtime dependency: ${target}.`;
  }
  const resolved = ts.resolveModuleName(target, file, options, ts.sys).resolvedModule;
  if (resolved === undefined) return `Cannot resolve dependency: ${target}.`;
  const relative = path
    .relative(path.join(root, "src"), resolved.resolvedFileName)
    .split(path.sep)
    .join("/");
  if (relative.startsWith("../") || path.isAbsolute(relative) || resolved.isExternalLibraryImport) {
    return `External dependency is not allowed: ${target}.`;
  }
  const allowed =
    from === "domain" ? permitsDomainFile(file, relative, root) : permits(from, layer(relative));
  return allowed ? null : `Forbidden ${from} dependency: ${target} (${relative}).`;
}

export function checkBoundaries(root: string): readonly string[] {
  const options = compilerOptions(root);
  const problems: string[] = [];
  for (const file of sourceFiles(path.join(root, "src"))) {
    const relative = path.relative(path.join(root, "src"), file).split(path.sep).join("/");
    const from = layer(relative);
    if (from === "other" || from === "composition") continue;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node): void {
      const imported = dependency(node);
      if (imported !== null) {
        const message = dependencyProblem(from, imported.target, file, root, options);
        if (message !== null) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          problems.push(`src/${relative}:${position.line + 1}: ${message}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return problems;
}
