/** The input is malformed: not the format it claims to be, or an offset points outside the file. */
export class FormatError extends Error {
  name = "FormatError";
}

/** The input is well-formed but exceeds a resource limit, so it was not examined. */
export class LimitError extends Error {
  name = "LimitError";
}
