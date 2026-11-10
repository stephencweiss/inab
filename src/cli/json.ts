export function formatJson(value: object, stream: NodeJS.WriteStream = process.stdout) {
  return JSON.stringify(value, null, stream.isTTY ? 2 : 0);
}

export function writeJson(value: object, stream: NodeJS.WriteStream = process.stdout) {
  stream.write(`${formatJson(value, stream)}\n`);
}
