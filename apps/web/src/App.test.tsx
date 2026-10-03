import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders every registry layer and the disclaimer', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Earthquakes');
    expect(html).toContain('Ships');
    expect(html).toContain('Emergencies: 112');
  });
});
