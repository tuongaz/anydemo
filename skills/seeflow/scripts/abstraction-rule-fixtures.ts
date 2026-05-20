/**
 * Abstraction-rule fixtures for the `seeflow-node-planner` sub-agent.
 *
 * These are the canonical input/output pairs a correct planner must satisfy.
 * They are exported from a NON-test module so a future LLM-eval harness can
 * import them without tripping Biome's `noExportsInTest` rule. The companion
 * file `test-abstraction-rules.test.ts` consumes these to assert internal
 * consistency of the contract itself.
 *
 * Each fixture pairs:
 *   - a synthetic Phase 1 brief (`contextBrief`) — the planner's input
 *   - the `expected` node-count + node-name-set + trigger pick a correct
 *     planner would emit, plus free-text `rationaleNotes` documenting the
 *     justification the planner should cite in `oneNodeRationale`.
 *
 * No LLM is invoked in tests. The contract lives here so drift between the
 * sub-agent prompt's abstraction rules and the fixtures shows up as a test
 * failure rather than silent rot.
 */

export interface DiscovererBriefFixture {
  userIntent: string;
  audienceFraming: string;
  scope: {
    rootEntities: string[];
    outOfScope: string[];
  };
  codePointers: Array<{ path: string; why: string }>;
  existingDemo: null | { slug: string; nodeCount: number; diffTarget: boolean };
}

export type AbstractionRuleId =
  | 'collapse-temporal-workflow'
  | 'collapse-microservice-routes'
  | 'collapse-database'
  | 'exception-1-independently-meaningful-pipeline'
  | 'exception-2-fan-out-distinct-consumers'
  | 'exception-3-choice-branch';

export interface AbstractionRuleFixture {
  /** Stable label for failure messages and future eval wiring. */
  name: string;
  /** Which rule / exception this fixture exercises. */
  rule: AbstractionRuleId;
  contextBrief: DiscovererBriefFixture;
  expected: {
    /** Count of functional nodes a correct planner emits. */
    nodeCount: number;
    /**
     * The set of `data.name` values a correct planner emits. Order does not
     * matter. Names must be unique within the array.
     */
    nodeNames: string[];
    /**
     * The `data.name` of the single `playNode` a correct planner picks as
     * the audience-facing trigger. Must appear in `nodeNames`.
     */
    triggerNodeName: string;
    /**
     * Free-text notes capturing the rationale a correct planner should cite
     * in `oneNodeRationale` for the load-bearing nodes. Not asserted as
     * exact match — used for documentation and future eval scoring.
     */
    rationaleNotes: string;
  };
}

