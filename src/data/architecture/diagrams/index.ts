import { capabilityViews } from './capabilityViews';
import { composeWholeArchitecture } from './composeWholeArchitecture';
import { securityFlowViews } from './securityFlowViews';
import { topologyViews } from './topologyViews';

export * from './types';
export { capabilityViews, composeWholeArchitecture, securityFlowViews, topologyViews };

export const architectureDiagrams = [...topologyViews, ...securityFlowViews, ...capabilityViews];
