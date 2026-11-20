import test from "node:test";
import {runMassLabelingAcceptanceFixtureV1} from './signal-mass-labeling-acceptance.synthetic.fixture';
for(const authorization of ["rotation","scoped","scoped-scale","scoped-funding","product","product-recovery"] as const)
  test(`mass labeling seals full population, bills once, and serves probability pages with live tenant/rights fences (${authorization})`, {
    skip:process.env.NOISIA_MFP_PG_CI!=="true",timeout:600_000,
  },async()=>runMassLabelingAcceptanceFixtureV1(authorization));
