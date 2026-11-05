// A route drawn on the map that doesn't start where the person is ("¿cómo voy de Móstoles a Alcorcón?" from the
// assistant): no GPS, no guidance, just the line and a small card. Guidance always starts from the GPS position
// (guidance.ts); starting one takes the preview away.
import { create } from 'zustand';

import type { LatLon } from './geo';
import { computeRoute, computeRouteAvoiding } from './routing';
import type { Costing, Route } from './routing-core';

export type PreviewEnd = LatLon & { name: string };

export type RoutePreview = {
  from: PreviewEnd;
  to: PreviewEnd;
  costing: Costing;
  /** Null while it is computed, or when no routing pack covers the trip (then the card says straight line). */
  route: Route | null;
  status: 'loading' | 'ready' | 'none';
  /** It keeps out of official alerts' areas (the card says so). */
  avoiding?: boolean;
};

export const useRoutePreview = create<{ preview: RoutePreview | null }>(() => ({ preview: null }));

let request = 0;

/** Draws a route from `from` to `to` on the map (its card shows time and distance); `avoid`: areas to stay out of. */
export async function previewRoute(from: PreviewEnd, to: PreviewEnd, costing: Costing, avoid?: [number, number][][]) {
  const mine = ++request;
  useRoutePreview.setState({ preview: { from, to, costing, route: null, status: 'loading', avoiding: !!avoid?.length } });
  let route: Route | null = null;
  try {
    route = avoid?.length ? await computeRouteAvoiding(from, to, costing, avoid) : await computeRoute(from, to, costing);
  } catch (e) {
    console.warn('[maps] route preview', e);
  }
  if (mine !== request) return;
  const cur = useRoutePreview.getState().preview;
  if (!cur) return;
  useRoutePreview.setState({ preview: { ...cur, route, status: route ? 'ready' : 'none' } });
}

export function clearRoutePreview() {
  request++;
  if (useRoutePreview.getState().preview) useRoutePreview.setState({ preview: null });
}
