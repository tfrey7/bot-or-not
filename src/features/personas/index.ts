// Persona-scatter widget shared by the Subreddits detail pane: archetype
// anchors around a hexagon, each investigated account placed at the
// barycentric projection of its archetype radar vector.

export { PersonasScatter } from "./scatter.tsx";
export { personasCollect } from "./logic.ts";
export type { PersonaPoint, PersonasRow } from "./logic.ts";
