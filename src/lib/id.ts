const ALPHABET = "0123456789abcdefghijkmnpqrstuvwxyz"; // no l/o to stay readable

/** URL-friendly random id. Uses the runtime CSPRNG (available in Workers). */
export function shortId(len = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/** Longer secret, used as the organiser's admin token. */
export function token(len = 28): string {
  return shortId(len);
}
