// OpenLiteSpeed can forward duplicate Origin headers (upstream issue #506).
// Accept repeated copies only when EVERY value exactly matches our configured origin.
// Never select the first value, ignore a foreign value, or disable origin validation.
export function originValues(rawHeaders = []) {
  const values = [];
  for (let i = 0; i < rawHeaders.length; i += 2)
    if (String(rawHeaders[i]).toLowerCase() === "origin")
      values.push(
        ...String(rawHeaders[i + 1])
          .split(",")
          .map((value) => value.trim()),
      );
  return values;
}
export function validOrigins(values, expected) {
  return values.every((value) => value === expected);
}
