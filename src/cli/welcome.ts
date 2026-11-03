export const cliVersion = "0.0.1";

const banner = `
    ____   _   __   ___     ____
   /  _/  / | / /  /   |   / __ )
   / /   /  |/ /  / /| |  / __  |
 _/ /   / /|  /  / ___ | / /_/ /
/___/  /_/ |_/  /_/  |_|/_____/
`;

const styles = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

export function terminalWelcome(interactive: boolean, args: readonly string[]) {
  if (!interactive || args.includes("--json") || args.includes("--version")) return "";
  return `${styles.cyan}${banner}${styles.reset}\n${styles.bold}INAB CLI${styles.reset}  ${styles.green}v${cliVersion}${styles.reset}\n${styles.dim}I Need A Budget (INAB) CLI - Personal envelope budgeting for one household.${styles.reset}\n\n`;
}
