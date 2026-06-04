// Archetype key → noir medallion artwork. The archetype grid and the field
// guide both render the same medallion per persona, so the import map lives
// here rather than duplicated in each.

import type { ArchetypeKey } from "../../types.ts";

import medallionSuperfan from "../../../assets/persona-icons/noir-medallion-superfan.png";
import medallionShill from "../../../assets/persona-icons/noir-medallion-shill.png";
import medallionFarmer from "../../../assets/persona-icons/noir-medallion-farmer.png";
import medallionDoomer from "../../../assets/persona-icons/noir-medallion-doomer.png";
import medallionCamModel from "../../../assets/persona-icons/noir-medallion-cam_model.png";
import medallionPolitics from "../../../assets/persona-icons/noir-medallion-politics.png";

export const PERSONA_MEDALLIONS: Record<ArchetypeKey, string> = {
  superfan: medallionSuperfan,
  shill: medallionShill,
  farmer: medallionFarmer,
  doomer: medallionDoomer,
  cam_model: medallionCamModel,
  politics: medallionPolitics,
};
