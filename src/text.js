const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
const MAX_CHARS = 300;

/** Makes a string from an untrusted app safe to print: no control or bidi characters, bounded length. */
export function clean(s) {
  const out = String(s).replace(UNSAFE, "�");
  return out.length > MAX_CHARS ? `${out.slice(0, MAX_CHARS)}…` : out;
}
