/** Test-fixture index only: preserve assignment order and object contents while
 * avoiding a full assignment scan for each canonical root. */
export function indexSyntheticTopicAssignmentsByRootV1<T extends {root_id:string}>(assignments:readonly T[]):Map<string,T[]>{
 const byRoot=new Map<string,T[]>();
 for(const assignment of assignments){
  const root=assignment.root_id;
  const group=byRoot.get(root);
  if(group)group.push(assignment);else byRoot.set(root,[assignment]);
 }
 return byRoot;
}
