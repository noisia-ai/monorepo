import type {PoolClient} from "pg";
import {massLabelingConfigurationV2,type MassLabelingConfigurationV2} from "@noisia/query-engine";
import {SignalLabelingError} from "./signal-labeling-runs";

/** The same conservative estimate is shown before admission and sealed on the run. */
export function estimateMassLabelingProductV2(input:{roots:number;characters:number},configuration:MassLabelingConfigurationV2){
  const config=massLabelingConfigurationV2(configuration);
  if(!Number.isSafeInteger(input.roots)||input.roots<0||!Number.isSafeInteger(input.characters)||input.characters<0)
    throw new SignalLabelingError("mass_labeling_quote_invalid",409);
  const interestsSize=JSON.stringify(config.interests).length;
  return Math.ceil((input.characters/3.5+input.roots*(600+interestsSize/3.5))*.042);
}

/** Inputs and candidate packets are immutable, so only their aggregate size is cached.
 * Active interests stay outside the cache and are recalculated for each configuration. */
export async function loadMassLabelingProductEstimateWithClientV2(client:Pick<PoolClient,"query">,args:{
  workspace_id:string;map_id:string;configuration:MassLabelingConfigurationV2;
}){
  let cached=(await client.query<{roots:number;characters:string}>(`SELECT root_count roots,input_characters::text characters
    FROM signal_mass_labeling_product_estimates WHERE workspace_id=$1 AND map_id=$2`,[args.workspace_id,args.map_id])).rows[0];
  if(!cached){
    await client.query(`INSERT INTO signal_mass_labeling_product_estimates(workspace_id,map_id,root_count,input_characters)
      SELECT map.workspace_id,map.id,map.root_count,COALESCE(sum(length(item.text)+length(item.candidates::text)),0)::bigint
      FROM signal_mass_labeling_maps map JOIN signal_mass_labeling_items item ON item.workspace_id=map.workspace_id AND item.map_id=map.id
      WHERE map.workspace_id=$1 AND map.id=$2 GROUP BY map.workspace_id,map.id,map.root_count ON CONFLICT DO NOTHING`,[args.workspace_id,args.map_id]);
    cached=(await client.query<{roots:number;characters:string}>(`SELECT root_count roots,input_characters::text characters
      FROM signal_mass_labeling_product_estimates WHERE workspace_id=$1 AND map_id=$2`,[args.workspace_id,args.map_id])).rows[0];
  }
  if(!cached)throw new SignalLabelingError("mass_labeling_map_unavailable",404);
  return estimateMassLabelingProductV2({roots:cached.roots,characters:Number(cached.characters)},args.configuration);
}
