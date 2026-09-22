import { canAccess, MANIFEST, ROLES } from './manifest';

describe('route access', () => {
  it('lets each role open exactly its own sections', () => {
    expect(canAccess('sales', '/orders/new')).toBe(true);
    expect(canAccess('sales', '/reports')).toBe(false);
    expect(canAccess('sales', '/rates')).toBe(false);
    expect(canAccess('warehouse', '/payments')).toBe(false);
    expect(canAccess('warehouse', '/orders/abc')).toBe(true);
    expect(canAccess('marketing', '/customers/abc')).toBe(true);
    expect(canAccess('owner', '/reports?by=week')).toBe(true);
  });

  it('keeps writing routes to the roles that write', () => {
    expect(canAccess('warehouse', '/orders/new')).toBe(false);
    expect(canAccess('marketing', '/orders/new')).toBe(false);
    expect(canAccess('marketing', '/payments/new')).toBe(false);
  });

  it('does not treat a longer path as a section by prefix alone', () => {
    expect(canAccess('warehouse', '/ordersX')).toBe(false);
  });

  it('lands every role on a page it can open', () => {
    for (const r of ROLES) expect(canAccess(r.key, r.landing), r.key).toBe(true);
  });

  it('gives every role a different slice', () => {
    const shapes = Object.values(MANIFEST).map((pages) => pages.map((p) => p.href).join());
    expect(new Set(shapes).size).toBe(shapes.length);
  });
});
