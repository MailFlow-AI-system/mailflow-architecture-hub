import type { ArchitectureDiagramNode } from '../../../data/architecture/diagrams';
import {
  type ArchitectureDomain,
  type ArchitectureLayer,
  architectureDomains,
  architectureLayers,
  type ArchitecturePresentationClassification,
  type ClassifiedArchitectureNode,
} from './types';

const serviceDomains: Readonly<Record<string, ArchitectureDomain>> = {
  'service.gateway-bff': 'edge-security',
  'service.identity-workspace': 'identity-tenancy',
  'service.mail': 'mail-delivery',
  'service.delivery': 'mail-delivery',
  'service.audience': 'audience-campaign',
  'service.campaign': 'audience-campaign',
  'service.content': 'content-workflow',
  'service.workflow': 'content-workflow',
  'service.automation-runtime': 'automation-runtime',
  'service.analytics': 'analytics-ai',
  'service.ai': 'analytics-ai',
  'service.billing': 'billing',
  'service.audit': 'data-messaging',
};

const explicitNodeDomains: Readonly<Record<string, ArchitectureDomain>> = {
  'node.context.user': 'actors-channels',
  'node.context.gateway': 'edge-security',
  'node.context.resend': 'external-providers',
  'node.context.stripe': 'external-providers',
  'node.mvp.browser': 'actors-channels',
  'node.mvp.core-api': 'mail-delivery',
  'node.mvp.core-worker': 'mail-delivery',
  'node.strangler.core': 'mail-delivery',
  'node.first.browser': 'actors-channels',
  'node.first.wireguard': 'edge-security',
  'node.future.wireguard': 'edge-security',
  'node.owner.audit': 'data-messaging',
  'node.infra.cloudflare': 'edge-security',
  'node.infra.infisical': 'edge-security',
  'node.infra.resend': 'external-providers',
  'node.infra.stripe': 'external-providers',
  'node.security.credentials.kms': 'external-providers',
  'node.security.credentials.infisical': 'edge-security',
  'mail-provider.resend': 'mail-delivery',
  'mail-flow.browser': 'mail-delivery',
  'mail-flow.gateway': 'mail-delivery',
  'mail-flow.provider': 'external-providers',
  'attachments.browser': 'mail-delivery',
  'attachments.managed-fallback': 'external-providers',
  'ai-rag.openrouter': 'analytics-ai',
  'billing-entitlements.gateway': 'billing',
  'billing-entitlements.stripe': 'billing',
};

const nodePrefixDomains: ReadonlyArray<readonly [string, ArchitectureDomain]> = [
  ['node.tenancy.', 'identity-tenancy'],
  ['node.identity.', 'identity-tenancy'],
  ['node.infra.', 'data-messaging'],
  ['node.ops.', 'platform-operations'],
  ['node.lifecycle.', 'data-messaging'],
  ['node.security.', 'edge-security'],
  ['mail-provider.', 'mail-delivery'],
  ['mail-flow.', 'mail-delivery'],
  ['attachments.', 'mail-delivery'],
  ['snapshot.', 'audience-campaign'],
  ['campaign-contract.', 'audience-campaign'],
  ['content-pipeline.', 'content-workflow'],
  ['workflow-control.', 'automation-runtime'],
  ['automation-runtime.', 'automation-runtime'],
  ['ai-rag.', 'analytics-ai'],
  ['analytics-pipeline.', 'analytics-ai'],
  ['billing-entitlements.', 'billing'],
];

function domainFromStableNodeData(node: ArchitectureDiagramNode): ArchitectureDomain {
  const explicitDomain = explicitNodeDomains[node.id];
  if (explicitDomain) return explicitDomain;

  const serviceDomain = node.serviceId ? serviceDomains[node.serviceId] : undefined;
  if (serviceDomain) return serviceDomain;

  const prefixDomain = nodePrefixDomains.find(([prefix]) => node.id.startsWith(prefix))?.[1];
  if (prefixDomain) return prefixDomain;

  if (node.sourceDiagramIds?.some((id) => id.startsWith('diagram.security.'))) {
    return 'edge-security';
  }
  if (node.sourceDiagramIds?.some((id) => id.startsWith('diagram.operations.'))) {
    return 'platform-operations';
  }
  if (node.sourceDiagramIds?.some((id) => id.startsWith('diagram.infrastructure.'))) {
    return 'data-messaging';
  }

  switch (node.kind) {
    case 'actor':
      return 'actors-channels';
    case 'provider':
      return 'external-providers';
    case 'security_boundary':
      return 'edge-security';
    default:
      return 'data-messaging';
  }
}

function layerForNode(
  node: ArchitectureDiagramNode,
  domain: ArchitectureDomain,
): ArchitectureLayer {
  switch (node.kind) {
    case 'actor':
      return 'actors';
    case 'provider':
      return 'providers';
    case 'security_boundary':
      return 'edge-security';
    case 'queue':
      return domain === 'automation-runtime' ? 'orchestration' : 'data-platform';
    case 'infrastructure':
      return domain === 'automation-runtime' ? 'orchestration' : 'data-platform';
    case 'data_store':
      return domain === 'automation-runtime' ? 'orchestration' : 'data-platform';
    case 'service':
      if (domain === 'edge-security') return 'edge-security';
      if (domain === 'automation-runtime') return 'orchestration';
      return 'product';
    case 'module':
      return domain === 'automation-runtime' ? 'orchestration' : 'product';
  }
}

export function classifyArchitectureNode(
  node: ArchitectureDiagramNode,
): ArchitecturePresentationClassification {
  const domain = domainFromStableNodeData(node);
  return { layer: layerForNode(node, domain), domain };
}

export function classifyArchitectureNodes(
  nodes: readonly ArchitectureDiagramNode[],
): ClassifiedArchitectureNode[] {
  return nodes.map((node) => ({ node, classification: classifyArchitectureNode(node) }));
}

export const classifyWholeArchitectureNode = classifyArchitectureNode;
export const classifyWholeArchitectureNodes = classifyArchitectureNodes;

export { architectureDomains, architectureLayers };
