import {loadSignalTopicCatalogStoreV1} from '../signal-topic-catalog';
/** Read the current working definition immediately before a test mutation. */
export async function currentTopicDefinitionCasV1(args:Omit<Parameters<typeof loadSignalTopicCatalogStoreV1>[0],'queryable'>&{
 actor_user_id?:string;pool:Parameters<typeof loadSignalTopicCatalogStoreV1>[0]['queryable'];term_key:string}) {
 const catalog=await loadSignalTopicCatalogStoreV1({...args,queryable:args.pool});
 const topic=catalog.topics.find(row=>row.term_key===args.term_key);
 if(!topic)throw new Error('test_topic_definition_missing');
 return{expected_definition_revision:topic.definition_revision,expected_definition_digest:topic.definition_digest};
}
