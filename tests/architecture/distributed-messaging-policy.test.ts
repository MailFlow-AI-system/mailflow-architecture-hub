import { describe, expect, test } from 'bun:test';

import { architectureRegistry } from '../../src/data/architecture/catalog';
import { architectureDiagrams } from '../../src/data/architecture/diagrams';

describe('distributed messaging policy', () => {
  test('migrates internal and cross-service jobs to RabbitMQ after the MVP', () => {
    const transport = architectureRegistry.decisions.find(
      (decision) => decision.id === 'decision.messaging.rabbitmq-distributed-transport',
    );
    const localJobs = architectureRegistry.decisions.find(
      (decision) => decision.id === 'decision.jobs.pgboss-transactional',
    );
    const activationGate = architectureRegistry.gates.find(
      (gate) => gate.id === 'gate.platform.pgboss-to-rabbitmq-redis',
    );
    const equivalenceGate = architectureRegistry.gates.find(
      (gate) => gate.id === 'gate.messaging.rabbitmq-job-equivalence',
    );
    const redis = architectureRegistry.decisions.find(
      (decision) => decision.id === 'decision.messaging.redis-ephemeral-state',
    );
    const firstDistributed = architectureDiagrams.find(
      (diagram) => diagram.id === 'diagram.topology.first-distributed',
    );
    const mailNode = firstDistributed?.nodes.find((node) => node.id === 'node.first.mail');
    const mailWorkerNode = firstDistributed?.nodes.find(
      (node) => node.id === 'node.first.mail-worker',
    );

    expect(transport).toMatchObject({
      status: 'confirmed_with_validation_gate',
      phase: 'first_distributed',
      serviceIds: expect.arrayContaining(['service.mail', 'service.audience']),
      stackIds: expect.arrayContaining(['stack.rabbitmq']),
      validationGateIds: expect.arrayContaining(['gate.messaging.rabbitmq-job-equivalence']),
    });
    expect(localJobs).toMatchObject({
      status: 'confirmed',
      phase: 'mvp',
      stackIds: expect.arrayContaining(['stack.pgboss', 'stack.postgresql']),
      relatedDecisionIds: expect.arrayContaining([
        'decision.messaging.rabbitmq-distributed-transport',
      ]),
    });
    expect(activationGate?.title).toBe('Migrate pg-boss jobs to RabbitMQ');
    expect(equivalenceGate).toMatchObject({
      phase: 'first_distributed',
      decisionIds: expect.arrayContaining(['decision.messaging.rabbitmq-distributed-transport']),
    });
    expect(redis).toMatchObject({
      status: 'confirmed',
      phase: 'first_distributed',
      stackIds: ['stack.redis'],
    });
    expect(redis?.validationGateIds).not.toContain('gate.messaging.rabbitmq-job-equivalence');
    expect(mailNode?.stackIds).toEqual(expect.arrayContaining(['stack.rabbitmq']));
    expect(mailNode?.stackIds).not.toContain('stack.pgboss');
    expect(mailWorkerNode).toMatchObject({
      serviceId: 'service.mail',
      stackIds: expect.arrayContaining(['stack.rabbitmq']),
    });
    expect(firstDistributed?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'node.first.mail',
          target: 'node.first.rabbitmq',
          phases: ['first_distributed'],
          decisionIds: expect.arrayContaining([
            'decision.messaging.rabbitmq-distributed-transport',
          ]),
        }),
        expect.objectContaining({
          source: 'node.first.rabbitmq',
          target: 'node.first.mail-worker',
          phases: ['first_distributed'],
          decisionIds: expect.arrayContaining([
            'decision.messaging.rabbitmq-distributed-transport',
          ]),
        }),
      ]),
    );
  });
});
