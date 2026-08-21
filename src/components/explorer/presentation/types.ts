import type { ArchitectureDiagramNode } from '../../../data/architecture/diagrams';

export const architectureLayers = [
  'actors',
  'edge-security',
  'product',
  'orchestration',
  'data-platform',
  'providers',
] as const;

export type ArchitectureLayer = (typeof architectureLayers)[number];

export const architectureDomains = [
  'actors-channels',
  'edge-security',
  'identity-tenancy',
  'mail-delivery',
  'audience-campaign',
  'content-workflow',
  'automation-runtime',
  'analytics-ai',
  'billing',
  'data-messaging',
  'platform-operations',
  'external-providers',
] as const;

export type ArchitectureDomain = (typeof architectureDomains)[number];

export type ArchitecturePresentationClassification = {
  layer: ArchitectureLayer;
  domain: ArchitectureDomain;
};

export type ClassifiedArchitectureNode = {
  node: ArchitectureDiagramNode;
  classification: ArchitecturePresentationClassification;
};
