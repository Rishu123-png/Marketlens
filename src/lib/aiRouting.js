/** Describe the selected credential route without ever handling secret values. */
export function credentialSelection(credential, sharedFallback) {
  if (!credential) return { mode: "unknown", name: "not reported" };
  const selected = credential.selected ?? credential.mode;
  if (selected === "dedicated") {
    return { mode: "dedicated", name: credential.envName || credential.envVarName || "dedicated key" };
  }
  if (selected === "shared") {
    return { mode: "shared", name: sharedFallback?.envName || "shared fallback" };
  }
  if (selected === "none") return { mode: "none", name: "none" };
  return { mode: "unknown", name: "not reported" };
}
