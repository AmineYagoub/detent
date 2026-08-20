import { createHash } from "node:crypto";

/**
 * T-016 — failure classification and signatures (X-5, X-7, D-14).
 *
 * Both are code, zero tokens. The classifier is **advisory**: it emits
 * `suspectedFlake` and nothing else that gates behavior. D-14 is explicit that
 * pattern matching must never absolve a real regression, so this module cannot
 * express "non-actionable" — a green isolated rerun is the sole evidence that
 * permits quarantine, and that decision belongs to the flake filter (T-022),
 * not here.
 */

const FLAKE_PATTERNS: readonly RegExp[] = [
  /\bETIMEDOUT\b/i,
  /\btimed?\s*out\b/i,
  /\bECONNREFUSED\b/i,
  /\bEADDRINUSE\b/i,
  /address already in use/i,
  /\bconnection reset\b/i,
  /\btemporar(?:y|ily) unavailable\b/i,
  /\b5\d\d Server Error\b/i,
  /\bflaky\b/i,
];

const TOOLCHAIN_PATTERNS: readonly RegExp[] = [
  /\bSyntaxError\b/i,
  /\blint\b.*\berror\b/i,
  /\bmypy\b.*\berror\b/i,
  /cannot find module/i,
  /ModuleNotFoundError/i,
  /\bTS\d{4}\b/,
  /error\[E\d{4}\]/i,
  /undefined reference/i,
  /ImportError/i,
];

/**
 * Informational only. No consumer may branch on this to skip the ladder — that
 * is what `suspectedFlake` plus a green rerun is for.
 */
type PatternClass = "flake-pattern" | "toolchain" | "assertion";

export interface Classification {
  /**
   * Advisory. True means "worth one isolated rerun", never "ignore this".
   * There is deliberately no field meaning non-actionable (D-14).
   */
  readonly suspectedFlake: boolean;
  readonly patternClass: PatternClass;
  readonly signature: string;
}

/** A timeout is treated as environmental until a rerun proves otherwise. */
export function classify(output: string, exitCode: number | null): Classification {
  const patternClass = patternClassOf(output, exitCode);
  return {
    suspectedFlake: patternClass === "flake-pattern",
    patternClass,
    signature: errorSignature(output),
  };
}

function patternClassOf(output: string, exitCode: number | null): PatternClass {
  if (exitCode === null) return "flake-pattern";
  if (FLAKE_PATTERNS.some((re) => re.test(output))) return "flake-pattern";
  if (TOOLCHAIN_PATTERNS.some((re) => re.test(output))) return "toolchain";
  return "assertion";
}

const TEST_ID = /(?:FAIL(?:ED)?|ERROR)[:\s]+([\w./:\\-]+(?:::[\w[\]-]+)?)/i;
const EXCEPTION = /\b([A-Z][A-Za-z]*(?:Error|Exception|Failure|Panic))\b/;
const FRAME = /File "([^"]+)", line \d+|at ([\w./$<>-]+:\d+)/;
const ASSERTION = /(?:AssertionError|assert(?:ion)?(?: failed)?)[:\s]*(.{0,120})/i;

/**
 * Volatile tokens are erased before hashing so that the same failure yields the
 * same signature across runs: hex addresses, long numbers (pids, timings, ports),
 * and `:line` suffixes.
 */
const VOLATILE = /0x[0-9a-fA-F]+|\b\d{4,}\b|:\d+/g;

/**
 * X-7: sha256(test_id | exception | top_frame | assertion_msg) over
 * volatility-normalized output.
 */
export function errorSignature(output: string): string {
  const parts = [
    firstMatch(TEST_ID, output),
    firstMatch(EXCEPTION, output),
    firstMatch(FRAME, output),
    firstMatch(ASSERTION, output),
  ].map((part) => part.replace(VOLATILE, "#"));
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function firstMatch(re: RegExp, text: string): string {
  const m = re.exec(text);
  if (m === null) return "";
  const group = m.slice(1).find((g) => g !== undefined && g !== "");
  return group ?? m[0];
}
