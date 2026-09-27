import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { SANDBOX_EXEC, runSandboxed, type InterpreterName, type Sandbox, type SandboxInterpreter, type SandboxRun } from "./sandbox.js";

/**
 * S-1⁗ (PRDR-285) — whether this machine can sandbox a reviewer's script, and
 * with which interpreters.
 *
 * Nothing is taken on trust. For each interpreter a canary runs in the sandbox
 * exactly as a script would: it must write its own directory, failing which it
 * throws and exits unclean, and must fail to write beside it and to reach a
 * listener this process opens. A sandbox that
 * let either through contains nothing, and simulation is off. So is one that
 * cannot be applied, as when Detent itself runs sandboxed. An interpreter that
 * does not start in the sandbox is not offered, and the others still are.
 */

export interface ProbeOptions {
  readonly platform?: NodeJS.Platform;
  readonly exec?: string;
  /** The repository: an install inside it, or around it, is never read. */
  readonly root?: string;
  /** The python3 to offer; null offers none; absent, the first on `PATH`. */
  readonly python?: string | null;
  /** The node to offer; absent, the one running Detent. */
  readonly node?: string;
}

const off = (reason: string): Sandbox => ({ kind: "off", reason });

const firstLine = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split("\n")[0] ?? "";

const executable = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const realOr = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    /* A path that does not resolve is judged as it was given. */
    return p;
  }
};

const within = (inner: string, outer: string): boolean => {
  const rel = path.relative(outer, inner);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
};

/**
 * What of an interpreter's install the sandbox lets a script read. Never one
 * that would open more than the install: not a directory holding the
 * operator's home or the repository, `/` among them, and nothing inside the
 * repository.
 */
export function installRoots(candidates: readonly string[], root: string | undefined): string[] {
  const home = realOr(homedir());
  const repo = root === undefined ? null : realOr(root);
  const opensMore = (c: string): boolean => within(home, c) || (repo !== null && (within(repo, c) || within(c, repo)));
  return [...new Set(candidates.map(realOr))].filter((c) => !opensMore(c));
}

const PLAIN = { encoding: "utf8", timeout: 10_000, env: { PATH: "/usr/bin:/bin" } } as const;

function nodeOf(given: string, root: string | undefined): SandboxInterpreter | string {
  try {
    const real = realpathSync(given);
    const version = execFileSync(real, ["--version"], PLAIN).trim();
    return { name: "node", path: real, version, roots: installRoots([path.dirname(path.dirname(real))], root) };
  } catch (err) {
    return `node at ${given} did not say its version: ${firstLine(err)}`;
  }
}

const onPath = (name: string): string | null =>
  (process.env["PATH"] ?? "").split(path.delimiter).map((d) => path.join(d, name)).find((p) => path.isAbsolute(p) && executable(p)) ?? null;

