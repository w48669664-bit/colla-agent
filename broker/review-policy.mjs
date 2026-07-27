export function extractJsonPayload(text) {
  const value = String(text || "");
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ||
    value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

export function mustFixSignature(text) {
  const data = extractJsonPayload(text);
  const findings = Array.isArray(data?.mustFix) && data.mustFix.length
    ? data.mustFix
    : [];
  if (!findings.length) return "";
  return JSON.stringify(findings)
    .toLowerCase()
    .replace(/\b(?:round|r)\s*\d+\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_200);
}

export function hasRepeatedMustFix(responses, threshold = 3) {
  if (!Array.isArray(responses) || responses.length < threshold) return false;
  const signatures = responses.slice(-threshold).map(mustFixSignature);
  return Boolean(
    signatures[0] &&
    signatures.every((signature) => signature === signatures[0]),
  );
}
