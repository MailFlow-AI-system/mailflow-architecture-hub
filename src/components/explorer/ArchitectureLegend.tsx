import type { RelationType } from '../../domain/architecture';

export const relationColors: Record<RelationType, string> = {
  sync_rest: '#91e3d6',
  event: '#d9ff69',
  async_command: '#ff9769',
  job: '#c5a6ff',
  data: '#8bb8ff',
  authentication: '#ffe48d',
  authorization: '#ffb4cf',
  infrastructure: '#8f9ba3',
  provider_call: '#ff826e',
  ownership: '#f5f2ea',
  dependency: '#b6c1c7',
  phase_transition: '#d9ff69',
  trust_boundary: '#ffcf70',
};

export const relationTypes: readonly RelationType[] = Object.keys(relationColors) as RelationType[];

export const relationLegendEntries = relationTypes.map((type) => ({
  type,
  label: type.replaceAll('_', ' '),
  color: relationColors[type],
}));

export function ArchitectureLegend() {
  return (
    <aside className="architecture-legend" aria-label="Relationship legend">
      <strong className="architecture-legend__title">Relationships</strong>
      <ul className="architecture-legend__list">
        {relationLegendEntries.map(({ type, label, color }) => (
          <li key={type} className="architecture-legend__item">
            <span
              className="architecture-legend__swatch"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            <span>{label}</span>
          </li>
        ))}
        <li className="architecture-legend__item architecture-legend__item--prohibited">
          <span className="architecture-legend__swatch" aria-hidden="true" />
          <span>prohibited relationship</span>
        </li>
      </ul>
    </aside>
  );
}

export default ArchitectureLegend;
