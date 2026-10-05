// Explicit international numbers keep their country. Never remove digits to
// manufacture a match; similar numbers and names may belong to different people.
const INVALID = /^(#(?:N\/A|REF!?|VALUE!?|NAME\??|DIV\/0!?|NULL!?|NUM!?|ERROR!?|CALC!?|SPILL!?)|n\/?a|nan|null|undefined|none|nenhum[ao]?|sem|vazio|-+|\.+|—|–)$/i;
const NATIONAL_LENGTHS = Object.freeze({
  "1": [10], "7": [10], "20": [10], "27": [9], "30": [10],
  "31": [9], "32": [8, 9], "33": [9], "34": [9], "39": [9, 10, 11],
  "44": [9, 10], "49": [10, 11], "52": [10], "54": [10, 11],
  "55": [10, 11], "56": [9], "57": [10], "61": [9], "81": [9, 10],
  "82": [9, 10], "86": [11], "91": [10], "351": [9], "353": [9],
});

export function isInvalidIdentity(value) {
  return value == null || !String(value).trim() || INVALID.test(String(value).trim());
}
export function normalizeName(value) {
  return isInvalidIdentity(value) ? null : String(value).normalize("NFC").trim().replace(/\s+/g, " ");
}
export function normalizeNameKey(value) {
  const name = normalizeName(value);
  return name ? name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US") : "";
}
export function normalizePhone(value, countryCode = "55") {
  if (isInvalidIdentity(value)) return null;
  const raw = String(value).trim();
  if (!/^(?:\+|00)?[\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  const explicit = raw.startsWith("+") || raw.startsWith("00");
  if (raw.startsWith("00")) digits = digits.slice(2);
  if (explicit) return /^[1-9]\d{6,14}$/.test(digits) ? digits : null;
  const code = String(typeof countryCode === "object" ? countryCode.countryCode ?? "55" : countryCode).replace(/^\+/, "");
  if (!/^[1-9]\d{0,2}$/.test(code)) return null;
  const lengths = NATIONAL_LENGTHS[code];
  if (!lengths) return null; // Unknown regions require +international format.
  if (digits.startsWith(code) && lengths.includes(digits.length - code.length)) return digits;
  if (code !== "55" && code !== "1" && digits.startsWith("0") && lengths.includes(digits.length - 1)) digits = digits.slice(1);
  if (!lengths.includes(digits.length)) return null;
  const full = code + digits;
  return /^[1-9]\d{6,14}$/.test(full) ? full : null;
}
export function extractPhoneFromDataId(dataId) {
  if (typeof dataId !== "string") return null;
  const match = /(?:^|_)([1-9]\d{6,14})@(?:c\.us|s\.whatsapp\.net)(?:_|$)/.exec(dataId);
  return match ? match[1] : null;
}
export function normalizeInternationalPhone(value) {
  return normalizePhone("+" + String(value ?? "").replace(/\D/g, ""));
}
