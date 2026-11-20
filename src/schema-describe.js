// Structural fingerprint of a SQLite database: columns, defaults, keys,
// indexes and CHECK constraints. Used to prove db/schema.sql matches a
// database created by the migrations in src/store.js.
export function describeSchema(db) {
  const squash = (sql) =>
    String(sql || "")
      .replace(/--[^\n]*/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
  const tables = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  const result = {};
  for (const { name, sql } of tables) {
    const indexes = db
      .prepare(`PRAGMA index_list("${name}")`)
      .all()
      .map((i) => ({
        name: i.name.startsWith("sqlite_autoindex") ? "(auto)" : i.name,
        unique: i.unique,
        partial: i.partial,
        columns: db
          .prepare(`PRAGMA index_info("${i.name}")`)
          .all()
          .map((c) => c.name),
        sql: squash(
          db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(i.name)
            ?.sql,
        ),
      }))
      .sort((a, b) => (a.name + a.columns).localeCompare(b.name + b.columns));
    result[name] = {
      columns: db
        .prepare(`PRAGMA table_info("${name}")`)
        .all()
        .map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk]),
      foreignKeys: db
        .prepare(`PRAGMA foreign_key_list("${name}")`)
        .all()
        .map((f) => [f.from, f.table, f.to]),
      indexes,
      checks: squash(sql).match(/check\((?:[^()]|\([^()]*\))*\)/g) || [],
      autoincrement: squash(sql).includes("autoincrement"),
    };
  }
  return result;
}

// Human-readable list of differences between two fingerprints.
export function schemaDifferences(actual, expected) {
  const out = [];
  for (const table of Object.keys(expected))
    if (!actual[table]) out.push(`Tabel hilang: ${table}`);
  for (const table of Object.keys(actual))
    if (!expected[table]) out.push(`Tabel tidak dikenal: ${table}`);
  for (const table of Object.keys(expected)) {
    if (!actual[table]) continue;
    for (const part of [
      "columns",
      "foreignKeys",
      "indexes",
      "checks",
      "autoincrement",
    ])
      if (
        JSON.stringify(actual[table][part]) !==
        JSON.stringify(expected[table][part])
      )
        out.push(`Berbeda: ${table}.${part}`);
  }
  return out;
}
