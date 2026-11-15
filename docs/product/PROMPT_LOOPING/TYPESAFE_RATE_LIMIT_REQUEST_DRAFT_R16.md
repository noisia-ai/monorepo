# Typesafe rate limit increase request · draft only

**Status:** draft for founder review. Do not submit or accept a plan from this document.

## Proposed request

We operate a social listening classification service and expect several million independent roots per month. Each root can generate one or more independent classification requests; current historical usage averages approximately **1,632 input tokens per root**, before measuring the reduced R16 prompt profile. We need a burstable capacity profile that can sustain up to **1,000 requests/second** and approximately **2,000,000 input tokens/second**, subject to the provider's supported limits and pricing.

Please provide the maximum supported request and token rates, any shared organization-wide limits, burst and sustained windows, concurrency guidance, 429/529 retry behavior, and a written price quote. We will update this request with measured R16 tokens per root and expected peak windows before submission.

## Planning arithmetic (not a cost estimate)

At 1,632 input tokens per root:

| Monthly roots | Approximate input tokens | Time at current observed 100,000 tokens/s, ignoring all other work |
|---:|---:|---:|
| 1 million | 1.632 billion | 4.53 hours |
| 3 million | 4.896 billion | 13.60 hours |
| 5 million | 8.160 billion | 22.67 hours |

At 1,000 requests/s and that historical token average, token throughput would need to reach approximately **1.632 million tokens/s**. The proposed 2 million tokens/s leaves limited headroom; replace it with the measured R16 profile and the founder's monthly forecast before sending.

## Evidence required before submission

- Measured tokens/root and request shape from the R16 synthetic and permitted real-provider runs.
- Several-month root forecast, peak-hour multiplier, and requested burst duration.
- Provider price quote and rate-limit terms reviewed by the founder.

No credentials, customer names, study text, IDs, or live request examples belong in this draft.
