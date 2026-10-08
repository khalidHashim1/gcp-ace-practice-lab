import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.DATA_MODE = "local";
process.env.LOCAL_DATA_DIR = mkdtempSync(path.join(tmpdir(), "ace-test-"));
