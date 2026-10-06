// 公式「署名を検証する」: 生のUTF-8 body、channel secret、HMAC-SHA256、Base64。
export async function verifySignature(
  body: ArrayBuffer,
  signature: string,
  secret: string,
): Promise<boolean> {
  // SHA-256は32バイト。末尾=と未使用2ビットが0の標準Base64に限定する。
  if (!secret || !/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/u.test(signature))
    return false;
  const decoded = Uint8Array.from(atob(signature), (character) =>
    character.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // Web Cryptoの検証を使い、JavaScriptの文字列比較でMACを照合しない。
  return crypto.subtle.verify("HMAC", key, decoded, body);
}
