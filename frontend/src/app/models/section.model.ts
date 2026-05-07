import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

export interface SectionConfig {
  id: string;
  title: string;
  icon: IconDefinition;
  endpoint: string;
}
