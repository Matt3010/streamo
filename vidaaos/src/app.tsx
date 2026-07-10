import { useEffect } from 'preact/hooks';
import type { VNode } from 'preact';
import { SpatialRoot } from './spatial/SpatialRoot';
import { Router, useNav } from './router/Router';
import { AmbientBackground } from './shell/AmbientBackground';
import { Drawer } from './shell/Drawer';
import { ScreenSwitch } from './screens/ScreenSwitch';
import { Focusable } from './spatial/Focusable';

function Shell() {
  const { route } = useNav();
  const isPlayer = route.value.name === 'player';

  // Keep document title in sync (minor, helps desktop debugging).
  useEffect(() => {
    document.title = `Streamo — ${route.value.name}`;
  }, [route.value.name]);

  // Two focus categories under ROOT: "drawer" and "content". They must be
  // focusable=true so Norigin treats them as navigation nodes. Children are
  // always preferred thanks to getNextFocusKey, so the focus never lands on
  // the wrapper as long as it has focusable children.
  return (
    <div class="app-root">
      <AmbientBackground />
      {isPlayer ? null : <Drawer />}
      <Focusable
        focusKey="content"
        saveLastFocusedChild
        trackChildren
        className="content"
      >
        <ScreenSwitch route={route.value} />
      </Focusable>
    </div>
  );
}

export function App(): VNode {
  return (
    <SpatialRoot>
      <Router>
        <Shell />
      </Router>
    </SpatialRoot>
  );
}
