import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

export function validateProfile(profile) {
  if (!profile || typeof profile !== "object" || !/^[a-z][a-z0-9-]{0,39}$/.test(profile.id ?? "")
      || typeof profile.probe !== "function" || !Array.isArray(profile.components)
      || profile.components.length < 1 || profile.components.length > 32)
    throw new Error("Invalid project-owned status profile");
  const ids = new Set();
  for (const component of profile.components) {
    if (!component || Object.keys(component).sort().join() !== "id,name"
        || !/^[a-z][a-z0-9-]{0,39}$/.test(component.id ?? "") || ids.has(component.id)
        || typeof component.name !== "string" || component.name.length < 1 || component.name.length > 160
        || /[\r\n]/u.test(component.name)) throw new Error("Invalid status component");
    ids.add(component.id);
  }
  if (!Array.isArray(profile.outageComponents) || !profile.outageComponents.length
      || new Set(profile.outageComponents).size !== profile.outageComponents.length
      || !profile.outageComponents.every(id => ids.has(id)))
    throw new Error("Explicit outage components are required");
  if (!profile.targetVariables || typeof profile.targetVariables !== "object" || Array.isArray(profile.targetVariables)
      || !Object.keys(profile.targetVariables).length || Object.keys(profile.targetVariables).length > 32
      || !Object.entries(profile.targetVariables).every(([key, variable]) => /^[a-z][a-z0-9-]{0,39}$/.test(key) && /^STATUS_[A-Z0-9_]+_URL$/.test(variable)))
    throw new Error("Invalid profile target variables");
  if (profile.maintenance !== undefined && typeof profile.maintenance !== "boolean") throw new Error("Invalid maintenance capability");
  if (profile.httpsProtocol !== undefined && !["h2", "http/1.1"].includes(profile.httpsProtocol)) throw new Error("Invalid probe protocol");
  if (profile.summaries !== undefined) {
    if (!profile.summaries || typeof profile.summaries !== "object" || Array.isArray(profile.summaries)) throw new Error("Invalid summaries");
    for (const [status, summary] of Object.entries(profile.summaries)) {
      if (!["operational", "degraded", "outage", "unknown"].includes(status)
          || !summary || Object.keys(summary).sort().join() !== "description,title"
          || ![summary.title, summary.description].every(value => typeof value === "string" && value.length > 0 && value.length <= 1000 && !/[\r\n]/u.test(value)))
        throw new Error("Invalid profile summary");
    }
  }
  return profile;
}
export function profileComponents(profile) { return validateProfile(profile).components; }
export async function loadProfile(path) {
  if (!path || !isAbsolute(path) || !path.endsWith(".mjs")) throw new Error("Absolute project-owned .mjs profile path is required");
  const { default: profile } = await import(pathToFileURL(path).href);
  return validateProfile(profile);
}
