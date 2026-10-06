// openssl dgst -sha256 -hmac test-channel-secret -binary | openssl base64 -A
// stdinはbodyのUTF-8バイトそのもの（末尾改行なし）。すべてダミー値。
export const WEBHOOK_SIGNATURE = Object.freeze({
  body: '{"destination":"U_test_destination","events":[]}',
  secret: "test-channel-secret",
  signature: "0btRsFLi8HLqDhnSdlrpIPbn2jqVwlua7ZXrwWCgXYY=",
});
