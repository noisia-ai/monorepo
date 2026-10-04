import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { selectGold } from './gold.mjs';
import { csv } from './csv.mjs';
import { main } from './guard.mjs';
await main(async () => {
  const [rootPath, contextPath, comparisonPath, conceptPath, output = '.data/dev-corpus'] = process.argv.slice(2);
  if (!rootPath || !contextPath || !comparisonPath || !conceptPath) throw new Error('mfp_gold_arguments_required');
  const roots = (await readFile(rootPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const context = JSON.parse(await readFile(contextPath, 'utf8'));
  const comparisons = JSON.parse(await readFile(comparisonPath, 'utf8'));
  const concepts = JSON.parse(await readFile(conceptPath, 'utf8'));
  if (concepts.length < 2 || concepts.length > 3) throw new Error('mfp_gold_concepts_required');
  const selected = selectGold(roots, context.entities, 'mfp-gold-v1', comparisons);
  const fields = ['root_id','input_digest','partition','stratum','text','entities','entities_abstained','unrelated_reason','voice','act','spam_or_bot','language','asunto',...concepts.map((concept: {concept_key:string}) => `concept:${concept.concept_key}`)];
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(`${output}/gold-template.csv`, csv(fields, selected), { mode: 0o600, flag: 'wx' });
  await writeFile(`${output}/gold-selection.json`, JSON.stringify({ seed:'mfp-gold-v1', context, concepts, selected }), { mode:0o600, flag:'wx' });
  console.log(JSON.stringify({ status:'template_ready', roots:150, dev:90, test:60, human_labels:'pending' }));
});
