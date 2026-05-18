export {
  type AdPlatformCredentials,
  type AdPlatformEnv,
  type AdPlatformProvider,
  type MakeClientInput,
  makeAdPlatformClient,
} from './make-client';
export { RealGoogleAdsClient } from './real-google-ads';
export { RealMetaAdsClient } from './real-meta-ads';
/**
 * `SimulatedAdsClient` is preserved for one-line rollback (mockdata.md
 * Faz 0). The factory no longer dispatches to it.
 */
export { SimulatedAdsClient } from './simulated-ads';
