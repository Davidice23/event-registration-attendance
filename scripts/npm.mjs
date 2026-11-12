import { spawnSync } from "node:child_process";

export function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath;
  const executable = npmCli ? process.execPath : (process.platform === "win32" ? "npm.cmd" : "npm");
  const executableArgs = npmCli ? [npmCli, ...args] : args;
  return spawnSync(executable, executableArgs, {
    ...options,
    shell: !npmCli && process.platform === "win32",
  });
}