/** `/usr/bin/python3` stands in for the developer tools, and without them it asks the operator to install them instead of running. */
const developerTools = (): boolean => {
  try {
    execFileSync("/usr/bin/xcode-select", ["-p"], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
};

const INTROSPECT =
  "import json, os, sys; print(json.dumps({'executable': os.path.realpath(sys.executable), 'prefixes': sorted({os.path.realpath(p) for p in " +
  "(sys.prefix, sys.base_prefix, sys.exec_prefix, sys.base_exec_prefix)}), 'version': sys.version.split()[0]}))";

const introspection = z.object({ executable: z.string(), prefixes: z.array(z.string()), version: z.string() });

function pythonOf(given: string | null | undefined, root: string | undefined): SandboxInterpreter | string | null {
  if (given === null) return null;
  const found = given ?? onPath("python3");
  if (found === null) return "no python3 is on PATH";
  if (found === "/usr/bin/python3" && !developerTools()) return "python3 is the stand-in for the developer tools, which are not installed";
  try {
    const said = introspection.parse(JSON.parse(execFileSync(found, ["-I", "-S", "-c", INTROSPECT], PLAIN)));
    return { name: "python3", path: said.executable, version: said.version, roots: installRoots([path.dirname(said.executable), ...said.prefixes], root) };
  } catch (err) {
    return `python3 at ${found} did not say where it is installed: ${firstLine(err)}`;
  }
}

/** Each canary writes `in.txt` where it runs, tries to write `beside`, and tries to reach `port`; "connected" means it did. */
const CANARY: Readonly<Record<InterpreterName, (beside: string, port: number) => string>> = {
  node: (beside, port) =>
    [
      'const fs = require("node:fs");',
      'fs.writeFileSync("in.txt", "in");',
      `try { fs.writeFileSync(${JSON.stringify(beside)}, "out"); } catch (refused) { process.exitCode = 0; }`,
      `const s = require("node:net").connect({ host: "127.0.0.1", port: ${String(port)} });`,
      's.on("connect", () => { console.log("connected"); s.destroy(); });',
      's.on("error", () => { process.exitCode = 0; });',
    ].join("\n"),
  python3: (beside, port) =>
    [
      "import socket",
      'open("in.txt", "w").write("in")',
      "try:",
      `    open(${JSON.stringify(beside)}, "w").write("out")`,
      "except OSError:",
      "    pass",
      "try:",
      `    socket.create_connection(("127.0.0.1", ${String(port)}), timeout=5).close()`,
      '    print("connected")',
      "except OSError:",
      "    pass",
    ].join("\n"),
};

/** What a canary last said, or, when it said nothing, how it ended. */
function lastWords(run: SandboxRun): string {
  const said = run.output.trim().split("\n").at(-1) ?? "";
  if (said !== "") return said;
  return run.exit === null ? `ended by ${run.signal ?? "a signal"}` : `exit ${String(run.exit)}`;
}

/** An escape, which turns the sandbox off; or why the interpreter is not offered, null when it is. */
type Verdict = { readonly escaped: true; readonly reason: string } | { readonly escaped: false; readonly reason: string | null };

async function canary(exec: string, interpreter: SandboxInterpreter): Promise<Verdict> {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "detent-probe-")));
  const dir = path.join(base, "in");
  const beside = path.join(base, "beside.txt");
  mkdirSync(dir);
  let reached = false;
  const server = createServer((socket) => {
    reached = true;
    socket.destroy();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const file = path.join(dir, interpreter.name === "python3" ? "canary.py" : "canary.js");
    writeFileSync(file, CANARY[interpreter.name](beside, (server.address() as AddressInfo).port));
    const run = await runSandboxed({ exec, dir, interpreter, file, timeLimitMs: 15_000 });
    if (existsSync(beside)) return { escaped: true, reason: "the sandbox did not stop its canary writing outside its directory, so no script runs" };
    if (reached || run.output.includes("connected")) return { escaped: true, reason: "the sandbox did not stop its canary reaching a listener on this machine, so no script runs" };
    if (run.exit !== 0) return { escaped: false, reason: `${interpreter.name} ${interpreter.version} does not run in the sandbox: ${lastWords(run)}` };
    return { escaped: false, reason: null };
  } finally {
    server.close();
    rmSync(base, { recursive: true, force: true });
  }
}

/** Probed once per validation that runs a round: macOS's Seatbelt, and the interpreters its canaries prove. */
export async function probeSandbox(opts: ProbeOptions = {}): Promise<Sandbox> {
  const platform = opts.platform ?? process.platform;
  if (platform !== "darwin") return off(`no sandbox is built for ${platform}, only macOS's Seatbelt`);
  const exec = opts.exec ?? SANDBOX_EXEC;
  if (!executable(exec)) return off(`${exec}, which runs macOS's Seatbelt, is missing or cannot be run`);
  const offered: SandboxInterpreter[] = [];
  const why: string[] = [];
  for (const found of [nodeOf(opts.node ?? process.execPath, opts.root), pythonOf(opts.python, opts.root)]) {
    if (found === null) continue;
    if (typeof found === "string") {
      why.push(found);
      continue;
    }
    const verdict = await canary(exec, found);
    if (verdict.escaped) return off(verdict.reason);
    if (verdict.reason === null) offered.push(found);
    else why.push(verdict.reason);
  }
  const [first, ...rest] = offered;
  return first === undefined ? off(why.join("; ")) : { kind: "on", exec, interpreters: [first, ...rest] };
}
