import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { createSocket, type Socket } from "node:dgram";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  SANDBOX_EXEC,
  SCRATCH_SOURCE_LIMIT,
  SCRATCH_TIME_LIMIT_MS,
  SCRATCH_TOOL,
  runSandboxed,
  scratchRunner,
  seatbeltProfile,
  type SandboxInterpreter,
  type ScratchGrant,
} from "../../src/sessions/sandbox.js";
import { installRoots, probeSandbox } from "../../src/sessions/sandbox-probe.js";
import { scratchServer } from "../../src/sessions/scratch-server.js";
import { removeTree } from "../helpers.js";

/**
 * PRDR-285 — S-1‴'s sandbox: VALIDATE's reviewers run throwaway scripts, and
 * nothing a script does reaches past its own directory.
 *
 * The hostile fixture is the containment claim itself: a script that tries to
 * write the repository and beside its directory, read the operator's secret,
 * list the repository, shell out, and reach the network over TCP and UDP, and
 * that must manage none of it, whatever interpreter runs it. Those run where
 * the sandbox is, macOS's Seatbelt; everywhere else the probe reports the
 * sandbox off, and the tests of that run on every platform.
 */

const onMac = process.platform === "darwin" && existsSync(SANDBOX_EXEC);
/** PRDR-285: Seatbelt is macOS's alone; elsewhere these cases cannot run, and the probe's off cases below stand in. */
const itMac = onMac ? it : it.skip;
const PROBED = onMac ? await probeSandbox() : null;
const interpreters: readonly SandboxInterpreter[] = PROBED?.kind === "on" ? PROBED.interpreters : [];
const NODE = interpreters.find((i) => i.name === "node");
const PYTHON = interpreters.find((i) => i.name === "python3");
/** PRDR-285: a Mac with no python3 on its PATH offers node alone; the python3 case needs one. */
const itPython = PYTHON === undefined ? it.skip : it;
/** PRDR-285: the first python3 on PATH, unless it is the developer tools' stand-in, which may ask to install them instead of running. */
const PATH_PYTHON = (process.env["PATH"] ?? "").split(path.delimiter).filter((d) => path.isAbsolute(d)).map((d) => path.join(d, "python3")).find((p) => existsSync(p));
const itPathPython = onMac && PATH_PYTHON !== undefined && PATH_PYTHON !== "/usr/bin/python3" ? it : it.skip;

const trees: string[] = [];
const listeners: (Server | Socket)[] = [];
afterEach(() => {
  for (const t of trees.splice(0)) removeTree(t);
  for (const l of listeners.splice(0)) l.close();
});
afterAll(() => {
  delete process.env["DETENT_HOSTILE_CANARY"];
});

