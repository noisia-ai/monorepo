import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeMassEngineConsumerV1,
  assertMassJevConsumerV1,
} from "./mass-labeling-consumer";

test("paid pilot daemon and invalid operator leave the same lease for one valid operator", async () => {
  const database = {
    query: async () => ({ rows: [{ paid_pilot: true }] }),
  } as never;
  let claims = 0,
    consumed = false;
  const consume = async (
    operator?: Parameters<typeof authorizeMassEngineConsumerV1>[0]["operator"],
  ) => {
    if (
      !(await authorizeMassEngineConsumerV1({
        database,
        execution_id: crypto.randomUUID(),
        operator,
      }))
    )
      return;
    if (!consumed) {
      consumed = true;
      claims++;
    }
  };
  await consume();
  await assert.rejects(
    consume({
      recovery_only: false,
      api_key: "old",
      enabled: true,
      fetch_impl: async () => new Response("{}", { status: 401 }),
    }),
  );
  assert.equal(claims, 0);
  const valid = {
    recovery_only: false,
    api_key: "ephemeral",
    enabled: true,
    fetch_impl: async () => new Response("{}", { status: 200 }),
  };
  await consume(valid);
  await consume(valid);
  assert.equal(claims, 1);
});

test("raw-only engine recovery needs no provider and JEV invalid credentials cannot reach a claim", async () => {
  const database = {
    query: async () => ({ rows: [{ paid_pilot: true }] }),
  } as never;
  assert.equal(
    await authorizeMassEngineConsumerV1({
      database,
      execution_id: crypto.randomUUID(),
      operator: { recovery_only: true, enabled: false },
      recovery_preflight:async()=>({pilot:true}),
    }),
    true,
  );
  let claims = 0;
  const consume = async (status: number) => {
    await assertMassJevConsumerV1({
      api_key: "synthetic",
      enabled: true,
      fetch_impl: async () => new Response("{}", { status }),
    });
    claims++;
  };
  await assert.rejects(consume(401));
  assert.equal(claims, 0);
  await consume(200);
  assert.equal(claims, 1);
});

test('completed paid pilot receipt replays without credentials',async()=>{
 const database={query:async()=>({rows:[{paid_pilot:true,status:'ready'}]})} as never;
 assert.equal(await authorizeMassEngineConsumerV1({database,execution_id:crypto.randomUUID()}),true);
});


test("raw-only consumer rejects a missing pilot fit before any provider or claim",async()=>{
 let probes=0;
 await assert.rejects(authorizeMassEngineConsumerV1({database:{} as never,execution_id:crypto.randomUUID(),
   operator:{recovery_only:true,fetch_impl:async()=>{probes++;return new Response("{}");}},
   recovery_preflight:async()=>({pilot:false}),
 }),/fit_required/u);
 assert.equal(probes,0);
});


test("governed product daemon admits only a currently authorized sealed actor without a private operator",async()=>{
 for(const authorized of [true,false]){
  const database={query:async()=>({rows:[{paid_pilot:true,status:'queued',product:true,product_actor:authorized}]})} as never;
  assert.equal(await authorizeMassEngineConsumerV1({database,execution_id:crypto.randomUUID()}),authorized);
 }
 const legacy={query:async()=>({rows:[{paid_pilot:true,status:'queued',product:false,product_actor:true}]})} as never;
 assert.equal(await authorizeMassEngineConsumerV1({database:legacy,execution_id:crypto.randomUUID()}),false);
});
