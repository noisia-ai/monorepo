import {getSignalListeningStatusV1,saveSignalListeningConfigurationV1,requestSignalListeningV1,readSignalListeningQuestionMetricsV1} from '@noisia/db';
import {loadSignalWorkspaceContextForTopics} from '@/app/api/data-os/signal/[workspaceId]/topics/_lib';
import {pool} from '@/lib/db';
import {createSignalListeningApiV1} from './signal-listening-api';

export const listeningApi=createSignalListeningApiV1({
  load:async workspace_id=>{
    const loaded=await loadSignalWorkspaceContextForTopics(workspace_id);
    if(loaded.response)return {response:loaded.response};
    return {workspace_id:loaded.workspace.id,actor_user_id:loaded.session.appUser.id};
  },
  status:scope=>getSignalListeningStatusV1({database:pool,...scope}),
  save:(scope,args)=>saveSignalListeningConfigurationV1({database:pool,...scope,...args}),
  start:async(scope,args)=>{
    const status=await getSignalListeningStatusV1({database:pool,...scope});
    if(!status.map)throw Object.assign(Error('listening_map_unavailable'),{code:'listening_map_unavailable',status:409});
    return requestSignalListeningV1({database:pool,...scope,...args,map_id:status.map.id,
      provider_available:process.env.NOISIA_SIGNAL_LISTENING_ENABLED==='true'&&process.env.NOISIA_JEV_STREAMING_V2_ENABLED==='true'
        &&process.env.NOISIA_JEV_PROVIDER_ENABLED!=='false'&&Boolean(process.env.TYPESAFE_API_KEY?.trim())});
  },
  metrics:async(scope,args)=>{
    const status=await getSignalListeningStatusV1({database:pool,...scope});
    if(!status.map||!status.configuration)throw Object.assign(Error('listening_configuration_unavailable'),{code:'listening_configuration_unavailable',status:409});
    return readSignalListeningQuestionMetricsV1({database:pool,...scope,...args,
      configuration_id:status.configuration.id,map_id:status.map.id});
  },
});
