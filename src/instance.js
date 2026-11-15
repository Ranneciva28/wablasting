import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { dataDir } from "./store.js";
// Single-node SQLite deployment: refuse a second worker sharing this data directory.
export function lockInstance() {
  const path = resolve(dataDir, "server.lock");
  try {
    const fd = openSync(path, "wx", 0o600);
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return () => {
      try {
        unlinkSync(path);
      } catch {}
    };
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const pid = Number(readFileSync(path, "utf8"));
    if (!Number.isSafeInteger(pid) || pid < 1)
      throw Error("Invalid server.lock; inspect it before removing");
    try {
      process.kill(pid, 0);
    } catch (err) {
      if (err.code === "ESRCH") {
        unlinkSync(path);
        return lockInstance();
      }
      throw err;
    }
    throw Error(
      "Another server is using this DATA_DIR. Run exactly one replica.",
    );
  }
}
