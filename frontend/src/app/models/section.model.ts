import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import type { MediaType } from './media.model';

export interface SectionConfig {
  id: string;
  mediaType: MediaType;
  title: string;
  icon: IconDefinition;
  endpoint: string;
}
