import { Dispatcher } from 'undici';
export declare function initializeNetworkProxy(): Promise<void>;
export declare function getProxyDispatcher(): Dispatcher | undefined;
