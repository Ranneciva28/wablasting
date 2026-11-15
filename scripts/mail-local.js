import { config } from "../src/config.js";
import { db, decrypt } from "../src/store.js";
if (config.production || config.smtp)
  throw Error(
    "Local mail preview is disabled when SMTP / production is configured",
  );
for (const mail of db
  .prepare("SELECT * FROM mail WHERE status='pending' ORDER BY created")
  .all())
  console.log(JSON.stringify(JSON.parse(decrypt(mail.payload)), null, 2));
db.close();