export const abstractionRuleFixtures: AbstractionRuleFixture[] = [
  {
    name: 'system has a Temporal workflow with 4 activities (none independently meaningful)',
    rule: 'collapse-temporal-workflow',
    contextBrief: {
      userIntent:
        'Show how the nightly billing workflow runs end-to-end so on-call can spot where it gets stuck.',
      audienceFraming:
        'Engineer-and-business audience. The billing workflow is one orchestration; activities (load-customers, compute-charges, write-invoices, send-receipts) are implementation detail the audience does not need to see individually.',
      scope: {
        rootEntities: ['billing workflow', 'billing-db'],
        outOfScope: ['admin reporting', 'marketing tools'],
      },
      codePointers: [
        { path: 'src/workflows/billing.ts', why: 'Temporal workflow definition with 4 activities' },
        { path: 'src/workers/billing-worker.ts', why: 'Worker host that runs the workflow' },
        { path: 'src/db.ts', why: 'Postgres connection used by the workflow' },
      ],
      existingDemo: null,
    },
    expected: {
      nodeCount: 2,
      nodeNames: ['Billing Workflow', 'Billing DB'],
      triggerNodeName: 'Billing Workflow',
      rationaleNotes:
        'Billing Workflow: single Temporal workflow — activities are implementation detail. Billing DB: one database dependency, regardless of how many tables it holds.',
    },
  },
  {
    name: 'pipeline validate -> score -> rank -> publish (each stage independently meaningful)',
    rule: 'exception-1-independently-meaningful-pipeline',
    contextBrief: {
      userIntent:
        'Visualise the recommendation pipeline so the business team can see where ranking decisions are made before publish.',
      audienceFraming:
        'Engineer-and-business audience. Each pipeline stage has a distinct business meaning (validate inputs, score candidates, rank them, publish the winning list) and the audience must see each independently — even though all four are activities of one Temporal workflow.',
      scope: {
        rootEntities: ['validate stage', 'score stage', 'rank stage', 'publish stage'],
        outOfScope: ['feature backfill cron', 'analytics export'],
      },
      codePointers: [
        {
          path: 'src/pipeline/validate.ts',
          why: 'Input validation stage — rejects malformed candidates',
        },
        {
          path: 'src/pipeline/score.ts',
          why: 'Per-candidate scoring stage — calls the ML service',
        },
        {
          path: 'src/pipeline/rank.ts',
          why: 'Cross-candidate ranking stage — applies business rules',
        },
        {
          path: 'src/pipeline/publish.ts',
          why: 'Publishes the ranked list to the recommendations store',
        },
      ],
      existingDemo: null,
    },
    expected: {
      nodeCount: 4,
      nodeNames: ['Validate', 'Score', 'Rank', 'Publish'],
      triggerNodeName: 'Validate',
      rationaleNotes:
        'Exception 1: each pipeline stage independently meaningful to the audience. Validate is the entry point and gets the single playNode trigger.',
    },
  },
  {
    name: 'fan-out from order.created to 3 consumers (notify-customer + update-inventory + trigger-shipping)',
    rule: 'exception-2-fan-out-distinct-consumers',
    contextBrief: {
      userIntent:
        'Show what happens when an order is created and the three downstream consumers fan out from the event.',
      audienceFraming:
        'Engineer-and-business audience. The interesting part is the fan-out: one publish, three distinct business outcomes (customer notification, inventory reservation, shipping kickoff). Audience must see each consumer separately, not collapsed into a single "subscribers" box.',
      scope: {
        rootEntities: [
          'order HTTP server',
          'event bus',
          'notify-customer consumer',
          'update-inventory consumer',
          'trigger-shipping consumer',
        ],
        outOfScope: ['admin dashboard'],
      },
      codePointers: [
        { path: 'src/server.ts', why: 'POST /orders publishes order.created' },
        { path: 'src/event-bus.ts', why: 'Named pub/sub abstraction the codebase uses' },
        { path: 'src/consumers/notify-customer.ts', why: 'Sends order confirmation email' },
        { path: 'src/consumers/update-inventory.ts', why: 'Decrements stock for each line item' },
        { path: 'src/consumers/trigger-shipping.ts', why: 'Enqueues shipment for fulfillment' },
      ],
      existingDemo: null,
    },
    expected: {
      nodeCount: 5,
      nodeNames: [
        'POST /orders',
        'Event Bus',
        'Notify Customer',
        'Update Inventory',
        'Trigger Shipping',
      ],
      triggerNodeName: 'POST /orders',
      rationaleNotes:
        'Exception 2: each consumer is its own business concept. POST /orders is the synchronous trigger. Event Bus is one named channel, not many.',
    },
  },
  {
    name: 'microservice with 12 internal HTTP routes',
    rule: 'collapse-microservice-routes',
    contextBrief: {
      userIntent:
        'Show how the checkout service handles a cart submission end-to-end so the team can see the payment + persistence hops.',
      audienceFraming:
        'Engineer-and-business audience. The checkout service exposes 12 routes (cart CRUD, coupon validation, payment proxy, etc.) but the audience cares about the checkout submission path — the other 11 routes are implementation detail.',
      scope: {
        rootEntities: ['checkout service', 'payments service', 'order-db'],
        outOfScope: ['admin endpoints', 'health checks'],
      },
      codePointers: [
        {
          path: 'src/checkout/routes.ts',
          why: '12 HTTP routes, including POST /checkout — the primary trigger',
        },
        { path: 'src/payments/client.ts', why: 'Stripe client wrapper used during checkout' },
        { path: 'src/order/store.ts', why: 'Order persistence layer' },
      ],
      existingDemo: null,
    },
    expected: {
      nodeCount: 3,
      nodeNames: ['Checkout Service', 'Payments Service', 'Order DB'],
      triggerNodeName: 'Checkout Service',
      rationaleNotes:
        'Single HTTP service — internal routes are implementation detail. The play-designer will pick POST /checkout as the route to hang the Play on; the other 11 routes are not part of the demo.',
    },
  },
  {
    name: 'choice/branch: paid -> fulfill / failed -> refund',
    rule: 'exception-3-choice-branch',
    contextBrief: {
      userIntent:
        'Show the two outcomes of a payment attempt so the audience can see both the happy path and the refund branch.',
      audienceFraming:
        'Engineer-and-business audience. The interesting part is the branch: a successful payment fulfills, a failed payment refunds. The audience must see both outcomes, not a single collapsed "outcome" node.',
      scope: {
        rootEntities: ['payments service', 'fulfillment worker', 'refund worker'],
        outOfScope: ['reporting'],
      },
      codePointers: [
        { path: 'src/payments/charge.ts', why: 'Branches on charge.status into fulfill vs refund' },
        { path: 'src/workers/fulfillment.ts', why: 'Happy path consumer' },
        { path: 'src/workers/refund.ts', why: 'Failure path consumer' },
      ],
      existingDemo: null,
    },
    expected: {
      nodeCount: 3,
      nodeNames: ['Payments Service', 'Fulfillment Worker', 'Refund Worker'],
      triggerNodeName: 'Payments Service',
      rationaleNotes:
        'Exception 3: choice/branch the audience must understand. Two downstream workers, not one collapsed "outcome" node.',
    },
  },
];
