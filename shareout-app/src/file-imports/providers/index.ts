import type { FileImportProvider, ProviderApi } from '../types';
import { googleDrive } from './google';
import { microsoftGraph } from './microsoft';

export function providerApi(p: FileImportProvider): ProviderApi {
  return p === 'google_drive' ? googleDrive : microsoftGraph;
}
