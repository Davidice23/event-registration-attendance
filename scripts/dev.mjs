import { spawn } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npmCli = process.env.npm_execpath;
const commands = ["dev:server", "dev:client"];
const children = commands.map((script) => spawn(
  npmCli ? process.execPath : npm,
  npmCli ? [npmCli, "run", script] : ["run", script],
  { stdio: "inherit", shell: !npmCli && process.platform === "win32" },
));
let stopping = false;

function stopAll(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill(signal);
  }
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(`Development process failed to start: ${error.message}`);
    stopAll();
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    if (!stopping && code !== 0) {
      process.exitCode = code ?? 1;
      stopAll();
    }
  });
}

process.on("SIGINT", () => stopAll("SIGINT"));
process.on("SIGTERM", () => stopAll("SIGTERM"));
