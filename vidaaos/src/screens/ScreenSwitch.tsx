import type { VNode } from 'preact';
import type { Route } from '../router/routes';
import { HomeScreen } from './HomeScreen';
import { SearchScreen } from './SearchScreen';
import { LibraryScreen } from './LibraryScreen';
import { SectionListScreen } from './SectionListScreen';
import { DetailScreen } from './DetailScreen';
import { AnimeScreen } from './AnimeScreen';
import { AnimeDetailScreen } from './AnimeDetailScreen';
import { PlayerScreen } from './PlayerScreen';
import { SettingsScreen } from './SettingsScreen';
import { CacheManagementScreen } from './CacheManagementScreen';
import { strings } from '../i18n/strings';

function CenteredStub({ label }: { label: string }) {
  return (
    <div class="screen">
      <div class="stub">
        <div>{label}</div>
      </div>
    </div>
  );
}

export function ScreenSwitch({ route }: { route: Route }): VNode {
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'search':
      return <SearchScreen />;
    case 'library':
      return <LibraryScreen />;
    case 'sectionList':
      return <SectionListScreen route={route} />;
    case 'detail':
      return <DetailScreen route={route} />;
    case 'anime':
      return <AnimeScreen />;
    case 'animeDetail':
      return <AnimeDetailScreen route={route} />;
    case 'settings':
      return <SettingsScreen />;
    case 'cacheManagement':
      return <CacheManagementScreen />;
    case 'player':
      return <PlayerScreen route={route} />;
    default:
      return <CenteredStub label={strings.notAvailable} />;
  }
}
