// Play from this device that never reached the server, against what the server
// holds now. Pure: currentRevs is the Map of section -> revision this device
// last saw on the server.
import { mergeMastery, mergeSection } from "../progressMerge";
import { splitSections } from "./progressShape";

// A dirty snapshot against the server's current progress. Sections the
// server hasn't changed since the snapshot's base keep this device's
// values; changed ones are merged field by field.
export function mergeUnsynced(snapshot, serverSections, serverMastery, currentRevs) {
  const local = snapshot.data;
  const base = snapshot.base || { revs: {}, sections: {} };
  const localSections = splitSections(local);
  const out = { ...local };
  for (const [name, server] of Object.entries(serverSections)) {
    if (base.revs?.[name] != null && base.revs[name] === currentRevs.get(name)) continue;
    const baseSection = base.sections?.[name] ? JSON.parse(base.sections[name]) : null;
    Object.assign(out, mergeSection(baseSection, localSections[name], server));
  }
  out.mastery = mergeMastery(null, local.mastery, serverMastery);
  return out;
}
