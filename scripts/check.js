import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
for (const dir of ["src", "public", "scripts", "test"])
  for (const name of readdirSync(dir)) {
    if (name.endsWith(".js")) {
      const result = spawnSync(
        process.execPath,
        ["--check", `${dir}/${name}`],
        { stdio: "inherit" },
      );
      if (result.status) process.exit(result.status);
    }
  }
