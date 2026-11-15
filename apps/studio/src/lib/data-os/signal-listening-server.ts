import {getSignalListeningStatusV1,saveSignalListeningConfigurationV1,prepareSignalListeningV1,readSignalListeningQuestionMetricsV1,loadSignalListeningLexiconSuggestionsV1} from '@noisia/db';
import {loadSignalWorkspaceContextForTopics} from '@/app/api/data-os/signal/[workspaceId]/topics/_lib';
import {pool} from '@/lib/db';
import {createSignalListeningApiV1,type ListeningApiDependenciesV1} from './signal-listening-api';

const operations:Omit<ListeningApiDependenciesV1,'load'>={
  status:scope=>getSignalListeningStatusV1({database:pool,...scope}),
  save:(scope,args)=>saveSignalListeningConfigurationV1({database:pool,...scope,...args}),
  start:async(scope,args)=>{
    const status=await getSignalListeningStatusV1({database:pool,...scope});
    if(!status.map)throw Object.assign(Error('listening_map_unavailable'),{code:'listening_map_unavailable',status:409});
    return prepareSignalListeningV1({database:pool,...scope,...args,map_id:status.map.id,
      prototype_provider_available:process.env.NOISIA_WORKSPACE_EMBEDDINGS_PROVIDER_ENABLED==='true'&&Boolean(process.env.VOYAGE_API_KEY?.trim()),
      provider_available:process.env.NOISIA_SIGNAL_LISTENING_ENABLED==='true'&&process.env.NOISIA_JEV_STREAMING_V2_ENABLED==='true'
        &&process.env.NOISIA_JEV_PROVIDER_ENABLED!=='false'&&Boolean(process.env.TYPESAFE_API_KEY?.trim())});
  },
  metrics:async(scope,args)=>{
    const status=await getSignalListeningStatusV1({database:pool,...scope});
    if(!status.map||!status.configuration)throw Object.assign(Error('listening_configuration_unavailable'),{code:'listening_configuration_unavailable',status:409});
    return readSignalListeningQuestionMetricsV1({database:pool,...scope,...args,
      configuration_id:status.configuration.id,map_id:status.map.id});
  },
  lexicon:async(scope,args)=>{
    const status=await getSignalListeningStatusV1({database:pool,...scope});
    if(!status.map||!status.configuration||status.configuration.id!==args.configuration_id)
      throw Object.assign(Error('listening_configuration_changed'),{code:'listening_configuration_changed',status:409});
    return loadSignalListeningLexiconSuggestionsV1({database:pool,...scope,...args,map_id:status.map.id});
  },
};

/** Resolve the protected workspace once per request. The bound controller cannot
 * be reused for a different workspace and never refreshes the session twice. */
export async function loadSignalWorkspaceContextForListening(workspace_id:string){
  const loaded=await loadSignalWorkspaceContextForTopics(workspace_id);
  if(loaded.response)return {response:loaded.response};
  const scope={workspace_id:loaded.workspace.id,actor_user_id:loaded.session.appUser.id};
  return {api:createSignalListeningApiV1({...operations,load:async requested=>requested===scope.workspace_id?scope
    :{response:Response.json({error:'listening_forbidden'},{status:403})}})};
}
