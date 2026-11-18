import { config } from "../src/config.js";
import { db } from "../src/store.js";
import { ensureSetupKey, setupNeeded } from "../src/bootstrap.js";
try {
  if (!setupNeeded())
    console.log(`Setup admin sudah selesai. Masuk: ${config.url}/app`);
  else {
    const token = ensureSetupKey();
    console.log(
      `Buka tautan setup pribadi ini di browser (berlaku 24 jam; jangan dibagikan):\n${config.url}/setup#key=${token}`,
    );
  }
} finally {
  db.close();
}
