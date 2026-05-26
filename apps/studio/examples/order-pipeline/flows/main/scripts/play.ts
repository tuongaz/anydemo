const flowId = process.env.SEEFLOW_DEMO_ID ?? '';
const runId = process.env.SEEFLOW_RUN_ID ?? '';
const studioUrl = (process.env.SEEFLOW_STUDIO_URL ?? 'http://localhost:4321').replace(/\/+$/, '');

const res = await fetch(`${studioUrl}/demo/orders`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-seeflow-demo-id': flowId,
    'x-seeflow-run-id': runId,
  },
  body: JSON.stringify({ customerId: 'cust_123', items: [{ sku: 'WIDGET-1', qty: 2 }] }),
});

if (!res.ok) {
  console.error(`POST /demo/orders failed: ${res.status}`);
  process.exit(1);
}
