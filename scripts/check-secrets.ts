import { runSecretLint } from "secretlint";
import { listCandidateFiles } from "./checks/tracked-paths.ts";

const files = listCandidateFiles(process.cwd()).filter((file) => file !== "package-lock.json");
if (files.length === 0) process.exit(0);

const result = await runSecretLint({
  cliOptions: {
    cwd: process.cwd(),
    filePathOrGlobList: [...files],
  },
  engineOptions: {
    formatter: "stylish",
    maskSecrets: true,
    configFilePath: ".secretlintrc.json",
  },
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) console.error(result.stderr.message);
if (result.exitStatus !== 0) process.exit(result.exitStatus);
