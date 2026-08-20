import { capabilityViews } from './capabilityViews';
import { securityFlowViews } from './securityFlowViews';
import { topologyViews } from './topologyViews';

export * from './types';
export { capabilityViews, securityFlowViews, topologyViews };

export const architectureDiagrams = [...topologyViews, ...securityFlowViews, ...capabilityViews];
