import { Hono } from 'hono';
import type { EventBus } from './events.ts';

const STATUS_TO_EVENT = {
  running: 'node:running',
  done: 'node:done',
  error: 'node:error',
} as const;

const delay = (): Promise<void> => new Promise((r) => setTimeout(r, 200 + Math.random() * 200));

function nodeEmit(
  events: EventBus,
  flowId: string,
  runId: string,
  nodeId: string,
  status: keyof typeof STATUS_TO_EVENT,
  payload?: Record<string, unknown>,
) {
  events.broadcast({
    type: STATUS_TO_EVENT[status],
    flowId,
    payload: { nodeId, runId, ...payload },
  });
}

async function runOrderPipeline(events: EventBus, flowId: string, runId: string, orderId: string) {
  const emit = (
    nodeId: string,
    status: keyof typeof STATUS_TO_EVENT,
    payload?: Record<string, unknown>,
  ) => nodeEmit(events, flowId, runId, nodeId, status, payload);

  emit('post-orders', 'running');
  await delay();
  emit('post-orders', 'done', { orderId });

  emit('inventory-service', 'running');
  await delay();
  emit('inventory-service', 'done', { reserved: true, warehouseId: 'wh_sydney' });

  emit('payment-service', 'running');
  await delay();
  emit('payment-service', 'done', { chargeId: `ch_${Date.now()}`, amount: 4999 });

  emit('fulfillment-service', 'running');
  await delay();
  emit('fulfillment-service', 'done', { shipmentId: `shp_${Date.now()}`, orderId });
}

export function createDemoRouter(events: EventBus): Hono {
  const app = new Hono();

  app.post('/orders', async (c) => {
    const flowId = c.req.header('x-seeflow-demo-id') ?? '';
    const runId = c.req.header('x-seeflow-run-id') ?? '';
    const orderId = `ord_${Date.now()}`;

    void runOrderPipeline(events, flowId, runId, orderId);

    return c.json({ orderId });
  });

  return app;
}