const real = (prefix: string): string => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  trees.push(dir);
  return dir;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("PRDR-285: the profile Seatbelt runs a script under (S-1‴)", () => {
  const profile = seatbeltProfile("/private/tmp/scratch-1", ["/opt/python"]);

  it("denies by default, and never allows everything", () => {
    expect(profile).toContain("(deny default)");
    expect(profile).not.toContain("(allow default)");
    expect(profile).not.toMatch(/\(allow file-read\*\)/u);
    expect(profile).not.toMatch(/\(allow file-write\*\)/u);
  });

  it("writes only the scratch directory, and /dev/null", () => {
    const writes = profile.split("\n").filter((l) => l.includes("file-write"));
    expect(writes).toEqual(['(allow file-write* (subpath "/private/tmp/scratch-1"))', '(allow file-write-data (literal "/dev/null"))']);
  });

  it("reads the system, the interpreter's install and the scratch directory, and nothing of the operator's", () => {
    const reads = profile.split("\n").find((l) => l.startsWith("(allow file-read* ")) ?? "";
    expect([...reads.matchAll(/\((?:subpath|literal) "([^"]+)"\)/gu)].map((m) => m[1])).toEqual([
      "/",
      "/System",
      "/usr",
      "/opt/python",
      "/private/tmp/scratch-1",
      "/dev/null",
      "/dev/random",
      "/dev/urandom",
    ]);
  });

  it("reads the metadata of the directories above what it reads, each alone, and of nothing beside them", () => {
    expect(profile.split("\n").filter((l) => l.includes("file-read-metadata"))).toEqual([
      '(allow file-read-metadata (literal "/") (literal "/opt") (literal "/private/tmp") (literal "/private"))',
    ]);
  });

  it("reaches no network, local included, and asks no system service to act for it", () => {
    expect(profile).toContain("(deny network*)");
    expect(profile).not.toMatch(/\(allow network/u);
    expect(profile).not.toContain("mach-lookup");
  });

  it("starts no process, and signals none", () => {
    expect(profile).not.toContain("process-fork");
    expect(profile).not.toContain("signal");
  });

  it("refuses a path it cannot quote, rather than writing a profile that means something else", () => {
    expect(() => seatbeltProfile('/tmp/a"b', [])).toThrow(/cannot quote/u);
    expect(() => seatbeltProfile("/tmp/a\\b", [])).toThrow(/cannot quote/u);
    expect(() => seatbeltProfile("/tmp/a\nb", [])).toThrow(/cannot quote/u);
    expect(() => seatbeltProfile("/tmp/scratch", ["relative/path"])).toThrow(/absolute/u);
    expect(() => seatbeltProfile("scratch", [])).toThrow(/absolute/u);
  });
});

/** Where a hostile script runs: a repository beside it holding a secret, and listeners that count what reaches them. */
interface Hostile {
  readonly base: string;
  readonly repo: string;
  readonly dir: string;
  readonly tcp: number;
  readonly udp: number;
  readonly reached: { tcp: number; udp: number };
}

async function hostile(): Promise<Hostile> {
  const base = real("detent-hostile-");
  const repo = path.join(base, "repo");
  const dir = path.join(base, "scratch");
  mkdirSync(repo);
  mkdirSync(dir);
  writeFileSync(path.join(repo, "secret.txt"), "the operator's secret\n");
  const reached = { tcp: 0, udp: 0 };
  const server = createServer((s) => {
    reached.tcp += 1;
    s.destroy();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const udp = createSocket("udp4");
  udp.on("message", () => (reached.udp += 1));
  await new Promise<void>((r) => udp.bind(0, "127.0.0.1", r));
  listeners.push(server, udp);
  const port = (a: unknown): number => (a as { port: number }).port;
  process.env["DETENT_HOSTILE_CANARY"] = "a secret in Detent's own environment";
  return { base, repo, dir, tcp: port(server.address()), udp: port(udp.address()), reached };
}

const ESCAPES = [
  "write the repository",
  "write beside the directory",
  "read the operator's secret",
  "list the repository",
  "stat the operator's secret",
  "signal Detent",
  "start a process",
  "shell out",
  "connect over tcp",
  "send over udp",
];

/** What a simulation needs, and gets: its own directory, the system's randomness and settings, `/dev/null`, and signals to itself. */
const MAY = ["write inside", "read the system's randomness", "count the processors", "use /dev/null", "signal itself"];

function nodeHostile(h: Hostile): string {
  const q = JSON.stringify;
  return `
const fs = require("node:fs"), net = require("node:net"), dgram = require("node:dgram"), cp = require("node:child_process");
const out = {};
const attempt = (name, fn) => { try { fn(); out[name] = "done"; } catch (e) { out[name] = "refused " + (e.code || e.message); } };
attempt("write inside", () => fs.writeFileSync("inside.txt", "mine"));
attempt("write the repository", () => fs.writeFileSync(${q(path.join(h.repo, "escape.txt"))}, "x"));
attempt("write beside the directory", () => fs.writeFileSync(${q(path.join(h.base, "escape.txt"))}, "x"));
attempt("read the operator's secret", () => fs.readFileSync(${q(path.join(h.repo, "secret.txt"))}, "utf8"));
attempt("list the repository", () => fs.readdirSync(${q(h.repo)}));
attempt("stat the operator's secret", () => fs.statSync(${q(path.join(h.repo, "secret.txt"))}));
attempt("signal Detent", () => process.kill(${String(process.pid)}, 0));
attempt("signal itself", () => process.kill(process.pid, 0));
attempt("read the system's randomness", () => { for (const d of ["/dev/random", "/dev/urandom"]) { const fd = fs.openSync(d, "r"); fs.readSync(fd, Buffer.alloc(8)); fs.closeSync(fd); } });
attempt("use /dev/null", () => { fs.writeFileSync("/dev/null", "x"); fs.readFileSync("/dev/null"); });
attempt("count the processors", () => { if (!(require("node:os").availableParallelism() > 0)) throw new Error("no count"); });
attempt("start a process", () => { const r = cp.spawnSync("/usr/bin/true"); if (r.error) throw r.error; if (r.status !== 0) throw new Error("status " + r.status); });
attempt("shell out", () => { const r = cp.spawnSync("/bin/sh", ["-c", "echo x > " + ${q(path.join(h.base, "shell.txt"))}]); if (r.error) throw r.error; if (r.status !== 0) throw new Error("status " + r.status); });
let pending = 2;
const settle = (name, value) => {
  if (name in out) return;
  out[name] = value;
  pending -= 1;
  if (pending === 0) { out.environment = JSON.stringify(process.env); console.log(JSON.stringify(out)); }
};
const udp = dgram.createSocket("udp4");
udp.unref();
udp.on("error", (e) => settle("send over udp", "refused " + e.code));
udp.send("x", ${h.udp}, "127.0.0.1", (e) => settle("send over udp", e ? "refused " + e.code : "done"));
const s = net.connect({ host: "127.0.0.1", port: ${h.tcp} });
s.on("connect", () => { settle("connect over tcp", "done"); s.destroy(); });
s.on("error", (e) => settle("connect over tcp", "refused " + e.code));
`;
}

function pythonHostile(h: Hostile): string {
  const q = JSON.stringify;
  return `
import json, os, socket, subprocess
out = {}
def attempt(name, fn):
    try:
        fn()
        out[name] = "done"
    except Exception as e:
        out[name] = "refused " + type(e).__name__
def shell():
    r = subprocess.run(["/bin/sh", "-c", "echo x > " + ${q(path.join(h.base, "shell.txt"))}])
    if r.returncode != 0:
        raise RuntimeError(r.returncode)
def fork():
    pid = os.fork()
    if pid == 0:
        os._exit(0)
    os.waitpid(pid, 0)
def randomness():
    for d in ("/dev/random", "/dev/urandom"):
        with open(d, "rb") as f:
            f.read(8)
def devnull():
    with open("/dev/null", "w") as f:
        f.write("x")
    with open("/dev/null") as f:
        f.read()
def processors():
    if not os.cpu_count():
        raise RuntimeError("no count")
attempt("write inside", lambda: open("inside.txt", "w").write("mine"))
attempt("write the repository", lambda: open(${q(path.join(h.repo, "escape.txt"))}, "w").write("x"))
attempt("write beside the directory", lambda: open(${q(path.join(h.base, "escape.txt"))}, "w").write("x"))
attempt("read the operator's secret", lambda: open(${q(path.join(h.repo, "secret.txt"))}).read())
attempt("list the repository", lambda: os.listdir(${q(h.repo)}))
attempt("stat the operator's secret", lambda: os.stat(${q(path.join(h.repo, "secret.txt"))}))
attempt("signal Detent", lambda: os.kill(${String(process.pid)}, 0))
attempt("signal itself", lambda: os.kill(os.getpid(), 0))
attempt("read the system's randomness", randomness)
attempt("use /dev/null", devnull)
attempt("count the processors", processors)
attempt("start a process", lambda: subprocess.run(["/usr/bin/true"], check=True))
attempt("fork", fork)
attempt("shell out", shell)
attempt("connect over tcp", lambda: socket.create_connection(("127.0.0.1", ${h.tcp}), timeout=3).close())
attempt("send over udp", lambda: socket.socket(socket.AF_INET, socket.SOCK_DGRAM).sendto(b"x", ("127.0.0.1", ${h.udp})))
out["environment"] = json.dumps(dict(os.environ))
print(json.dumps(out))
`;
}

async function runHostile(interpreter: SandboxInterpreter, source: (h: Hostile) => string): Promise<{ h: Hostile; out: Record<string, string> }> {
  const h = await hostile();
  const file = path.join(h.dir, interpreter.name === "node" ? "hostile.js" : "hostile.py");
  writeFileSync(file, source(h));
  const run = await runSandboxed({ exec: SANDBOX_EXEC, dir: h.dir, interpreter, file, timeLimitMs: 20_000 });
  expect(run.stopped, run.output).toBeNull();
  expect(run.exit, run.output).toBe(0);
  return { h, out: JSON.parse(run.output.trim().split("\n").at(-1) ?? "{}") as Record<string, string> };
}

function expectContained(h: Hostile, out: Record<string, string>, more: readonly string[] = []): void {
  for (const allowed of MAY) expect(out[allowed], allowed).toBe("done");
  expect(readFileSync(path.join(h.dir, "inside.txt"), "utf8")).toBe("mine");
  for (const escape of [...ESCAPES, ...more]) expect(out[escape], escape).toMatch(/^refused/u);
  expect(readdirSync(h.base).sort(), "nothing was written beside the scratch directory").toEqual(["repo", "scratch"]);
  expect(readdirSync(h.repo), "nor in the repository").toEqual(["secret.txt"]);
  expect(h.reached, "and nothing reached a listener").toEqual({ tcp: 0, udp: 0 });
  const { HOME, LANG, PATH, TMPDIR, ...rest } = JSON.parse(out["environment"] ?? "{}") as Record<string, string>;
  expect({ HOME, LANG, PATH, TMPDIR }, "its home and temporary directory are its own").toEqual({ HOME: h.dir, LANG: "en_US.UTF-8", PATH: "/usr/bin:/bin", TMPDIR: h.dir });
  expect(Object.keys(rest).filter((k) => !["PWD", "SHLVL", "_"].includes(k)), "no variable of Detent's crosses (SEC-4): the rest is the shell's own").toEqual([]);
}

describe("PRDR-285: a hostile script stays in its directory, whatever it contains (S-1‴)", () => {
  itMac("under node: every escape is refused, and the one write it may make lands", async () => {
    const { h, out } = await runHostile(NODE as SandboxInterpreter, nodeHostile);
    expectContained(h, out);
  });

  itPython("under python3: every escape is refused, and the one write it may make lands", async () => {
    const { h, out } = await runHostile(PYTHON as SandboxInterpreter, pythonHostile);
    expectContained(h, out, ["fork"]);
  });
});

describe("PRDR-285: a run ends, and says why (S-1‴)", () => {
  const script = (source: string): { dir: string; file: string } => {
    const dir = real("detent-limits-");
    const file = path.join(dir, "run.js");
    writeFileSync(file, source);
    return { dir, file };
  };

  itMac("hands back the exit and all the script printed on both streams, up to the limit, though it exits with more still unread", async () => {
    const { dir, file } = script('process.stdout.write("z".repeat(400000)); console.error("err"); process.exitCode = 3;');
    const run = await runSandboxed({ exec: SANDBOX_EXEC, dir, interpreter: NODE as SandboxInterpreter, file, outputLimit: 1024 * 1024 });
    expect(run).toMatchObject({ exit: 3, signal: null, stopped: null });
    expect(run.output.match(/z/gu)).toHaveLength(400000);
    expect(run.output).toContain("err");
  });

  itMac("leaves no timer behind once a run settles, so nothing keeps Detent waiting on it", async () => {
    const { dir, file } = script("");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      expect(await runSandboxed({ exec: SANDBOX_EXEC, dir, interpreter: NODE as SandboxInterpreter, file })).toMatchObject({ exit: 0 });
      expect(vi.getTimerCount(), "its time limit's timer is cleared with it").toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  itMac("stops a script at the time limit, never a hang", async () => {
    const { dir, file } = script('require("node:fs").writeFileSync("run.pid", String(process.pid)); for (;;) {}');
    const started = Date.now();
    const run = await runSandboxed({ exec: SANDBOX_EXEC, dir, interpreter: NODE as SandboxInterpreter, file, timeLimitMs: 1000 });
    expect(run).toMatchObject({ stopped: "time", signal: "SIGKILL" });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(alive(Number(readFileSync(path.join(dir, "run.pid"), "utf8"))), "the one process a run is, is stopped").toBe(false);
  });

  itMac("stops a script whose output passes the limit, and keeps what it printed first", async () => {
    const { dir, file } = script('const w = () => process.stdout.write("x".repeat(1024), w); w();');
    const run = await runSandboxed({ exec: SANDBOX_EXEC, dir, interpreter: NODE as SandboxInterpreter, file, outputLimit: 4096 });
    expect(run.stopped).toBe("output");
    expect(run.output.length).toBeLessThanOrEqual(4096);
    expect(run.output).toMatch(/^x{1024}/u);
  });

  itPython("sets a CPU limit of twice the wall clock, rounded up, which ends a run Detent no longer can", async () => {
    const dir = real("detent-limits-");
    const file = path.join(dir, "run.py");
    writeFileSync(file, "import resource\nprint(resource.getrlimit(resource.RLIMIT_CPU))\n");
    const short = await runSandboxed({ exec: SANDBOX_EXEC, dir, interpreter: PYTHON as SandboxInterpreter, file, timeLimitMs: 1200 });
    expect(short.output.trim()).toBe("(3, 3)");
    const byDefault = await runSandboxed({ exec: SANDBOX_EXEC, dir, interpreter: PYTHON as SandboxInterpreter, file });
    expect(byDefault.output.trim()).toBe("(240, 240)");
  });

  it("never throws for a run that cannot start: its failure is the run's result", async () => {
    const node: SandboxInterpreter = { name: "node", path: process.execPath, version: process.version, roots: [] };
    const missing = path.join(real("detent-limits-"), "gone");
    const run = await runSandboxed({ exec: SANDBOX_EXEC, dir: missing, interpreter: node, file: path.join(missing, "run.js") });
    expect(run.exit).toBeNull();
    expect(run.output).toMatch(/ENOENT/u);
  });
});

/** A stand-in for `sandbox-exec` that drops the profile and runs the command as it is: a sandbox that contains nothing. */
function fakeExec(body: string): string {
  const dir = real("detent-fake-exec-");
  const file = path.join(dir, "sandbox-exec");
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

describe("PRDR-285: the probe says whether this machine can sandbox a script (S-1‴)", () => {
  itMac("finds this Mac's sandbox, and offers node, the interpreter running Detent, with its version", () => {
    expect(PROBED?.kind).toBe("on");
    expect(NODE).toMatchObject({ path: realpathSync(process.execPath), version: process.version });
    for (const i of interpreters) expect(realpathSync(i.path), `${i.name} is named by its real path`).toBe(i.path);
  });

  it("is off on a platform it builds no sandbox for, and says which", async () => {
    expect(await probeSandbox({ platform: "linux" })).toEqual({ kind: "off", reason: "no sandbox is built for linux, only macOS's Seatbelt" });
  });

  it("is off when sandbox-exec is missing or cannot be run, and names where it looked", async () => {
    const probed = await probeSandbox({ platform: "darwin", exec: "/nonexistent/sandbox-exec" });
    expect(probed).toEqual({ kind: "off", reason: "/nonexistent/sandbox-exec, which runs macOS's Seatbelt, is missing or cannot be run" });
    const plain = path.join(real("detent-fake-exec-"), "sandbox-exec");
    writeFileSync(plain, "#!/bin/sh\n", { mode: 0o644 });
    expect(await probeSandbox({ platform: "darwin", exec: plain })).toEqual({ kind: "off", reason: `${plain}, which runs macOS's Seatbelt, is missing or cannot be run` });
  });

  it("is off when the sandbox lets its canary write outside its directory", async () => {
    const probed = await probeSandbox({ platform: "darwin", exec: fakeExec('shift 2\nexec "$@"'), python: null });
    expect(probed).toEqual({ kind: "off", reason: "the sandbox did not stop its canary writing outside its directory, so no script runs" });
  });

  itPathPython("is off when one interpreter's canary escapes, though another's is contained", async () => {
    const leaky = fakeExec(`case "$3" in\n  */node) shift 2; exec "$@" ;;\n  *) exec ${SANDBOX_EXEC} "$@" ;;\nesac`);
    expect(await probeSandbox({ exec: leaky, python: PATH_PYTHON as string })).toEqual({ kind: "off", reason: "the sandbox did not stop its canary writing outside its directory, so no script runs" });
  });

  itMac("is off when no interpreter starts, and says why of each", async () => {
    const probed = await probeSandbox({ node: "/nonexistent/node", python: "/nonexistent/python3" });
    expect(probed.kind === "off" ? probed.reason : "").toMatch(/^node at \/nonexistent\/node did not say its version: .+; python3 at \/nonexistent\/python3 did not say where it is installed: .+$/u);
    const saved = process.env["PATH"];
    process.env["PATH"] = real("detent-empty-path-");
    try {
      const none = await probeSandbox({ node: "/nonexistent/node" });
      expect(none.kind === "off" ? none.reason : "").toMatch(/; no python3 is on PATH$/u);
    } finally {
      process.env["PATH"] = saved;
    }
  });

  itMac("runs node by its real path, though it was named by a link", async () => {
    const link = path.join(real("detent-link-"), "node");
    symlinkSync(process.execPath, link);
    const probed = await probeSandbox({ node: link, python: null });
    expect(probed.kind === "on" ? probed.interpreters.map((i) => i.path) : []).toEqual([realpathSync(process.execPath)]);
  });

  itMac("is off when the sandbox lets its canary reach a listener, though it stops every write outside", async () => {
    const networked = fakeExec(`p=$(printf '%s' "$2" | sed 's/(deny network\\*)/(allow network*)/')\nshift 2\nexec ${SANDBOX_EXEC} -p "$p" "$@"`);
    const probed = await probeSandbox({ exec: networked, python: null });
    expect(probed).toEqual({ kind: "off", reason: "the sandbox did not stop its canary reaching a listener on this machine, so no script runs" });
  });

  it("is off when the sandbox cannot be applied, as when Detent itself runs sandboxed, and says how the canary ended", async () => {
    const refused = fakeExec('echo "sandbox-exec: sandbox_apply: Operation not permitted" >&2\nexit 71');
    expect(await probeSandbox({ platform: "darwin", exec: refused, python: null })).toEqual({
      kind: "off",
      reason: `node ${process.version} does not run in the sandbox: sandbox-exec: sandbox_apply: Operation not permitted`,
    });
    const silent = await probeSandbox({ platform: "darwin", exec: fakeExec("exit 71"), python: null });
    expect(silent, "a canary that said nothing is named by its exit").toEqual({ kind: "off", reason: `node ${process.version} does not run in the sandbox: exit 71` });
    const killed = await probeSandbox({ platform: "darwin", exec: fakeExec("kill -9 $$"), python: null });
    expect(killed, "and one a signal ended, by the signal").toEqual({ kind: "off", reason: `node ${process.version} does not run in the sandbox: ended by SIGKILL` });
  });

  itPathPython("offers the first python3 on PATH, named by the real path of the interpreter it runs", () => {
    const said = execFileSync(PATH_PYTHON as string, ["-I", "-S", "-c", "import os, sys; print(os.path.realpath(sys.executable))"], { encoding: "utf8" }).trim();
    expect(PYTHON).toMatchObject({ name: "python3", path: said });
  });

  itMac("offers only an interpreter that starts in the sandbox, and none it was told not to", async () => {
    const names = (s: Awaited<ReturnType<typeof probeSandbox>>) => (s.kind === "on" ? s.interpreters.map((i) => i.name) : []);
    expect(names(await probeSandbox({ python: "/nonexistent/python3" }))).toEqual(["node"]);
    expect(names(await probeSandbox({ python: null }))).toEqual(["node"]);
  });

  itMac("lets node read its own install, the directory its binary's directory is in", () => {
    expect(NODE?.roots).toEqual([path.dirname(path.dirname(realpathSync(process.execPath)))]);
  });

  itMac("reads no install inside the repository it is told of, and node starts without reading its own", async () => {
    const install = path.dirname(path.dirname(realpathSync(process.execPath)));
    const probed = await probeSandbox({ root: path.dirname(install), python: null });
    expect(probed.kind === "on" ? probed.interpreters.map((i) => i.roots) : null).toEqual([[]]);
  });

  itPathPython("does not offer a python3 installed inside the repository it is told of, which cannot start without reading its install", async () => {
    const prefix = execFileSync(PATH_PYTHON as string, ["-I", "-S", "-c", "import os, sys; print(os.path.realpath(sys.base_prefix))"], { encoding: "utf8" }).trim();
    const probed = await probeSandbox({ root: prefix, python: PATH_PYTHON as string });
    expect(probed.kind === "on" ? probed.interpreters.map((i) => i.name) : []).toEqual(["node"]);
  });

  it("never lets a script read what holds the operator's home or the repository, nor anything inside the repository", () => {
    const repo = real("detent-roots-");
    const home = realpathSync(homedir());
    const inside = path.join(repo, ".venv");
    const install = real("detent-install-");
    const underHome = path.join(home, ".nvm", "versions", "node", "v0-test");
    expect(installRoots(["/", home, path.dirname(home), path.dirname(repo), repo, inside, install, underHome, install], repo)).toEqual([install, underHome]);
  });
});

describe("PRDR-285: the tool as a session is served it (S-1‴)", () => {
  it("is one tool, `run`, always loaded, taking a script and one of the interpreters the sandbox offers", async () => {
    const node: SandboxInterpreter = { name: "node", path: process.execPath, version: process.version, roots: [] };
    const python: SandboxInterpreter = { name: "python3", path: "/usr/bin/python3", version: "3.0-test", roots: [] };
    const server = scratchServer({ dir: real("detent-round-"), exec: SANDBOX_EXEC, interpreters: [node, python] });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "detent-test", version: "1.0.0" });
    await server.instance.connect(serverSide);
    await client.connect(clientSide);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => `mcp__${server.name}__${t.name}`)).toEqual([SCRATCH_TOOL]);
      expect(tools[0]?.inputSchema.properties?.["interpreter"]).toMatchObject({ enum: ["node", "python3"] });
      expect(tools[0]?._meta?.["anthropic/alwaysLoad"], "never behind a tool search the session has no tool for").toBe(true);
      expect(server.timeout, "a call outlasts its run, whose own limit is what stops it").toBeGreaterThan(SCRATCH_TIME_LIMIT_MS);
      const refused = await client.callTool({ name: "run", arguments: { interpreter: "node", source: "x".repeat(SCRATCH_SOURCE_LIMIT + 1) } });
      expect((refused.content as { text: string }[])[0]?.text).toMatch(/^refused: the script is over 128 KiB/u);
    } finally {
      await client.close();
      await server.instance.close();
    }
  });
});

describe("PRDR-285: the tool a reviewer runs its scripts with (S-1‴)", () => {
  const grantOf = (dir: string, given: readonly SandboxInterpreter[]): ScratchGrant => ({ dir, exec: SANDBOX_EXEC, interpreters: given as ScratchGrant["interpreters"] });

  itMac("writes each script into the session's own directory, numbered, and runs it there", async () => {
    const dir = real("detent-round-");
    const grant = grantOf(dir, interpreters);
    const session = scratchRunner(grant);
    const first = await session({ interpreter: "node", source: "console.log(process.cwd())" });
    const second = await session({ interpreter: "node", source: "console.log(process.cwd())" });
    const other = await scratchRunner(grant)({ interpreter: "node", source: "console.log(process.cwd())" });
    const cwd = (text: string): string => text.trim().split("\n").at(-1) ?? "";
    expect(first).toContain("run-1.js");
    expect(second).toContain("run-2.js");
    expect(first).toContain(`node ${process.version}`);
    expect(path.dirname(cwd(first))).toBe(dir);
    expect(cwd(second)).toBe(cwd(first));
    expect(cwd(other), "another session's scripts are not this one's").not.toBe(cwd(first));
  });

  itMac("says which limit stopped a run", async () => {
    const text = await scratchRunner(grantOf(real("detent-round-"), interpreters), { timeLimitMs: 1000 })({ interpreter: "node", source: "for (;;) {}" });
    expect(text).toMatch(/^run-1\.js, node v[\d.]+: stopped at the time limit, 1 s; what it printed before follows\n/u);
    const flood = await scratchRunner(grantOf(real("detent-round-"), interpreters), { outputLimit: 2048 })({ interpreter: "node", source: 'const w = () => process.stdout.write("y".repeat(512), w); w();' });
    expect(flood).toMatch(/^run-1\.js, node v[\d.]+: stopped: its output passed the limit, 2 KiB; what it printed first follows\ny+$/u);
  });

  itMac("runs a script of exactly the size limit", async () => {
    const source = `//${"x".repeat(SCRATCH_SOURCE_LIMIT - 3)}\n`;
    expect(Buffer.byteLength(source)).toBe(SCRATCH_SOURCE_LIMIT);
    expect(await scratchRunner(grantOf(real("detent-round-"), interpreters))({ interpreter: "node", source })).toMatch(/: exit 0\n/u);
  });

  itMac("says which signal ended a run, and names the CPU limit's", async () => {
    const ended = (signal: string): string => `process.kill(process.pid, ${JSON.stringify(signal)}); setTimeout(() => {}, 5000);`;
    expect(await scratchRunner(grantOf(real("detent-round-"), interpreters))({ interpreter: "node", source: ended("SIGXCPU") })).toMatch(/^run-1\.js, node v[\d.]+: ended by SIGXCPU, the CPU limit\n$/u);
    expect(await scratchRunner(grantOf(real("detent-round-"), interpreters))({ interpreter: "node", source: ended("SIGTERM") })).toMatch(/^run-1\.js, node v[\d.]+: ended by SIGTERM\n$/u);
  });

  itPython("runs python3 isolated, so no PYTHON variable, user site or script directory reaches a script", async () => {
    const text = await scratchRunner(grantOf(real("detent-round-"), interpreters))({ interpreter: "python3", source: "import os, sys\nprint(sys.flags.isolated, os.getcwd() in sys.path)" });
    expect(text).toMatch(/: exit 0\n1 False\n$/u);
  });

  itPython("names a python3 script as one", async () => {
    expect(await scratchRunner(grantOf(real("detent-round-"), interpreters))({ interpreter: "python3", source: "print(1)" })).toMatch(/^run-1\.py, python3 [\d.]+: exit 0\n1\n$/u);
  });

  it("refuses an interpreter it was not given, and a script over the limit, and runs nothing", async () => {
    const dir = real("detent-round-");
    const node: SandboxInterpreter = { name: "node", path: process.execPath, version: process.version, roots: [] };
    const session = scratchRunner(grantOf(dir, [node]));
    expect(await session({ interpreter: "ruby", source: "puts 1" })).toMatch(/not one of node/u);
    expect(await session({ interpreter: "node", source: "x".repeat(SCRATCH_SOURCE_LIMIT + 1) })).toMatch(/limit/u);
    expect(await session({ interpreter: "node", source: "é".repeat(SCRATCH_SOURCE_LIMIT / 2 + 1) }), "the limit is in bytes, not characters").toMatch(/over 128 KiB/u);
    expect(readdirSync(dir), "nothing was written, and nothing ran").toEqual([]);
  });
});
