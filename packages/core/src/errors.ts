export class HarnessError extends Error {
  readonly code: string;

  constructor(message: string, code = "HARNESS_ERROR") {
    super(message);
    this.name = "HarnessError";
    this.code = code;
  }
}
