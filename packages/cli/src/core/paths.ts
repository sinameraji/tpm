import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

export interface UserPaths {
  root: string;
  configYaml: string;
  deviceJson: string;
  licenseJson: string;
}

export interface ProjectPaths {
  root: string;
  dbFile: string;
  artifactsDir: string;
  configYaml: string;
}

export function userPaths(homeDir: string = os.homedir()): UserPaths {
  const root = path.join(homeDir, ".tpm");
  return {
    root,
    configYaml: path.join(root, "config.yaml"),
    deviceJson: path.join(root, "device.json"),
    licenseJson: path.join(root, "license.json"),
  };
}

export function projectPaths(projectRoot: string = process.cwd()): ProjectPaths {
  const root = path.join(projectRoot, ".tpm");
  return {
    root,
    dbFile: path.join(root, "tpm.sqlite"),
    artifactsDir: path.join(root, "artifacts"),
    configYaml: path.join(root, "config.yaml"),
  };
}

export function ensureDir(dirPath: string, mode = 0o700): void {
  fs.mkdirSync(dirPath, { recursive: true, mode });
}
