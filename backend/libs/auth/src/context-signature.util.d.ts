import { GatewayUserContext } from '@libs/contracts';
export declare function encodeUserContext(context: GatewayUserContext): string;
export declare function decodeUserContext(encoded: string): GatewayUserContext;
export declare function signEncodedContext(encoded: string, secret: string): string;
export declare function verifyEncodedContext(encoded: string, signature: string, secret: string): boolean;
