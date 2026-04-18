import { TPM_VERSION } from "@tpm/shared";

export async function run(_argv: string[]): Promise<void> {
  // M2 fills in Commander.js command tree. M1 scaffold only.
  process.stdout.write(`tpm ${TPM_VERSION}\n`);
}
