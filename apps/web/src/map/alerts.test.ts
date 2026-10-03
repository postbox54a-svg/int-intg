import type { Feature } from '@ind-intg/shared';
import { describe, expect, it } from 'vitest';
import { ALERTS, RENDERERS, alertsToGeoJSON } from './layers';

const geometry = { type: 'MultiPolygon', coordinates: [[[[76, 10], [77, 10], [77, 11], [76, 10]]]] };
const alert = (props: Record<string, unknown>): Feature => ({ id: 'FX-1', layer: 'alerts', lat: 10.5, lon: 76.5, ts: 0, props });

describe('alerts rendering', () => {
  it('turns props.geometry into polygon features and skips alerts without one', () => {
    const fc = alertsToGeoJSON([alert({ severity: 'Severe', geometry }), alert({ severity: 'Minor' })]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]).toEqual({ type: 'Feature', geometry, properties: { severity: 'Severe', id: 'FX-1', ts: 0 } });
  });

  it('popup shows event, severity, area, sender and IST validity', () => {
    const rows = ALERTS.popup({
      event: 'Heavy Rainfall',
      severity: 'Severe',
      urgency: 'Expected',
      certainty: 'Likely',
      areaDesc: 'Pune, Satara',
      sender: 'IMD Mumbai',
      effective: Date.UTC(2026, 9, 3, 2, 30),
      expires: Date.UTC(2026, 9, 4, 2, 30),
      geometrySource: 'district',
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        ['Event', 'Heavy Rainfall'],
        ['Severity', 'Severe · Expected · Likely'],
        ['Area', 'Pune, Satara'],
        ['Issued by', 'IMD Mumbai'],
        ['From', expect.stringContaining('08:00:00 IST')],
        ['Until', expect.stringContaining('04 Oct 2026')],
        ['Map area', 'District boundaries (Census 2011)'],
      ]),
    );
  });

  it('draws alert areas underneath quake circles', () => {
    expect(Object.keys(RENDERERS)).toEqual(['alerts', 'ships', 'quakes', 'news']);
  });
});
