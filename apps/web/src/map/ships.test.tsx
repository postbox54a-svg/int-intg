import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LayerPanel } from '../components/LayerPanel';
import { PORTS, SHIPS, SHIP_COLOURS } from './layers';

describe('ships rendering', () => {
  it('popup shows name, MMSI, type, speed, course, status and destination', () => {
    const rows = SHIPS.popup({ name: 'SAGAR KANYA 1', mmsi: '419000101', shipType: 70, category: 'cargo', sog: 11.24, cog: 182.6, navStatus: 0, destination: 'INNSA', callsign: 'AV1234', ts: Date.UTC(2026, 9, 3, 6) });
    expect(rows).toEqual([
      ['Name', 'SAGAR KANYA 1'],
      ['MMSI', '419000101'],
      ['Type', 'Cargo (70)'],
      ['Speed', '11.2 kn'],
      ['Course', '183°'],
      ['Status', 'Under way (engine)'],
      ['Destination', 'INNSA'],
      ['Call sign', 'AV1234'],
      ['Last seen', expect.stringContaining('11:30:00 IST')],
    ]);
    expect(SHIPS.popup({ mmsi: '1' })[2]).toEqual(['Type', 'Other / unknown']);
  });

  it('labels the six major ports', () => {
    expect(PORTS.map((p) => p.name)).toEqual(['JNPT', 'Mundra', 'Chennai', 'Visakhapatnam', 'Kochi', 'Kolkata']);
  });

  it('shows the ship-type legend only while ships are on', () => {
    const props = { open: true, onToggleOpen: () => {}, onToggleLayer: () => {}, counts: {}, statuses: {} };
    expect(renderToString(<LayerPanel {...props} enabled={new Set(['ships'] as const)} />)).toContain(SHIP_COLOURS[0]![1]);
    expect(renderToString(<LayerPanel {...props} enabled={new Set()} />)).not.toContain('Tanker');
  });
});
